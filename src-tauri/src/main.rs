mod iperf;
mod model;
mod saved_server;
mod ssh;

use crate::{
    iperf::{run_local_client, RunError},
    model::{
        RemoteTarget, ServerMode, SpeedPromptEvent, SpeedStateEvent, SpeedTestRequest, TestMode,
        TransferDirection, TransportProtocol,
    },
    ssh::{cleanup_remote_server, start_remote_server, RemoteServer, SshError},
};
use std::{
    sync::{
        atomic::{AtomicBool, AtomicU32, Ordering},
        Arc, Mutex,
    },
    thread,
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter, Manager, RunEvent, State};
use tokio::sync::watch;

#[derive(Clone)]
struct ActiveSession {
    remote: Option<RemoteTarget>,
    remote_pid: Arc<AtomicU32>,
    startup_finished: Arc<AtomicBool>,
    cancel: watch::Sender<bool>,
}

#[derive(Default)]
struct AppState {
    active: Arc<Mutex<Option<ActiveSession>>>,
}

fn emit_state(app: &AppHandle, phase: &'static str, message: impl Into<String>) {
    let _ = app.emit(
        "speed://state",
        SpeedStateEvent {
            phase,
            message: message.into(),
        },
    );
}

fn unavailable_server_message(manages_remote: bool) -> &'static str {
    if manages_remote {
        "无法连接远端 iperf3 服务，请检查防火墙和测速端口"
    } else {
        "未检测到服务运行，请排查地址和端口"
    }
}

fn emit_prompt(
    app: &AppHandle,
    kind: &'static str,
    title: &'static str,
    message: impl Into<String>,
    detail: Option<String>,
) {
    emit_state(app, "confirming", "等待确认后继续");
    let _ = app.emit(
        "speed://prompt",
        SpeedPromptEvent {
            kind,
            title,
            message: message.into(),
            detail,
        },
    );
}

fn clear_active(active: &Arc<Mutex<Option<ActiveSession>>>, pid: &Arc<AtomicU32>) {
    if let Ok(mut guard) = active.lock() {
        if guard
            .as_ref()
            .is_some_and(|session| Arc::ptr_eq(&session.remote_pid, pid))
        {
            *guard = None;
        }
    }
}

