mod events;
mod exit;
mod manager;
mod plan;
mod runner;
mod runtime;

use crate::{
    i18n::localize,
    iperf::RunError,
    model::{
        PromptKind, RemoteTarget, ServerMode, SpeedPhase, SpeedTestRequest, TestTopology,
        UiLanguage,
    },
    ssh::{RemoteServer, SshError},
};
use events::{emit_prompt, emit_state};
use exit::cleanup_active_session;
use manager::{ActiveSession, SessionManager};
use plan::SessionPlan;
use runner::{RunOutcome, SessionRunner};
use runtime::ProductionRuntime;
use std::sync::{
    atomic::{AtomicBool, AtomicU32, Ordering},
    Arc,
};
use tauri::{AppHandle, Manager, State};
use tokio::sync::watch;

#[derive(Default)]
pub(crate) struct AppState {
    sessions: SessionManager,
}

fn unavailable_server_message(manages_remote: bool) -> &'static str {
    if manages_remote {
        "无法连接远端 iperf3 服务，请检查防火墙和测速端口"
    } else {
        "未检测到服务运行，请排查地址和端口"
    }
}

fn emit_server_unavailable_prompt(
    app: &AppHandle,
    language: UiLanguage,
    manages_remote: bool,
    remote: &RemoteTarget,
) {
    emit_prompt(
        app,
        language,
        PromptKind::ServerUnavailable,
        "测速服务不可用",
        unavailable_server_message(manages_remote),
        Some(if remote.bind_ip.is_empty() {
            format!(
                "服务器地址：{}\n测速端口：{}",
                remote.host, remote.iperf_port
            )
        } else {
            format!(
                "SSH 地址：{}\n测速目标：{}\n测速端口：{}",
                remote.host, remote.bind_ip, remote.iperf_port
            )
        }),
    );
}

fn emit_client_ssh_error(app: &AppHandle, language: UiLanguage, error: SshError) {
    match error {
        SshError::HostKeyMismatch(fingerprint) => emit_prompt(
            app,
            language,
            PromptKind::ClientHostKeyMismatch,
            "测速发起端身份已变化",
            "测速发起端的 SSH 主机密钥与 known_hosts 不一致。确认指纹可信后才能继续。",
            Some(fingerprint),
        ),
        SshError::Iperf3Missing(package_manager) => emit_prompt(
            app,
            language,
            PromptKind::ClientIperf3Missing,
            "测速发起端未安装 iperf3",
            package_manager.label().map_or_else(
                || "请登录测速发起端手动安装 iperf3 3.12 或更高版本。".to_string(),
                |label| format!("测速发起端检测到 {label}。请执行下面的命令，安装完成后重新检测。"),
            ),
            package_manager.install_command().map(str::to_string),
        ),
        SshError::ExistingServer => {
            emit_state(app, language, SpeedPhase::Failed, "测速发起端状态异常")
        }
        SshError::Message(message) => emit_state(
            app,
            language,
            SpeedPhase::Failed,
            format!("测速发起端：{message}"),
        ),
    }
}

