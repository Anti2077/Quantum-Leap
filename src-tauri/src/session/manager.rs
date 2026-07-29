use crate::model::{RemoteTarget, UiLanguage};
use std::sync::{
    atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering},
    Arc, Mutex,
};
use tokio::sync::watch;

#[derive(Clone)]
pub(super) struct ActiveSession {
    pub(super) id: u64,
    pub(super) language: UiLanguage,
    pub(super) server_remote: Option<RemoteTarget>,
    pub(super) server_pid: Arc<AtomicU32>,
    pub(super) client_remote: Option<RemoteTarget>,
    pub(super) client_pid: Arc<AtomicU32>,
    pub(super) target_host: String,
    pub(super) iperf_port: u16,
    pub(super) startup_finished: Arc<AtomicBool>,
    pub(super) cancel: watch::Sender<bool>,
    pub(super) cancel_remote: Arc<AtomicBool>,
}

#[derive(Clone)]
pub(super) struct SessionManager {
    active: Arc<Mutex<Option<ActiveSession>>>,
    next_session_id: Arc<AtomicU64>,
}

impl Default for SessionManager {
    fn default() -> Self {
        Self {
            active: Arc::new(Mutex::new(None)),
            next_session_id: Arc::new(AtomicU64::new(1)),
        }
    }
}

impl SessionManager {
    pub(super) fn start(&self, mut session: ActiveSession) -> Result<u64, ()> {
        let mut guard = self.active.lock().map_err(|_| ())?;
        if guard.is_some() {
            return Err(());
        }
        let session_id = self.next_session_id.fetch_add(1, Ordering::Relaxed);
        session.id = session_id;
        *guard = Some(session);
        Ok(session_id)
    }

    pub(super) fn current(&self) -> Option<ActiveSession> {
        self.active.lock().ok().and_then(|guard| guard.clone())
    }

    pub(super) fn finish(&self, session_id: u64) {
        if let Ok(mut guard) = self.active.lock() {
            if guard
                .as_ref()
                .is_some_and(|session| session.id == session_id)
            {
                *guard = None;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn session() -> ActiveSession {
        let (cancel, _) = watch::channel(false);
        ActiveSession {
            id: 0,
            language: UiLanguage::En,
            server_remote: None,
            server_pid: Arc::new(AtomicU32::new(0)),
            client_remote: None,
            client_pid: Arc::new(AtomicU32::new(0)),
            target_host: "127.0.0.1".into(),
            iperf_port: 5201,
            startup_finished: Arc::new(AtomicBool::new(false)),
            cancel,
            cancel_remote: Arc::new(AtomicBool::new(false)),
        }
    }

    #[test]
    fn rejects_concurrent_sessions_and_assigns_stable_ids() {
        let manager = SessionManager::default();
        let first_id = manager
            .start(session())
            .expect("first session should start");
        assert!(manager.start(session()).is_err());
        assert_eq!(manager.current().map(|active| active.id), Some(first_id));

        manager.finish(first_id);
        let second_id = manager
            .start(session())
            .expect("second session should start");
        assert!(second_id > first_id);
    }

    #[test]
    fn stale_completion_cannot_clear_the_current_session() {
        let manager = SessionManager::default();
        let current_id = manager.start(session()).expect("session should start");
        manager.finish(current_id + 1);
        assert_eq!(manager.current().map(|active| active.id), Some(current_id));
    }
}
