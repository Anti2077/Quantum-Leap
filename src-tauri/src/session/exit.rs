use super::manager::ActiveSession;
use crate::{
    model::RemoteTarget,
    ssh::{cleanup_remote_client, cleanup_remote_server},
};
use std::{
    sync::atomic::Ordering,
    thread,
    time::{Duration, Instant},
};

trait ExitCleanup {
    fn cleanup_client(&self, remote: &RemoteTarget, pid: u32, target_host: &str, port: u16);
    fn cleanup_server(&self, remote: &RemoteTarget, pid: u32);
}

struct SshExitCleanup;

impl ExitCleanup for SshExitCleanup {
    fn cleanup_client(&self, remote: &RemoteTarget, pid: u32, target_host: &str, port: u16) {
        let _ = cleanup_remote_client(remote, pid, target_host, port);
    }

    fn cleanup_server(&self, remote: &RemoteTarget, pid: u32) {
        let _ = cleanup_remote_server(remote, pid);
    }
}

pub(super) fn cleanup_active_session(session: &ActiveSession) {
    cleanup_with(session, &SshExitCleanup, Duration::from_secs(13));
}

fn cleanup_with(session: &ActiveSession, cleanup: &impl ExitCleanup, startup_timeout: Duration) {
    let _ = session.cancel.send(true);
    session.cancel_remote.store(true, Ordering::Release);
    let wait_started = Instant::now();
    while !session.startup_finished.load(Ordering::Acquire)
        && wait_started.elapsed() < startup_timeout
    {
        thread::sleep(Duration::from_millis(25));
    }

    let server_pid = session.server_pid.load(Ordering::Acquire);
    let client_pid = session.client_pid.load(Ordering::Acquire);
    if let Some(client) = session.client_remote.as_ref() {
        cleanup.cleanup_client(client, client_pid, &session.target_host, session.iperf_port);
    }
    if let Some(server) = session.server_remote.as_ref() {
        cleanup.cleanup_server(server, server_pid);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{SshAuthMethod, UiLanguage};
    use std::sync::{
        atomic::{AtomicBool, AtomicU32},
        Arc, Mutex,
    };
    use tokio::sync::watch;

    #[derive(Default)]
    struct FakeExitCleanup {
        calls: Mutex<Vec<String>>,
    }

    impl ExitCleanup for FakeExitCleanup {
        fn cleanup_client(&self, _remote: &RemoteTarget, pid: u32, target_host: &str, port: u16) {
            self.calls
                .lock()
                .expect("calls lock")
                .push(format!("client:{pid}:{target_host}:{port}"));
        }

        fn cleanup_server(&self, _remote: &RemoteTarget, pid: u32) {
            self.calls
                .lock()
                .expect("calls lock")
                .push(format!("server:{pid}"));
        }
    }

    fn remote(host: &str) -> RemoteTarget {
        RemoteTarget {
            host: host.into(),
            ssh_port: 22,
            iperf_port: 5201,
            iperf_path: String::new(),
            bind_ip: String::new(),
            username: "fixture".into(),
            password: "secret".into(),
            auth_method: SshAuthMethod::Password,
            private_key_path: String::new(),
            passphrase: String::new(),
            allow_host_key_mismatch: false,
        }
    }

    #[test]
    fn exit_cancels_and_best_effort_cleans_both_endpoints() {
        let (cancel, cancel_rx) = watch::channel(false);
        let session = ActiveSession {
            id: 7,
            language: UiLanguage::En,
            server_remote: Some(remote("server.invalid")),
            server_pid: Arc::new(AtomicU32::new(41)),
            client_remote: Some(remote("client.invalid")),
            client_pid: Arc::new(AtomicU32::new(42)),
            target_host: "server.invalid".into(),
            iperf_port: 5201,
            startup_finished: Arc::new(AtomicBool::new(true)),
            cancel,
            cancel_remote: Arc::new(AtomicBool::new(false)),
        };
        let cleanup = FakeExitCleanup::default();

        cleanup_with(&session, &cleanup, Duration::ZERO);

        assert!(*cancel_rx.borrow());
        assert!(session.cancel_remote.load(Ordering::Acquire));
        assert_eq!(
            *cleanup.calls.lock().expect("calls lock"),
            vec![
                "client:42:server.invalid:5201".to_string(),
                "server:41".to_string(),
            ]
        );
    }
}