#[tauri::command]
async fn start_speed_test(
    app: AppHandle,
    state: State<'_, AppState>,
    payload: SpeedTestRequest,
) -> Result<(), String> {
    payload.validate()?;
    let manages_remote = payload.server_mode == ServerMode::SshManaged;
    let remote = payload.remote_target();
    let (cancel_tx, mut cancel_rx) = watch::channel(false);
    let remote_pid = Arc::new(AtomicU32::new(0));
    let startup_finished = Arc::new(AtomicBool::new(false));
    let session = ActiveSession {
        remote: manages_remote.then(|| remote.clone()),
        remote_pid: remote_pid.clone(),
        startup_finished: startup_finished.clone(),
        cancel: cancel_tx,
    };

    {
        let mut guard = state
            .active
            .lock()
            .map_err(|_| "测速状态不可用".to_string())?;
        if guard.is_some() {
            return Err("已有测速任务正在运行".into());
        }
        *guard = Some(session);
    }

    emit_state(
        &app,
        "starting",
        if manages_remote {
            "正在建立 SSH 安全通道"
        } else {
            "正在连接已有测速服务"
        },
    );
    let active = state.inner().active.clone();
    tauri::async_runtime::spawn(async move {
        let server_result = if manages_remote {
            let remote_for_start = remote.clone();
            let reuse_existing = payload.reuse_existing_server;
            let one_off = payload.test_mode == TestMode::Advanced;
            let result = tauri::async_runtime::spawn_blocking(move || {
                start_remote_server(&remote_for_start, reuse_existing, one_off)
            })
            .await;
            match result {
                Ok(result) => result,
                Err(error) => Err(SshError::Message(format!("SSH 任务异常结束：{error}"))),
            }
        } else {
            startup_finished.store(true, Ordering::Release);
            Ok(RemoteServer::Existing)
        };
        startup_finished.store(true, Ordering::Release);

        let server = match server_result {
            Ok(server) => {
                remote_pid.store(server.managed_pid(), Ordering::Release);
                server
            }
            Err(error) => {
                clear_active(&active, &remote_pid);
                match error {
                    SshError::HostKeyMismatch(fingerprint) => emit_prompt(
                        &app,
                        "hostKeyMismatch",
                        "服务器身份已变化",
                        "known_hosts 中的密钥与服务器当前密钥不一致。确认指纹可信后才能继续。",
                        Some(fingerprint),
                    ),
                    SshError::ExistingServer => emit_prompt(
                        &app,
                        "existingServer",
                        "检测到已有测速服务",
                        "目标端口已有服务监听。继续将直接复用它，完成后不会终止该服务。",
                        Some(format!("{}:{}", remote.host, remote.iperf_port)),
                    ),
                    SshError::Iperf3Missing(package_manager) => emit_prompt(
                        &app,
                        "iperf3Missing",
                        "远端未安装 iperf3",
                        package_manager.label().map_or_else(
                            || {
                                "未识别到可用的包管理器，请登录服务器手动安装 iperf3 3.17 或更高版本。"
                                    .to_string()
                            },
                            |label| {
                                format!(
                                    "已检测到 {label}。请登录服务器执行下面的命令，安装完成后重新检测。"
                                )
                            },
                        ),
                        package_manager.install_command().map(str::to_string),
                    ),
                    SshError::Message(message) => emit_state(&app, "failed", message),
                }
                return;
            }
        };
        let pid = server.managed_pid();
        let managed = server.is_managed();

        if *cancel_rx.borrow() {
            if managed {
                let remote_for_cleanup = remote.clone();
                let _ = tauri::async_runtime::spawn_blocking(move || {
                    cleanup_remote_server(&remote_for_cleanup, pid)
                })
                .await;
            }
            emit_state(
                &app,
                "cancelled",
                if managed {
                    "测速已中断，远端服务已清理"
                } else {
                    "测速已中断，持久化服务保持运行"
                },
            );
            clear_active(&active, &remote_pid);
            return;
        }

        let protocol = payload.effective_protocol();
        let streams = payload.effective_parallel_streams();
        let duration = payload.effective_duration();
        let directions: &[TransferDirection] = if payload.test_mode == TestMode::Standard {
            &[TransferDirection::Upload, TransferDirection::Download]
        } else {
            std::slice::from_ref(&payload.direction)
        };
        let mut run_result = Ok(());

        for (index, direction) in directions.iter().copied().enumerate() {
            let direction_name = if direction == TransferDirection::Upload {
                "上传"
            } else {
                "下载"
            };
            let protocol_name = if protocol == TransportProtocol::Tcp {
                "TCP"
            } else {
                "UDP"
            };
            emit_state(
                &app,
                "running",
                format!(
                    "正在进行{direction_name}测试 · {protocol_name} · {streams} 并发{}",
                    if matches!(server, RemoteServer::Existing) {
                        " · 复用已有服务"
                    } else {
                        ""
                    }
                ),
            );

            if let Err(error) = run_local_client(
                &app,
                &payload,
                direction,
                protocol,
                streams,
                duration,
                &mut cancel_rx,
            )
            .await
            {
                run_result = Err(error);
                break;
            }

            if index + 1 < directions.len() {
                tokio::time::sleep(Duration::from_millis(250)).await;
            }
        }
        emit_state(
            &app,
            "stopping",
            if managed {
                "正在关闭远端 iperf3 服务"
            } else {
                "正在结束本地测速，已有服务保持运行"
            },
        );

        let cleanup_result = if managed {
            let remote_for_cleanup = remote.clone();
            tauri::async_runtime::spawn_blocking(move || {
                cleanup_remote_server(&remote_for_cleanup, pid)
            })
            .await
            .map_err(|err| format!("清理任务异常结束：{err}"))
            .and_then(|result| result)
        } else {
            Ok(())
        };

        match (run_result, cleanup_result) {
            (Ok(()), Ok(())) => emit_state(
                &app,
                "completed",
                if managed {
                    "测速完成，远端服务已关闭"
                } else {
                    "测速完成，已有服务保持运行"
                },
            ),
            (Err(RunError::Cancelled), Ok(())) => emit_state(
                &app,
                "cancelled",
                if managed {
                    "测速已中断，远端服务已清理"
                } else {
                    "测速已中断，已有服务保持运行"
                },
            ),
            (Err(RunError::ServerUnavailable), Ok(())) => {
                emit_state(&app, "failed", unavailable_server_message(manages_remote))
            }
            (Err(RunError::Message(error)), Ok(())) => emit_state(&app, "failed", error),
            (Ok(()), Err(error)) => emit_state(&app, "failed", error),
            (Err(RunError::Cancelled), Err(error)) => emit_state(
                &app,
                "failed",
                format!("测速已中断，但远端清理失败：{error}"),
            ),
            (Err(RunError::Message(run_error)), Err(cleanup_error)) => emit_state(
                &app,
                "failed",
                format!("{run_error}；同时远端清理失败：{cleanup_error}"),
            ),
            (Err(RunError::ServerUnavailable), Err(cleanup_error)) => emit_state(
                &app,
                "failed",
                format!(
                    "{}；同时远端清理失败：{cleanup_error}",
                    unavailable_server_message(manages_remote)
                ),
            ),
        }

        clear_active(&active, &remote_pid);
    });

    Ok(())
}

#[tauri::command]
async fn stop_speed_test(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let session = state
        .active
        .lock()
        .map_err(|_| "测速状态不可用".to_string())?
        .clone();

    if let Some(session) = session {
        let _ = session.cancel.send(true);
        emit_state(&app, "stopping", "正在停止测速");
    }
    Ok(())
}

fn cleanup_before_exit(app: &tauri::AppHandle) {
    let session = app
        .state::<AppState>()
        .active
        .lock()
        .ok()
        .and_then(|guard| guard.clone());
    if let Some(session) = session {
        let _ = session.cancel.send(true);
        let wait_started = Instant::now();
        while !session.startup_finished.load(Ordering::Acquire)
            && wait_started.elapsed() < Duration::from_secs(13)
        {
            thread::sleep(Duration::from_millis(25));
        }
        let pid = session.remote_pid.load(Ordering::Acquire);
        if let Some(remote) = session.remote {
            let _ = cleanup_remote_server(&remote, pid);
        }
    }
}

fn main() {
    let app = tauri::Builder::default()
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            start_speed_test,
            stop_speed_test,
            saved_server::list_saved_servers,
            saved_server::get_saved_server_password,
            saved_server::save_server,
            saved_server::delete_saved_server
        ])
        .build(tauri::generate_context!())
        .expect("failed to build app");

    app.run(|handle, event| {
        if matches!(event, RunEvent::ExitRequested { .. }) {
            cleanup_before_exit(handle);
        }
    });
}
