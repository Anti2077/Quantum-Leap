use super::plan::SessionPlan;
use crate::{
    iperf::RunError,
    model::TransferDirection,
    ssh::{RemoteServer, SshError},
};
use std::{future::Future, pin::Pin};
use tokio::sync::watch;

pub(super) type BoxFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

pub(super) trait SessionRuntime {
    fn start_server(&mut self) -> BoxFuture<'_, Result<RemoteServer, SshError>>;

    fn run_direction(
        &mut self,
        server: RemoteServer,
        direction: TransferDirection,
    ) -> BoxFuture<'_, Result<(), RunError>>;

    fn cleanup(&mut self, server: RemoteServer) -> BoxFuture<'_, Result<(), String>>;
}

#[derive(Debug)]
pub(super) enum RunOutcome {
    Completed,
    Cancelled,
    ServerStartFailed(SshError),
    RunFailed(RunError),
}

#[derive(Debug)]
pub(super) struct RunReport {
    pub(super) server: Option<RemoteServer>,
    pub(super) outcome: RunOutcome,
    pub(super) cleanup_error: Option<String>,
}

pub(super) struct SessionRunner<'a, R> {
    runtime: &'a mut R,
    plan: &'a SessionPlan,
    cancel: watch::Receiver<bool>,
}

impl<'a, R: SessionRuntime> SessionRunner<'a, R> {
    pub(super) fn new(
        runtime: &'a mut R,
        plan: &'a SessionPlan,
        cancel: watch::Receiver<bool>,
    ) -> Self {
        Self {
            runtime,
            plan,
            cancel,
        }
    }

    pub(super) async fn run(self) -> RunReport {
        // Startup is deliberately not selected against cancellation. A remote start may
        // still return a PID, which must be observed before cleanup can safely run.
        let server = match self.runtime.start_server().await {
            Ok(server) => server,
            Err(error) => {
                return RunReport {
                    server: None,
                    outcome: RunOutcome::ServerStartFailed(error),
                    cleanup_error: None,
                };
            }
        };

        let mut outcome = if *self.cancel.borrow() {
            RunOutcome::Cancelled
        } else {
            RunOutcome::Completed
        };

        if matches!(outcome, RunOutcome::Completed) {
            for (index, direction) in self.plan.directions.iter().copied().enumerate() {
                if *self.cancel.borrow() {
                    outcome = RunOutcome::Cancelled;
                    break;
                }
                if let Err(error) = self.runtime.run_direction(server, direction).await {
                    outcome = match error {
                        RunError::Cancelled => RunOutcome::Cancelled,
                        other => RunOutcome::RunFailed(other),
                    };
                    break;
                }
                if index + 1 < self.plan.directions.len() {
                    tokio::time::sleep(std::time::Duration::from_millis(250)).await;
                }
            }
        }

        let cleanup_error = self.runtime.cleanup(server).await.err();
        RunReport {
            server: Some(server),
            outcome,
            cleanup_error,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        model::{
            RemoteTarget, ServerMode, SpeedTestRequest, SshAuthMethod, TestMode, TestTopology,
            TransportProtocol, UiLanguage,
        },
        ssh::RemotePackageManager,
    };
    use std::sync::{Arc, Mutex};

    #[derive(Clone, Debug, PartialEq, Eq)]
    enum Call {
        Start,
        Run(TransferDirection),
        Cleanup,
    }

    struct FakeRuntime {
        calls: Arc<Mutex<Vec<Call>>>,
        start_result: Option<Result<RemoteServer, SshError>>,
        run_results: Vec<Result<(), RunError>>,
        cleanup_result: Option<Result<(), String>>,
        cancel_on_start: Option<watch::Sender<bool>>,
    }

    impl FakeRuntime {
        fn successful() -> Self {
            Self {
                calls: Arc::new(Mutex::new(Vec::new())),
                start_result: Some(Ok(RemoteServer::Managed(41))),
                run_results: vec![Ok(()), Ok(())],
                cleanup_result: Some(Ok(())),
                cancel_on_start: None,
            }
        }
    }

    impl SessionRuntime for FakeRuntime {
        fn start_server(&mut self) -> BoxFuture<'_, Result<RemoteServer, SshError>> {
            self.calls.lock().expect("calls lock").push(Call::Start);
            if let Some(cancel) = self.cancel_on_start.take() {
                let _ = cancel.send(true);
            }
            let result = self.start_result.take().expect("single start call");
            Box::pin(async move { result })
        }

        fn run_direction(
            &mut self,
            _server: RemoteServer,
            direction: TransferDirection,
        ) -> BoxFuture<'_, Result<(), RunError>> {
            self.calls
                .lock()
                .expect("calls lock")
                .push(Call::Run(direction));
            let result = self.run_results.remove(0);
            Box::pin(async move { result })
        }

