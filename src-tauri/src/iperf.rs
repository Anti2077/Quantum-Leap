use crate::model::{
    ServerMode, SpeedSampleEvent, SpeedTestRequest, TransferDirection, TransportProtocol,
};
use serde_json::Value;
use std::{env, path::PathBuf, process::Stdio, sync::Arc, time::Instant};
use tauri::{async_runtime::JoinHandle, AppHandle, Emitter};
use tokio::{
    io::{AsyncBufReadExt, AsyncReadExt, BufReader},
    process::{Child, Command},
    sync::{watch, Mutex},
    time::{timeout, Duration},
};

const REPORT_INTERVAL_SECONDS: &str = "0.5";

#[derive(Default)]
struct PingMetrics {
    latency_ms: Option<f64>,
    jitter_ms: Option<f64>,
    updated_at: Option<Instant>,
}

#[derive(Default)]
struct ClientOutput {
    sample_count: u32,
    error: Option<String>,
}

impl PingMetrics {
    fn fresh_values(&self) -> Option<(f64, Option<f64>)> {
        self.updated_at
            .filter(|updated| updated.elapsed() <= Duration::from_secs(2))
            .and_then(|_| self.latency_ms.map(|latency| (latency, self.jitter_ms)))
    }
}

#[derive(Debug)]
pub enum RunError {
    Cancelled,
    ServerUnavailable,
    Message(String),
}

fn is_server_unavailable(detail: &str) -> bool {
    let normalized = detail.to_ascii_lowercase();
    [
        "unable to connect to server",
        "connection refused",
        "operation timed out",
        "connection timed out",
        "no route to host",
        "network is unreachable",
    ]
    .iter()
    .any(|message| normalized.contains(message))
}

fn should_report_server_unavailable(request: &SpeedTestRequest, detail: &str) -> bool {
    request.server_mode == ServerMode::Existing || is_server_unavailable(detail)
}

fn parse_error_line(line: &str) -> Option<String> {
    let root = serde_json::from_str::<Value>(line).ok()?;
    if root.get("event").and_then(Value::as_str) != Some("error") {
        return None;
    }
    let data = root.get("data")?;
    let detail = data.as_str().or_else(|| {
        data.get("message")
            .or_else(|| data.get("error"))
            .and_then(Value::as_str)
    })?;
    let detail = detail.trim();
    (!detail.is_empty()).then(|| detail.to_owned())
}

fn resolve_iperf3_binary() -> Result<PathBuf, String> {
    let mut candidates = Vec::new();
    if let Some(configured) = env::var_os("IPERF3_PATH") {
        candidates.push(PathBuf::from(configured));
    }
    if let Some(path) = env::var_os("PATH") {
        candidates.extend(env::split_paths(&path).map(|directory| directory.join("iperf3")));
    }
    candidates.extend([
        PathBuf::from("/opt/homebrew/bin/iperf3"),
        PathBuf::from("/usr/local/bin/iperf3"),
        PathBuf::from("/usr/bin/iperf3"),
    ]);

    candidates
        .into_iter()
        .find(|candidate| candidate.is_file())
        .ok_or_else(|| "本机未找到 iperf3；请使用 Homebrew 安装，或设置 IPERF3_PATH".into())
}

async fn wait_for_cancel(cancel: &mut watch::Receiver<bool>) {
    if *cancel.borrow() {
        return;
    }
    while cancel.changed().await.is_ok() {
        if *cancel.borrow() {
            return;
        }
    }
}

fn parse_ping_latency(line: &str) -> Option<f64> {
    let (marker, offset) = if let Some(index) = line.find("time=") {
        (index, 5)
    } else {
        let index = line.find("time<")?;
        (index, 5)
    };
    let value = line[marker + offset..]
        .trim_start()
        .chars()
        .take_while(|character| character.is_ascii_digit() || *character == '.')
        .collect::<String>()
        .parse::<f64>()
        .ok()?;
    (value.is_finite() && value >= 0.0).then_some(value)
}

