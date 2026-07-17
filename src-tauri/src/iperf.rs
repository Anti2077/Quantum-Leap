use crate::model::{SpeedSampleEvent, SpeedTestRequest, TransferDirection, TransportProtocol};
use serde_json::Value;
use std::{env, path::PathBuf, process::Stdio};
use tauri::{AppHandle, Emitter};
use tokio::{
    io::{AsyncBufReadExt, AsyncReadExt, BufReader},
    process::Command,
    sync::watch,
    time::{timeout, Duration},
};

#[derive(Debug)]
pub enum RunError {
    Cancelled,
    Message(String),
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
        "1".into(),
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

    let app_for_output = app.clone();
    let stdout_task = tauri::async_runtime::spawn(async move {
        let mut lines = BufReader::new(stdout).lines();
        let mut sample_count = 0_u32;
        while let Ok(Some(line)) = lines.next_line().await {
            if let Some(sample) = parse_sample(&line, direction) {
                sample_count += 1;
                let _ = app_for_output.emit("speed://sample", sample);
            }
        }
        sample_count
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
                let detail = stderr.trim();
                let message = if detail.contains("unrecognized option") && detail.contains("json-stream") {
                    "本机 iperf3 版本过旧，不支持实时 JSON；请升级到 iperf3 3.17 或更高版本".into()
                } else if detail.is_empty() {
                    format!("iperf3 异常退出：{status}")
                } else {
                    format!("iperf3 测速失败：{detail}")
                };
                let _ = stdout_task.await;
                return Err(RunError::Message(message));
            }
            false
        }
    };

    let sample_count = stdout_task.await.unwrap_or_default();
    if cancelled {
        let _ = stderr_task.await;
        return Err(RunError::Cancelled);
    }

    let stderr = stderr_task.await.unwrap_or_default();
    if sample_count == 0 {
        let detail = stderr.trim();
        return Err(RunError::Message(if detail.is_empty() {
            "iperf3 已结束，但没有产生实时采样".into()
        } else {
            format!("iperf3 没有产生采样：{detail}")
        }));
    }

    Ok(())
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
    let bandwidth_bps = summary.get("bits_per_second")?.as_f64()?;
    let elapsed = summary
        .get("end")
        .and_then(Value::as_f64)
        .or_else(|| summary.get("seconds").and_then(Value::as_f64))
        .unwrap_or_default();
    let bytes = summary
        .get("bytes")
        .and_then(Value::as_u64)
        .unwrap_or_default();
    let retransmits = summary.get("retransmits").and_then(Value::as_u64);
    let jitter_ms = summary.get("jitter_ms").and_then(Value::as_f64);
    let latency_ms = interval
        .get("streams")
        .and_then(Value::as_array)
        .and_then(|streams| {
            let samples: Vec<f64> = streams
                .iter()
                .filter_map(|stream| stream.get("rtt").and_then(Value::as_f64))
                .collect();
            (!samples.is_empty())
                .then(|| samples.iter().sum::<f64>() / samples.len() as f64 / 1000.0)
        })
        .or_else(|| {
            summary
                .get("mean_rtt")
                .or_else(|| summary.get("rtt"))
                .and_then(Value::as_f64)
                .map(|microseconds| microseconds / 1000.0)
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
    use crate::model::TestMode;

    fn request() -> SpeedTestRequest {
        SpeedTestRequest {
            host: "10.0.0.8".into(),
            ssh_port: 22,
            iperf_port: 5201,
            username: "tester".into(),
            password: "secret".into(),
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
        let line = r#"{"event":"interval","data":{"streams":[{"end":1.001,"rtt":742}],"sum":{"end":1.001,"seconds":1.001,"bytes":125000000,"bits_per_second":998500000.0,"retransmits":2,"sender":true}}}"#;
        let sample = parse_sample(line, TransferDirection::Upload).expect("interval sample");

        assert_eq!(sample.elapsed, 1.001);
        assert_eq!(sample.bandwidth_bps, 998_500_000.0);
        assert_eq!(sample.bytes, 125_000_000);
        assert_eq!(sample.retransmits, Some(2));
        assert_eq!(sample.latency_ms, Some(0.742));
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
        assert!(args.windows(2).any(|pair| pair == ["-t", "30"]));
        assert!(args.windows(2).any(|pair| pair == ["-b", "0"]));
        assert!(args.iter().any(|argument| argument == "-u"));
        assert!(args.iter().any(|argument| argument == "-R"));
    }
}