pub(crate) async fn start(
    app: AppHandle,
    state: State<'_, AppState>,
    payload: SpeedTestRequest,
) -> Result<(), String> {
    let language = payload.language;
    payload
        .validate()
        .map_err(|error| localize(language, error))?;
    let manages_remote = payload.server_mode == ServerMode::SshManaged;
    let remote_to_remote = payload.test_topology == TestTopology::RemoteToRemote;
    let remote = payload.remote_target();
    let remote_client = payload.remote_client_target();
    let target_host = payload.target_host().to_owned();
    let (cancel_tx, cancel_rx) = watch::channel(false);
    let remote_pid = Arc::new(AtomicU32::new(0));
    let client_pid = Arc::new(AtomicU32::new(0));
    let cancel_remote = Arc::new(AtomicBool::new(false));
    let startup_finished = Arc::new(AtomicBool::new(false));
    let session = ActiveSession {
        id: 0,
        language,
        server_remote: manages_remote.then(|| remote.clone()),
        server_pid: remote_pid.clone(),
        client_remote: remote_client.clone(),
        client_pid: client_pid.clone(),
        target_host: target_host.clone(),
        iperf_port: remote.iperf_port,
        startup_finished: startup_finished.clone(),
        cancel: cancel_tx,
        cancel_remote: cancel_remote.clone(),
    };

    let session_id = state
        .sessions
        .start(session)
        .map_err(|_| localize(language, "已有测速任务正在运行"))?;

    let starting_message = if remote_to_remote {
        "正在建立双端 SSH 安全通道"
    } else if manages_remote {
        "正在建立 SSH 安全通道"
    } else {
        "正在连接已有测速服务"
    };
    emit_state(
        &app,
        language,
        SpeedPhase::Starting,
        if remote.bind_ip.is_empty() {
            starting_message.to_owned()
        } else {
            format!(
                "{starting_message} · SSH 地址：{} · 测速目标：{target_host}",
                remote.host
            )
        },
    );
    let sessions = state.inner().sessions.clone();
    tauri::async_runtime::spawn(async move {
        let plan = SessionPlan::from_request(&payload);
        let mut runtime = ProductionRuntime {
            app: app.clone(),
            payload,
            remote: remote.clone(),
            remote_client,
            target_host,
            manages_remote,
            protocol: plan.protocol,
            streams: plan.streams,
            duration: plan.duration,
            target_bitrate_bps: plan.target_bitrate_bps,
            local_cancel: cancel_rx.clone(),
            cancel_remote,
            server_pid: remote_pid,
            client_pid,
            startup_finished,
        };
        let report = SessionRunner::new(&mut runtime, &plan, cancel_rx)
            .run()
            .await;
        let managed = report.server.is_some_and(RemoteServer::is_managed);

        match (report.outcome, report.cleanup_error) {
            (RunOutcome::ServerStartFailed(error), _) => match error {
                SshError::HostKeyMismatch(fingerprint) => emit_prompt(
                    &app,
                    language,
                    PromptKind::HostKeyMismatch,
                    "服务器身份已变化",
                    "known_hosts 中的密钥与服务器当前密钥不一致。确认指纹可信后才能继续。",
                    Some(fingerprint),
                ),
                SshError::ExistingServer => emit_prompt(
                    &app,
                    language,
                    PromptKind::ExistingServer,
                    "检测到已有测速服务",
                    "目标端口已有服务监听。继续将直接复用它，完成后不会终止该服务。",
                    Some(format!("{}:{}", remote.host, remote.iperf_port)),
                ),
                SshError::Iperf3Missing(package_manager) => emit_prompt(
                    &app,
                    language,
                    PromptKind::Iperf3Missing,
                    "远端未安装 iperf3",
                    package_manager.label().map_or_else(
                        || {
                            "未识别到可用的包管理器，请登录服务器手动安装 iperf3 3.12 或更高版本。"
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
                SshError::Message(message) => {
                    emit_state(&app, language, SpeedPhase::Failed, message)
                }
            },
            (RunOutcome::Completed, None) => emit_state(
                &app,
                language,
                SpeedPhase::Completed,
                if managed {
                    "测速完成，远端服务已关闭"
                } else {
                    "测速完成，已有服务保持运行"
                },
            ),
            (RunOutcome::Cancelled | RunOutcome::RunFailed(RunError::Cancelled), None) => {
                emit_state(
                    &app,
                    language,
                    SpeedPhase::Cancelled,
                    if managed {
                        "测速已中断，远端服务已清理"
                    } else {
                        "测速已中断，已有服务保持运行"
                    },
                )
            }
            (RunOutcome::RunFailed(RunError::ServerUnavailable), None) => {
                emit_server_unavailable_prompt(&app, language, manages_remote, &remote)
            }
            (RunOutcome::RunFailed(RunError::Message(error)), None) => {
                emit_state(&app, language, SpeedPhase::Failed, error)
            }
            (RunOutcome::RunFailed(RunError::Remote(error)), None) => {
                emit_client_ssh_error(&app, language, error)
            }
            (RunOutcome::Completed, Some(error)) => {
                emit_state(&app, language, SpeedPhase::Failed, error)
            }
            (RunOutcome::Cancelled | RunOutcome::RunFailed(RunError::Cancelled), Some(error)) => {
                emit_state(
                    &app,
                    language,
                    SpeedPhase::Failed,
                    format!("测速已中断，但远端清理失败：{error}"),
                )
            }
            (RunOutcome::RunFailed(RunError::Message(run_error)), Some(cleanup_error)) => {
                emit_state(
                    &app,
                    language,
                    SpeedPhase::Failed,
                    format!("{run_error}；同时远端清理失败：{cleanup_error}"),
                )
            }
            (RunOutcome::RunFailed(RunError::Remote(error)), Some(cleanup_error)) => {
                emit_client_ssh_error(&app, language, error);
                emit_state(
                    &app,
                    language,
                    SpeedPhase::Failed,
                    format!("同时远端清理失败：{cleanup_error}"),
                );
            }
            (RunOutcome::RunFailed(RunError::ServerUnavailable), Some(cleanup_error)) => {
                emit_server_unavailable_prompt(&app, language, manages_remote, &remote);
                emit_state(
                    &app,
                    language,
                    SpeedPhase::Failed,
                    format!("同时远端清理失败：{cleanup_error}"),
                );
            }
        }

        sessions.finish(session_id);
    });

    Ok(())
}

pub(crate) async fn stop(
    app: AppHandle,
    state: State<'_, AppState>,
    _language: UiLanguage,
) -> Result<(), String> {
    let session = state.sessions.current();

    if let Some(session) = session {
        let session_language = session.language;
        let _ = session.cancel.send(true);
        session.cancel_remote.store(true, Ordering::Release);
        emit_state(&app, session_language, SpeedPhase::Stopping, "正在停止测速");

        // The runner owns final cleanup and terminal event emission. The remote reader
        // observes cancellation between streamed samples, avoiding concurrent cleanup.
    }
    Ok(())
}

pub(crate) fn cleanup_before_exit(app: &tauri::AppHandle) {
    let session = app.state::<AppState>().sessions.current();
    if let Some(session) = session {
        cleanup_active_session(&session);
    }
}
