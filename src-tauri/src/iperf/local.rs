use super::{
    execution::{
        bind_unsupported_error, client_args, local_iperf_command, parse_error_line,
        rejects_bind_option, should_report_server_unavailable, wait_for_cancel, ClientOutput,
        LineBuffer, RunError,
    },
    latency::{spawn_ping, stop_ping, PingMetrics},
    parser::{add_tcp_latency_jitter, parse_sample, parse_text_sample, parse_udp_receiver_summary},
};
use crate::model::{
    SpeedTestRequest, TransferDirection, TransportProtocol, SPEED_SAMPLE_EVENT, SPEED_SUMMARY_EVENT,
};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tauri_plugin_shell::process::CommandEvent;
use tokio::sync::{watch, Mutex};

async fn supports_json_stream(app: &AppHandle) -> bool {
    let Ok(command) = local_iperf_command(app) else {
        return false;
    };
    command
        .arg("--help")
        .output()
        .await
        .map(|output| {
            let mut help = String::from_utf8_lossy(&output.stdout).into_owned();
            help.push_str(&String::from_utf8_lossy(&output.stderr));
            help.contains("--json-stream")
        })
        .unwrap_or(false)
}

#[allow(clippy::too_many_arguments)]
async fn process_output_line(
    line: &[u8],
    app: &AppHandle,
    output: &mut ClientOutput,
    previous_latency_ms: &mut Option<f64>,
    ping_metrics: &Arc<Mutex<PingMetrics>>,
    direction: TransferDirection,
    protocol: TransportProtocol,
    parallel_streams: u8,
) {
    let line = String::from_utf8_lossy(line);
    if protocol == TransportProtocol::Udp {
        if let Some(summary) = parse_udp_receiver_summary(&line, direction, parallel_streams) {
            let _ = app.emit(SPEED_SUMMARY_EVENT, summary);
            return;
        }
        if line.trim_end().ends_with("sender") || line.trim_end().ends_with("receiver") {
            return;
        }
    }
    if let Some(mut sample) = parse_sample(&line, direction)
        .or_else(|| parse_text_sample(&line, direction, parallel_streams))
    {
        if sample.latency_ms.is_none() {
            if let Some((latency_ms, jitter_ms)) = ping_metrics.lock().await.fresh_values() {
                sample.latency_ms = Some(latency_ms);
                if protocol == TransportProtocol::Tcp && sample.jitter_ms.is_none() {
                    sample.jitter_ms = jitter_ms;
                }
            }
        }
        if protocol == TransportProtocol::Tcp {
            add_tcp_latency_jitter(&mut sample, previous_latency_ms);
        }
        output.sample_count += 1;
        let _ = app.emit(SPEED_SAMPLE_EVENT, sample);
    } else if let Some(error) = parse_error_line(&line) {
        output.error = Some(error);
    }
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
    let json_stream = supports_json_stream(app).await;
    let command = local_iperf_command(app)
        .map_err(RunError::Message)?
        .args(client_args(
            request.target_host(),
            request.client_bind_ip(),
            request.iperf_port,
            direction,
            protocol,
            parallel_streams,
            duration_seconds,
            request.target_bitrate_bps,
            json_stream,
        ))
        .set_raw_out(true);

    let (mut events, child) = command
        .spawn()
        .map_err(|err| RunError::Message(format!("启动本地 iperf3 失败：{err}")))?;
    let mut child = Some(child);
    let ping_metrics = Arc::new(Mutex::new(PingMetrics::default()));
    let mut ping_process = spawn_ping(request.target_host(), ping_metrics.clone());
    let mut stdout = LineBuffer::default();
    let mut stderr = Vec::new();
    let mut output = ClientOutput::default();
    let mut previous_latency_ms = None;
    let mut exit_code = None;
    let mut shell_error = None;

    let cancelled = loop {
        tokio::select! {
            _ = wait_for_cancel(cancel) => {
                if let Some(child) = child.take() {
                    let _ = child.kill();
                }
                break true;
            }
            event = events.recv() => match event {
                Some(CommandEvent::Stdout(chunk)) => {
                    for line in stdout.push(&chunk) {
                        process_output_line(
                            &line,
                            app,
                            &mut output,
                            &mut previous_latency_ms,
                            &ping_metrics,
                            direction,
                            protocol,
                            parallel_streams,
                        ).await;
                    }
                }
                Some(CommandEvent::Stderr(chunk)) => stderr.extend_from_slice(&chunk),
                Some(CommandEvent::Error(error)) => shell_error = Some(error),
                Some(CommandEvent::Terminated(status)) => {
                    exit_code = status.code;
                    break false;
                }
                Some(_) => continue,
                None => break false,
            }
        }
    };

    stop_ping(&mut ping_process).await;
    if let Some(line) = stdout.finish() {
        process_output_line(
            &line,
            app,
            &mut output,
            &mut previous_latency_ms,
            &ping_metrics,
            direction,
            protocol,
            parallel_streams,
        )
        .await;
    }
    if cancelled {
        return Err(RunError::Cancelled);
    }

    let stderr = String::from_utf8_lossy(&stderr);
    let detail = if stderr.trim().is_empty() {
        output
            .error
            .as_deref()
            .or(shell_error.as_deref())
            .unwrap_or_default()
    } else {
        stderr.trim()
    };
    if exit_code != Some(0) {
        return Err(
            if !request.client_bind_ip().is_empty() && rejects_bind_option(detail) {
                bind_unsupported_error("本机客户端", detail)
            } else if should_report_server_unavailable(request, detail) {
                RunError::ServerUnavailable
            } else if detail.is_empty() {
                RunError::Message(format!("iperf3 异常退出：{}", exit_code.unwrap_or(-1)))
            } else {
                RunError::Message(format!("iperf3 测速失败：{detail}"))
            },
        );
    }
    if output.sample_count == 0 {
        if !request.client_bind_ip().is_empty() && rejects_bind_option(detail) {
            return Err(bind_unsupported_error("本机客户端", detail));
        }
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