fn spawn_ping(host: &str, metrics: Arc<Mutex<PingMetrics>>) -> Option<(Child, JoinHandle<()>)> {
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
        let mut lines = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let Some(latency_ms) = parse_ping_latency(&line) else {
                continue;
            };
            let mut current = metrics.lock().await;
            current.jitter_ms = current
                .latency_ms
                .map(|previous| (latency_ms - previous).abs());
            current.latency_ms = Some(latency_ms);
            current.updated_at = Some(Instant::now());
        }
    });
    Some((child, task))
}

async fn stop_ping(process: &mut Option<(Child, JoinHandle<()>)>) {
    if let Some((mut child, task)) = process.take() {
        let _ = child.start_kill();
        let _ = timeout(Duration::from_secs(1), child.wait()).await;
        task.abort();
    }
}

fn client_args(
    request: &SpeedTestRequest,
    direction: TransferDirection,
    protocol: TransportProtocol,
    parallel_streams: u8,
    duration_seconds: u16,
) -> Vec<String> {
    let mut args = vec![
        "-c".into(),
        request.host.trim().into(),
        "-p".into(),
        request.iperf_port.to_string(),
        "--json-stream".into(),
        "-i".into(),
        REPORT_INTERVAL_SECONDS.into(),
        "-t".into(),
        duration_seconds.to_string(),
        "-P".into(),
        parallel_streams.to_string(),
    ];
    if protocol == TransportProtocol::Udp {
        args.extend(["-u".into(), "-b".into(), "0".into()]);
    }
    if direction == TransferDirection::Download {
        args.push("-R".into());
    }
    args
}

pub async fn run_local_client(
    app: &AppHandle,
    request: &SpeedTestRequest,
    direction: TransferDirection,
    protocol: TransportProtocol,
    parallel_streams: u8,
    duration_seconds: u16,
    cancel: &mut watch::Receiver<bool>,
) -> Result<(), RunError> {
    let binary = resolve_iperf3_binary().map_err(RunError::Message)?;
    let mut command = Command::new(binary);
    command
        .args(client_args(
            request,
            direction,
            protocol,
            parallel_streams,
            duration_seconds,
        ))
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);

    let mut child = command
        .spawn()
        .map_err(|err| RunError::Message(format!("启动本地 iperf3 失败：{err}")))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| RunError::Message("无法读取 iperf3 标准输出".into()))?;
    let mut stderr = child
        .stderr
        .take()
        .ok_or_else(|| RunError::Message("无法读取 iperf3 错误输出".into()))?;

    let ping_metrics = Arc::new(Mutex::new(PingMetrics::default()));
    let mut ping_process = spawn_ping(request.host.trim(), ping_metrics.clone());

    let app_for_output = app.clone();
    let stdout_task = tauri::async_runtime::spawn(async move {
        let mut lines = BufReader::new(stdout).lines();
        let mut output = ClientOutput::default();
        let mut previous_latency_ms = None;
        while let Ok(Some(line)) = lines.next_line().await {
            if let Some(mut sample) = parse_sample(&line, direction) {
                if let Some((latency_ms, jitter_ms)) = ping_metrics.lock().await.fresh_values() {
                    sample.latency_ms = Some(latency_ms);
                    if protocol == TransportProtocol::Tcp {
                        sample.jitter_ms = jitter_ms;
                    }
                }
                add_tcp_latency_jitter(&mut sample, &mut previous_latency_ms);
                output.sample_count += 1;
                let _ = app_for_output.emit("speed://sample", sample);
            } else if let Some(error) = parse_error_line(&line) {
                output.error = Some(error);
            }
        }
        output
    });
    let stderr_task = tauri::async_runtime::spawn(async move {
        let mut output = String::new();
        let _ = stderr.read_to_string(&mut output).await;
        output
    });

    let cancelled = tokio::select! {
        _ = wait_for_cancel(cancel) => {
            let _ = child.start_kill();
            let _ = timeout(Duration::from_secs(2), child.wait()).await;
            true
        }
        result = child.wait() => {
            let status = result
                .map_err(|err| RunError::Message(format!("等待本地 iperf3 退出失败：{err}")))?;
            if !status.success() {
                let stderr = stderr_task.await.unwrap_or_default();
                let stdout = stdout_task.await.unwrap_or_default();
                let detail = if stderr.trim().is_empty() {
                    stdout.error.as_deref().unwrap_or_default()
                } else {
                    stderr.trim()
                };
                let error = if detail.contains("unrecognized option") && detail.contains("json-stream") {
                    RunError::Message(
                        "本机 iperf3 版本过旧，不支持实时 JSON；请升级到 iperf3 3.17 或更高版本".into()
                    )
                } else if should_report_server_unavailable(request, detail) {
                    RunError::ServerUnavailable
                } else if detail.is_empty() {
                    RunError::Message(format!("iperf3 异常退出：{status}"))
                } else {
                    RunError::Message(format!("iperf3 测速失败：{detail}"))
                };
                stop_ping(&mut ping_process).await;
                return Err(error);
            }
            false
        }
    };

    stop_ping(&mut ping_process).await;
    let stdout = stdout_task.await.unwrap_or_default();
    if cancelled {
        let _ = stderr_task.await;
        return Err(RunError::Cancelled);
    }

    let stderr = stderr_task.await.unwrap_or_default();
    if stdout.sample_count == 0 {
        let detail = if stderr.trim().is_empty() {
            stdout.error.as_deref().unwrap_or_default()
        } else {
            stderr.trim()
        };
        if should_report_server_unavailable(request, detail) {
            return Err(RunError::ServerUnavailable);
        }
        return Err(RunError::Message(if detail.is_empty() {
            "iperf3 已结束，但没有产生实时采样".into()
        } else {
            format!("iperf3 没有产生采样：{detail}")
        }));
    }

    Ok(())
}

