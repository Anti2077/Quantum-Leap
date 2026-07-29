use std::{process::Stdio, sync::Arc, time::Instant};
use tauri::async_runtime::JoinHandle;
use tokio::{
    io::{AsyncBufReadExt, BufReader},
    process::{Child, Command},
    sync::Mutex,
    time::{timeout, Duration},
};

const REPORT_INTERVAL_SECONDS: &str = "0.5";

#[derive(Default)]
pub(super) struct PingMetrics {
    latency_ms: Option<f64>,
    jitter_ms: Option<f64>,
    updated_at: Option<Instant>,
}

impl PingMetrics {
    pub(super) fn fresh_values(&self) -> Option<(f64, Option<f64>)> {
        self.updated_at
            .filter(|updated| updated.elapsed() <= Duration::from_secs(2))
            .and_then(|_| self.latency_ms.map(|latency| (latency, self.jitter_ms)))
    }
}

pub(super) fn parse_ping_latency(line: &[u8]) -> Option<f64> {
    for (index, pair) in line.windows(2).enumerate() {
        if !pair[0].eq_ignore_ascii_case(&b'm') || !pair[1].eq_ignore_ascii_case(&b's') {
            continue;
        }
        let mut end = index;
        while end > 0 && line[end - 1].is_ascii_whitespace() {
            end -= 1;
        }
        let mut start = end;
        while start > 0 && (line[start - 1].is_ascii_digit() || line[start - 1] == b'.') {
            start -= 1;
        }
        let mut marker = start;
        while marker > 0 && line[marker - 1].is_ascii_whitespace() {
            marker -= 1;
        }
        if marker == 0 || !matches!(line[marker - 1], b'=' | b'<') {
            continue;
        }
        let value = std::str::from_utf8(&line[start..end])
            .ok()?
            .parse::<f64>()
            .ok()?;
        if value.is_finite() && value >= 0.0 {
            return Some(value);
        }
    }
    None
}

pub(super) fn spawn_ping(
    host: &str,
    metrics: Arc<Mutex<PingMetrics>>,
) -> Option<(Child, JoinHandle<()>)> {
    #[cfg(target_os = "macos")]
    let mut command = {
        let mut command = Command::new("/sbin/ping");
        command.args(["-n", "-i", REPORT_INTERVAL_SECONDS, host]);
        command
    };
    #[cfg(target_os = "linux")]
    let mut command = {
        let mut command = Command::new("ping");
        command.args(["-n", "-i", REPORT_INTERVAL_SECONDS, host]);
        command
    };
    #[cfg(target_os = "windows")]
    let mut command = {
        let mut command = Command::new("ping");
        command.args(["-t", host]);
        command
    };

    command
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    let mut child = command.spawn().ok()?;
    let stdout = child.stdout.take()?;
    let task = tauri::async_runtime::spawn(async move {
        let mut reader = BufReader::new(stdout);
        let mut line = Vec::new();
        while reader.read_until(b'\n', &mut line).await.is_ok() && !line.is_empty() {
            let Some(latency_ms) = parse_ping_latency(&line) else {
                line.clear();
                continue;
            };
            let mut current = metrics.lock().await;
            current.jitter_ms = current
                .latency_ms
                .map(|previous| (latency_ms - previous).abs());
            current.latency_ms = Some(latency_ms);
            current.updated_at = Some(Instant::now());
            line.clear();
        }
    });
    Some((child, task))
}

pub(super) async fn stop_ping(process: &mut Option<(Child, JoinHandle<()>)>) {
    if let Some((mut child, task)) = process.take() {
        let _ = child.start_kill();
        let _ = timeout(Duration::from_secs(1), child.wait()).await;
        task.abort();
    }
}