        fn cleanup(&mut self, _server: RemoteServer) -> BoxFuture<'_, Result<(), String>> {
            self.calls.lock().expect("calls lock").push(Call::Cleanup);
            let result = self.cleanup_result.take().expect("single cleanup call");
            Box::pin(async move { result })
        }
    }

    fn request() -> SpeedTestRequest {
        SpeedTestRequest {
            language: UiLanguage::En,
            host: "10.0.0.8".into(),
            ssh_port: 22,
            iperf_port: 5201,
            remote_iperf_path: String::new(),
            local_bind_ip: String::new(),
            server_bind_ip: String::new(),
            server_mode: ServerMode::SshManaged,
            username: "tester".into(),
            password: "secret".into(),
            auth_method: SshAuthMethod::Password,
            private_key_path: String::new(),
            passphrase: String::new(),
            test_mode: TestMode::Standard,
            direction: TransferDirection::Upload,
            protocol: TransportProtocol::Tcp,
            parallel_streams: 8,
            duration_seconds: 10,
            target_bitrate_bps: 0,
            reuse_existing_server: false,
            allow_host_key_mismatch: false,
            test_topology: TestTopology::LocalToRemote,
            remote_client: None,
        }
    }

    async fn run_fake(runtime: &mut FakeRuntime, cancel: watch::Receiver<bool>) -> RunReport {
        let plan = SessionPlan::from_request(&request());
        SessionRunner::new(runtime, &plan, cancel).run().await
    }

    #[tokio::test]
    async fn runs_both_directions_in_order_and_cleans_once() {
        let (_cancel, cancel_rx) = watch::channel(false);
        let mut runtime = FakeRuntime::successful();
        let calls = runtime.calls.clone();

        let report = run_fake(&mut runtime, cancel_rx).await;

        assert!(matches!(report.outcome, RunOutcome::Completed));
        assert!(report.cleanup_error.is_none());
        assert_eq!(
            *calls.lock().expect("calls lock"),
            vec![
                Call::Start,
                Call::Run(TransferDirection::Upload),
                Call::Run(TransferDirection::Download),
                Call::Cleanup,
            ]
        );
    }

    #[tokio::test]
    async fn cancellation_during_start_waits_for_start_then_cleans_new_pid() {
        let (cancel, cancel_rx) = watch::channel(false);
        let mut runtime = FakeRuntime::successful();
        runtime.cancel_on_start = Some(cancel);
        let calls = runtime.calls.clone();

        let report = run_fake(&mut runtime, cancel_rx).await;

        assert!(matches!(report.outcome, RunOutcome::Cancelled));
        assert_eq!(
            *calls.lock().expect("calls lock"),
            vec![Call::Start, Call::Cleanup]
        );
    }

    #[tokio::test]
    async fn client_failure_rolls_back_both_endpoints_once() {
        let (_cancel, cancel_rx) = watch::channel(false);
        let mut runtime = FakeRuntime::successful();
        runtime.run_results[0] = Err(RunError::Message("client failed".into()));
        let calls = runtime.calls.clone();

        let report = run_fake(&mut runtime, cancel_rx).await;

        assert!(matches!(
            report.outcome,
            RunOutcome::RunFailed(RunError::Message(ref message)) if message == "client failed"
        ));
        assert_eq!(
            *calls.lock().expect("calls lock"),
            vec![
                Call::Start,
                Call::Run(TransferDirection::Upload),
                Call::Cleanup,
            ]
        );
    }

    #[tokio::test]
    async fn preserves_server_and_client_host_key_failures() {
        let (_cancel, cancel_rx) = watch::channel(false);
        let mut server_runtime = FakeRuntime::successful();
        server_runtime.start_result = Some(Err(SshError::HostKeyMismatch("server-key".into())));
        let server_report = run_fake(&mut server_runtime, cancel_rx).await;
        assert!(matches!(
            server_report.outcome,
            RunOutcome::ServerStartFailed(SshError::HostKeyMismatch(ref key)) if key == "server-key"
        ));
        assert_eq!(
            *server_runtime.calls.lock().expect("calls lock"),
            vec![Call::Start]
        );

        let (_cancel, cancel_rx) = watch::channel(false);
        let mut client_runtime = FakeRuntime::successful();
        client_runtime.run_results[0] = Err(RunError::Remote(SshError::HostKeyMismatch(
            "client-key".into(),
        )));
        let client_report = run_fake(&mut client_runtime, cancel_rx).await;
        assert!(matches!(
            client_report.outcome,
            RunOutcome::RunFailed(RunError::Remote(SshError::HostKeyMismatch(ref key))) if key == "client-key"
        ));
        assert!(client_report.cleanup_error.is_none());
    }

    #[tokio::test]
    async fn reports_service_unavailable_and_cleanup_failure_together() {
        let (_cancel, cancel_rx) = watch::channel(false);
        let mut runtime = FakeRuntime::successful();
        runtime.run_results[0] = Err(RunError::ServerUnavailable);
        runtime.cleanup_result = Some(Err("cleanup failed".into()));

        let report = run_fake(&mut runtime, cancel_rx).await;

        assert!(matches!(
            report.outcome,
            RunOutcome::RunFailed(RunError::ServerUnavailable)
        ));
        assert_eq!(report.cleanup_error.as_deref(), Some("cleanup failed"));
    }

    #[tokio::test]
    async fn missing_service_dependency_does_not_attempt_cleanup() {
        let (_cancel, cancel_rx) = watch::channel(false);
        let mut runtime = FakeRuntime::successful();
        runtime.start_result = Some(Err(SshError::Iperf3Missing(RemotePackageManager::Apt)));

        let report = run_fake(&mut runtime, cancel_rx).await;

        assert!(matches!(
            report.outcome,
            RunOutcome::ServerStartFailed(SshError::Iperf3Missing(RemotePackageManager::Apt))
        ));
        assert_eq!(
            *runtime.calls.lock().expect("calls lock"),
            vec![Call::Start]
        );
    }

    #[test]
    fn fake_fixture_uses_remote_targets_without_network_access() {
        let target = RemoteTarget {
            host: "fixture.invalid".into(),
            ssh_port: 22,
            iperf_port: 5201,
            iperf_path: String::new(),
            bind_ip: String::new(),
            username: "fixture".into(),
            password: String::new(),
            auth_method: SshAuthMethod::PrivateKey,
            private_key_path: "/fixture/key".into(),
            passphrase: String::new(),
            allow_host_key_mismatch: false,
        };
        assert_eq!(target.host, "fixture.invalid");
    }
}