fn add_tcp_latency_jitter(sample: &mut SpeedSampleEvent, previous_latency_ms: &mut Option<f64>) {
    let Some(latency_ms) = sample.latency_ms else {
        return;
    };
    if sample.jitter_ms.is_none() {
        sample.jitter_ms = previous_latency_ms.map(|previous| (latency_ms - previous).abs());
    }
    *previous_latency_ms = Some(latency_ms);
}

pub fn parse_sample(line: &str, direction: TransferDirection) -> Option<SpeedSampleEvent> {
    let root = serde_json::from_str::<Value>(line).ok()?;
    if root
        .get("event")
        .and_then(Value::as_str)
        .is_some_and(|event| event != "interval")
    {
        return None;
    }

    let data = root.get("data").unwrap_or(&root);
    let interval = data
        .get("interval")
        .or_else(|| data.get("intervals").and_then(|intervals| intervals.get(0)))
        .unwrap_or(data);
    let summary = interval
        .get("sum")
        .or_else(|| interval.get("sum_received"))
        .or_else(|| interval.get("sum_sent"))
        .unwrap_or(interval);
    let elapsed = summary
        .get("end")
        .and_then(Value::as_f64)
        .or_else(|| summary.get("seconds").and_then(Value::as_f64))
        .unwrap_or_default();
    let bytes = summary
        .get("bytes")
        .and_then(Value::as_u64)
        .unwrap_or_default();
    let reported_bandwidth = summary
        .get("bits_per_second")
        .and_then(Value::as_f64)
        .filter(|value| value.is_finite());
    let bandwidth_bps = reported_bandwidth
        .filter(|value| *value > 0.0)
        .or_else(|| {
            let seconds = summary.get("seconds").and_then(Value::as_f64)?;
            (bytes > 0 && seconds > 0.0).then_some(bytes as f64 * 8.0 / seconds)
        })
        .or_else(|| {
            let total = interval
                .get("streams")
                .and_then(Value::as_array)?
                .iter()
                .filter_map(|stream| stream.get("bits_per_second").and_then(Value::as_f64))
                .filter(|value| value.is_finite() && *value > 0.0)
                .sum::<f64>();
            (total > 0.0).then_some(total)
        })
        .or(reported_bandwidth)?;
    let retransmits = summary.get("retransmits").and_then(Value::as_u64);
    let jitter_ms = summary
        .get("jitter_ms")
        .and_then(Value::as_f64)
        .filter(|value| value.is_finite() && *value >= 0.0)
        .or_else(|| {
            let samples: Vec<f64> = interval
                .get("streams")
                .and_then(Value::as_array)?
                .iter()
                .filter_map(|stream| stream.get("rttvar").and_then(Value::as_f64))
                .filter(|value| value.is_finite() && *value > 0.0)
                .collect();
            (!samples.is_empty()).then(|| samples.iter().sum::<f64>() / samples.len() as f64)
        });
    let latency_ms = interval
        .get("streams")
        .and_then(Value::as_array)
        .and_then(|streams| {
            let samples: Vec<f64> = streams
                .iter()
                .filter_map(|stream| stream.get("rtt").and_then(Value::as_f64))
                .filter(|value| value.is_finite() && *value > 0.0)
                .collect();
            (!samples.is_empty()).then(|| samples.iter().sum::<f64>() / samples.len() as f64)
        })
        .or_else(|| {
            summary
                .get("mean_rtt")
                .or_else(|| summary.get("rtt"))
                .and_then(Value::as_f64)
                .filter(|milliseconds| milliseconds.is_finite() && *milliseconds > 0.0)
        });

    Some(SpeedSampleEvent {
        elapsed,
        bandwidth_bps,
        bytes,
        latency_ms,
        jitter_ms,
        retransmits,
        direction,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{ServerMode, SshAuthMethod, TestMode};

    fn request() -> SpeedTestRequest {
        SpeedTestRequest {
            host: "10.0.0.8".into(),
            ssh_port: 22,
            iperf_port: 5201,
            remote_iperf_path: String::new(),
            server_mode: ServerMode::SshManaged,
            username: "tester".into(),
            password: "secret".into(),
            auth_method: SshAuthMethod::Password,
            private_key_path: String::new(),
            passphrase: String::new(),
            test_mode: TestMode::Advanced,
            direction: TransferDirection::Upload,
            protocol: TransportProtocol::Tcp,
            parallel_streams: 1,
            duration_seconds: 10,
            reuse_existing_server: false,
            allow_host_key_mismatch: false,
        }
    }

    #[test]
    fn parses_json_stream_interval() {
        let line = r#"{"event":"interval","data":{"streams":[{"end":1.001,"rtt":13,"rttvar":7}],"sum":{"end":1.001,"seconds":1.001,"bytes":125000000,"bits_per_second":998500000.0,"retransmits":2,"sender":true}}}"#;
        let sample = parse_sample(line, TransferDirection::Upload).expect("interval sample");

        assert_eq!(sample.elapsed, 1.001);
        assert_eq!(sample.bandwidth_bps, 998_500_000.0);
        assert_eq!(sample.bytes, 125_000_000);
        assert_eq!(sample.retransmits, Some(2));
        assert_eq!(sample.latency_ms, Some(13.0));
        assert_eq!(sample.jitter_ms, Some(7.0));
    }

    #[test]
    fn parses_macos_and_linux_ping_latency() {
        assert_eq!(
            parse_ping_latency("64 bytes from 192.168.11.1: icmp_seq=3 ttl=64 time=6.276 ms"),
            Some(6.276)
        );
        assert_eq!(
            parse_ping_latency("64 bytes from 127.0.0.1: icmp_seq=0 ttl=64 time<1 ms"),
            Some(1.0)
        );
        assert_eq!(parse_ping_latency("Request timeout for icmp_seq 4"), None);
    }

    #[test]
    fn recognizes_unavailable_iperf3_server_errors() {
        assert!(is_server_unavailable(
            "iperf3: error - unable to connect to server: Connection refused"
        ));
        assert!(is_server_unavailable(
            "iperf3: error - unable to connect to server: Operation timed out"
        ));
        assert!(is_server_unavailable("connect failed: No route to host"));
        assert!(!is_server_unavailable("unrecognized option --json-stream"));
    }

    #[test]
    fn parses_json_stream_error_events() {
        let line = r#"{"event":"error","data":"unable to connect to server: Connection refused"}"#;
        assert_eq!(
            parse_error_line(line).as_deref(),
            Some("unable to connect to server: Connection refused")
        );
        assert!(parse_error_line(r#"{"event":"end","data":{}}"#).is_none());
    }

    #[test]
    fn treats_any_failed_connection_as_unavailable_in_direct_mode() {
        let mut request = request();
        request.server_mode = ServerMode::Existing;

        assert!(should_report_server_unavailable(&request, ""));
        assert!(should_report_server_unavailable(&request, "exit status: 1"));
    }

    #[test]
    fn recovers_zero_bandwidth_from_interval_bytes() {
        let line = r#"{"event":"interval","data":{"streams":[],"sum":{"end":1.5,"seconds":0.5,"bytes":50000000,"bits_per_second":0.0}}}"#;
        let sample = parse_sample(line, TransferDirection::Download).expect("interval sample");

        assert_eq!(sample.bandwidth_bps, 800_000_000.0);
    }

    #[test]
    fn recovers_zero_bandwidth_from_parallel_streams() {
        let line = r#"{"event":"interval","data":{"streams":[{"bits_per_second":310000000.0},{"bits_per_second":290000000.0}],"sum":{"end":1.5,"seconds":0.5,"bytes":0,"bits_per_second":0.0}}}"#;
        let sample = parse_sample(line, TransferDirection::Upload).expect("interval sample");

        assert_eq!(sample.bandwidth_bps, 600_000_000.0);
    }

    #[test]
    fn derives_tcp_jitter_from_consecutive_rtt_samples() {
        let mut previous = None;
        let mut first = SpeedSampleEvent {
            elapsed: 0.5,
            bandwidth_bps: 1.0,
            bytes: 1,
            latency_ms: Some(3.2),
            jitter_ms: None,
            retransmits: None,
            direction: TransferDirection::Upload,
        };
        let mut second = SpeedSampleEvent {
            elapsed: 1.0,
            latency_ms: Some(4.1),
            ..first.clone()
        };

        add_tcp_latency_jitter(&mut first, &mut previous);
        add_tcp_latency_jitter(&mut second, &mut previous);

        assert_eq!(first.jitter_ms, None);
        assert!((second.jitter_ms.expect("derived jitter") - 0.9).abs() < 1e-9);
    }

    #[test]
    fn ignores_non_interval_events() {
        let line = r#"{"event":"start","data":{"version":"iperf 3.21"}}"#;
        assert!(parse_sample(line, TransferDirection::Download).is_none());
    }

    #[test]
    fn serializes_frontend_field_names() {
        let sample = SpeedSampleEvent {
            elapsed: 1.0,
            bandwidth_bps: 42.0,
            bytes: 7,
            latency_ms: Some(1.2),
            jitter_ms: None,
            retransmits: None,
            direction: TransferDirection::Upload,
        };
        let value = serde_json::to_value(sample).expect("serialize event");

        assert_eq!(value["bandwidthBps"], 42.0);
        assert_eq!(value["latencyMs"], 1.2);
        assert!(value.get("bandwidth_bps").is_none());
    }

    #[test]
    fn builds_advanced_udp_download_arguments() {
        let args = client_args(
            &request(),
            TransferDirection::Download,
            TransportProtocol::Udp,
            8,
            30,
        );

        assert!(args.windows(2).any(|pair| pair == ["-P", "8"]));
        assert!(args
            .windows(2)
            .any(|pair| pair == ["-i", REPORT_INTERVAL_SECONDS]));
        assert!(args.windows(2).any(|pair| pair == ["-t", "30"]));
        assert!(args.windows(2).any(|pair| pair == ["-b", "0"]));
        assert!(args.iter().any(|argument| argument == "-u"));
        assert!(args.iter().any(|argument| argument == "-R"));
    }

    #[test]
    fn builds_continuous_duration_arguments() {
        let args = client_args(
            &request(),
            TransferDirection::Upload,
            TransportProtocol::Tcp,
            4,
            0,
        );

        assert!(args.windows(2).any(|pair| pair == ["-t", "0"]));
    }
}
