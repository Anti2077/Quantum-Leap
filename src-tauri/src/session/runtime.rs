use super::{events::emit_state, runner::BoxFuture};
use crate::{
    iperf::{run_local_client, run_remote_client, RunError},
    model::{RemoteTarget, SpeedPhase, SpeedTestRequest, TransferDirection, TransportProtocol},
    ssh::{
        cleanup_remote_client, cleanup_remote_server, start_remote_server, RemoteServer, SshError,
    },
};
use std::sync::{
    atomic::{AtomicBool, AtomicU32, Ordering},
    Arc,
};
use tauri::AppHandle;
use tokio::sync::watch;

pub(super) struct ProductionRuntime {
    pub(super) app: AppHandle,
    pub(super) payload: SpeedTestRequest,
    pub(super) remote: RemoteTarget,
    pub(super) remote_client: Option<RemoteTarget>,
    pub(super) target_host: String,
    pub(super) manages_remote: bool,
    pub(super) protocol: TransportProtocol,
    pub(super) streams: u8,
    pub(super) duration: u16,
    pub(super) target_bitrate_bps: u64,
    pub(super) local_cancel: watch::Receiver<bool>,
    pub(super) cancel_remote: Arc<AtomicBool>,
    pub(super) server_pid: Arc<AtomicU32>,
    pub(super) client_pid: Arc<AtomicU32>,
    pub(super) startup_finished: Arc<AtomicBool>,
}

impl super::runner::SessionRuntime for ProductionRuntime {
    fn start_server(&mut self) -> BoxFuture<'_, Result<RemoteServer, SshError>> {
        let manages_remote = self.manages_remote;
        let remote = self.remote.clone();
        let reuse_existing = self.payload.reuse_existing_server;
        let one_off = self.payload.test_mode == crate::model::TestMode::Advanced;
        let server_pid = self.server_pid.clone();
        let startup_finished = self.startup_finished.clone();
        Box::pin(async move {
            let result = if manages_remote {
                tauri::async_runtime::spawn_blocking(move || {
                    start_remote_server(&remote, reuse_existing, one_off)
                })
                .await
                .unwrap_or_else(|error| {
                    Err(SshError::Message(format!("SSH 任务异常结束：{error}")))
                })
            } else {
                Ok(RemoteServer::Existing)
            };
            startup_finished.store(true, Ordering::Release);
            if let Ok(server) = result.as_ref() {
                server_pid.store(server.managed_pid(), Ordering::Release);
            }
            result
        })
    }

    fn run_direction(
        &mut self,
        server: RemoteServer,
        direction: TransferDirection,
    ) -> BoxFuture<'_, Result<(), RunError>> {
        let direction_name = if direction == TransferDirection::Upload {
            "上传"
        } else {
            "下载"
        };
        let protocol_name = if self.protocol == TransportProtocol::Tcp {
            "TCP"
        } else {
            "UDP"
        };
        emit_state(
            &self.app,
            self.payload.language,
            SpeedPhase::Running,
            format!(
                "正在进行{direction_name}测试 · {protocol_name} · {} 并发{}{}",
                self.streams,
                if matches!(server, RemoteServer::Existing) {
                    " · 复用已有服务"
                } else {
                    ""
                },
                if self.remote.bind_ip.is_empty() {
                    String::new()
                } else {
                    format!(" · 测速目标：{}", self.target_host)
                }
            ),
        );

        Box::pin(async move {
            if let Some(client) = self.remote_client.as_ref() {
                run_remote_client(
                    &self.app,
                    client,
                    &self.target_host,
                    self.remote.iperf_port,
                    direction,
                    self.protocol,
                    self.streams,
                    self.duration,
                    self.target_bitrate_bps,
                    self.cancel_remote.clone(),
                    self.client_pid.clone(),
                )
                .await
            } else {
                run_local_client(
                    &self.app,
                    &self.payload,
                    direction,
                    self.protocol,
                    self.streams,
                    self.duration,
                    &mut self.local_cancel,
                )
                .await
            }
        })
    }

    fn cleanup(&mut self, server: RemoteServer) -> BoxFuture<'_, Result<(), String>> {
        emit_state(
            &self.app,
            self.payload.language,
            SpeedPhase::Stopping,
            if server.is_managed() {
                "正在关闭远端 iperf3 服务"
            } else {
                "正在结束本地测速，已有服务保持运行"
            },
        );
        let server_remote = server.is_managed().then(|| self.remote.clone());
        let server_pid = server.managed_pid();
        let client_remote = self.remote_client.clone();
        let client_pid = self.client_pid.load(Ordering::Acquire);
        let target_host = self.target_host.clone();
        let iperf_port = self.remote.iperf_port;
        Box::pin(async move {
            cleanup_endpoints(
                server_remote,
                server_pid,
                client_remote,
                client_pid,
                target_host,
                iperf_port,
            )
            .await
        })
    }
}

async fn cleanup_endpoints(
    server_remote: Option<RemoteTarget>,
    server_pid: u32,
    client_remote: Option<RemoteTarget>,
    client_pid: u32,
    target_host: String,
    iperf_port: u16,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut errors = Vec::new();
        if let Some(client) = client_remote {
            if let Err(error) = cleanup_remote_client(&client, client_pid, &target_host, iperf_port)
            {
                errors.push(error);
            }
        }
        if let Some(server) = server_remote {
            if let Err(error) = cleanup_remote_server(&server, server_pid) {
                errors.push(error);
            }
        }
        if errors.is_empty() {
            Ok(())
        } else {
            Err(errors.join("；"))
        }
    })
    .await
    .map_err(|error| format!("清理任务异常结束：{error}"))?
}
