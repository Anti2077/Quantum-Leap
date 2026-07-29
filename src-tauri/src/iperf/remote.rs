use super::{
    execution::{
        bind_unsupported_error, client_args, is_server_unavailable, parse_error_line,
        rejects_bind_option, ClientOutput, RunError,
    },
    parser::{add_tcp_latency_jitter, parse_sample, parse_text_sample},
};
use crate::{
    model::{RemoteTarget, TransferDirection, TransportProtocol},
    ssh::{connect, parse_remote_iperf_error, remote_client_command, SshError, CLIENT_PID_MARKER},
};
use std::{
    io::{BufRead as _, BufReader, Read as _},
    sync::{
        atomic::{AtomicBool, AtomicU32, Ordering},
        Arc,
    },
};
use tauri::{AppHandle, Emitter};

#[allow(clippy::too_many_arguments)]
fn run_blocking(
    app: &AppHandle,
    client: &RemoteTarget,
    target_host: &str,
    iperf_port: u16,
    direction: TransferDirection,
    protocol: TransportProtocol,
    parallel_streams: u8,
    duration_seconds: u16,
    target_bitrate_bps: u64,
    cancel: &AtomicBool,
    remote_pid: &AtomicU32,
) -> Result<(), RunError> {
    remote_pid.store(0, Ordering::Release);
    if cancel.load(Ordering::Acquire) {
        return Err(RunError::Cancelled);
    }
    let args = client_args(
        target_host,
        &client.bind_ip,
        iperf_port,
        direction,
        protocol,
        parallel_streams,
        duration_seconds,
        target_bitrate_bps,
        true,
    );
    let command = remote_client_command(client, &args);
    let session = connect(client).map_err(RunError::Remote)?;
    if cancel.load(Ordering::Acquire) {
        return Err(RunError::Cancelled);
    }
    let mut channel = session.channel_session().map_err(|error| {
        RunError::Remote(SshError::Message(format!(
            "打开测速发起端 SSH 通道失败：{error}"
        )))
    })?;
    channel.exec(&command).map_err(|error| {
        RunError::Remote(SshError::Message(format!(
            "执行远端 iperf3 client 失败：{error}"
        )))
    })?;

    let mut output = ClientOutput::default();
    let mut previous_latency_ms = None;
    let mut received_pid_marker = false;
    {
        let mut reader = BufReader::new(&mut channel);
        loop {
            if received_pid_marker && cancel.load(Ordering::Acquire) {
                break;
            }
            let mut line = String::new();
            let bytes = reader.read_line(&mut line).map_err(|error| {
                if cancel.load(Ordering::Acquire) {
                    RunError::Cancelled
                } else {
                    RunError::Message(format!("读取远端 iperf3 输出失败：{error}"))
                }
            })?;
            if bytes == 0 {
                break;
            }
            let line = line.trim_end_matches(['\r', '\n']);
            if let Some(pid) = line
                .strip_prefix(CLIENT_PID_MARKER)
                .and_then(|value| value.trim().parse::<u32>().ok())
            {
                remote_pid.store(pid, Ordering::Release);
                received_pid_marker = true;
                if cancel.load(Ordering::Acquire) {
                    break;
                }
                continue;
            }
            if let Some(mut sample) = parse_sample(line, direction)
                .or_else(|| parse_text_sample(line, direction, parallel_streams))
            {
                add_tcp_latency_jitter(&mut sample, &mut previous_latency_ms);
                output.sample_count += 1;
                let _ = app.emit("speed://sample", sample);
            } else if let Some(error) = parse_error_line(line) {
                output.error = Some(error);
            }
        }
    }

    if cancel.load(Ordering::Acquire) {
        let _ = channel.close();
        let _ = channel.wait_close();
        return Err(RunError::Cancelled);
    }

    let mut stderr = String::new();
    channel
        .stderr()
        .read_to_string(&mut stderr)
        .map_err(|error| RunError::Message(format!("读取远端 iperf3 错误输出失败：{error}")))?;
    channel
        .wait_close()
        .map_err(|error| RunError::Message(format!("关闭测速发起端 SSH 通道失败：{error}")))?;
    let status = channel
        .exit_status()
        .map_err(|error| RunError::Message(format!("读取远端 iperf3 退出状态失败：{error}")))?;
    let detail = if stderr.trim().is_empty() {
        output.error.as_deref().unwrap_or_default()
    } else {
        stderr.trim()
    };

    if status != 0 {
        if stderr.contains("IPERF3_PATH_INVALID:") || stderr.contains("IPERF3_NOT_FOUND:") {
            return Err(RunError::Remote(parse_remote_iperf_error(
                &stderr,
                status,
                "测速发起端 iperf3 启动",
            )));
        }
        if !client.bind_ip.is_empty() && rejects_bind_option(detail) {
            return Err(bind_unsupported_error("测速发起端", detail));
        }
        if is_server_unavailable(detail) {
            return Err(RunError::ServerUnavailable);
        }
        return Err(RunError::Message(if detail.is_empty() {
            format!("远端 iperf3 client 异常退出（退出码 {status}）")
        } else {
            format!("远端 iperf3 测速失败：{detail}")
        }));
    }

    if output.sample_count == 0 {
        if !client.bind_ip.is_empty() && rejects_bind_option(detail) {
            return Err(bind_unsupported_error("测速发起端", detail));
        }
        if is_server_unavailable(detail) {
            return Err(RunError::ServerUnavailable);
        }
        return Err(RunError::Message(if detail.is_empty() {
            "远端 iperf3 已结束，但没有产生实时采样".into()
        } else {
            format!("远端 iperf3 没有产生采样：{detail}")
        }));
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
pub async fn run_remote_client(
    app: &AppHandle,
    client: &RemoteTarget,
    target_host: &str,
    iperf_port: u16,
    direction: TransferDirection,
    protocol: TransportProtocol,
    parallel_streams: u8,
    duration_seconds: u16,
    target_bitrate_bps: u64,
    cancel: Arc<AtomicBool>,
    remote_pid: Arc<AtomicU32>,
) -> Result<(), RunError> {
    let app = app.clone();
    let client = client.clone();
    let target_host = target_host.to_owned();
    tauri::async_runtime::spawn_blocking(move || {
        run_blocking(
            &app,
            &client,
            &target_host,
            iperf_port,
            direction,
            protocol,
            parallel_streams,
            duration_seconds,
            target_bitrate_bps,
            &cancel,
            &remote_pid,
        )
    })
    .await
    .map_err(|error| RunError::Message(format!("远端测速任务异常结束：{error}")))?
}
