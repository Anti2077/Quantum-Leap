use crate::model::{
    RemoteTarget, ServerMode, SpeedSampleEvent, SpeedTestRequest, TransferDirection,
    TransportProtocol,
};
use crate::ssh::{
    connect, parse_remote_iperf_error, remote_client_command, SshError, CLIENT_PID_MARKER,
};
use serde_json::Value;
use std::{
    env, fs,
    io::{BufRead as _, BufReader as StdBufReader, Read as _},
    path::PathBuf,
    process::Stdio,
    sync::{
        atomic::{AtomicBool, AtomicU32, Ordering},
        Arc,
    },
    time::Instant,
};
use tauri::{async_runtime::JoinHandle, AppHandle, Emitter};
use tauri_plugin_shell::{
    process::{Command as ShellCommand, CommandEvent},
    ShellExt,
};
use tokio::{
    io::{AsyncBufReadExt, BufReader},
    process::{Child, Command},
    sync::{watch, Mutex},
    time::{timeout, Duration},
};

const REPORT_INTERVAL_SECONDS: &str = "0.5";
const IPERF3_SIDECAR: &str = "iperf3";

#[derive(Debug, PartialEq, Eq)]
enum LocalIperfSource {
    Explicit(PathBuf),
    Bundled,
    System,
}

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

#[derive(Default)]
struct LineBuffer {
    pending: Vec<u8>,
}

impl LineBuffer {
    fn push(&mut self, chunk: &[u8]) -> Vec<Vec<u8>> {
        self.pending.extend_from_slice(chunk);
        let mut lines = Vec::new();
        while let Some(index) = self.pending.iter().position(|byte| *byte == b'\n') {
            let mut line = self.pending.drain(..=index).collect::<Vec<_>>();
            line.pop();
            if line.last() == Some(&b'\r') {
                line.pop();
            }
            lines.push(line);
        }
        lines
    }

    fn finish(&mut self) -> Option<Vec<u8>> {
        if self.pending.is_empty() {
            None
        } else {
            Some(std::mem::take(&mut self.pending))
        }
    }
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
    Remote(SshError),
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

fn rejects_bind_option(detail: &str) -> bool {
    let normalized = detail.to_ascii_lowercase();
    let rejects_option = [
        "unrecognized option",
        "unknown option",
        "invalid option",
        "illegal option",
    ]
    .iter()
    .any(|message| normalized.contains(message));
    rejects_option
        && (normalized.contains("--bind")
            || normalized.contains("option -- 'b'")
            || normalized.contains("option -- b")
            || normalized.contains("option: b"))
}

fn bind_unsupported_error(endpoint: &str, detail: &str) -> RunError {
    RunError::Message(format!(
        "{endpoint} iperf3 不支持绑定 IP（-B）：{}",
        detail.trim()
    ))
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

fn configured_iperf3_binary() -> Result<Option<PathBuf>, String> {
    let Some(configured) = env::var_os("IPERF3_PATH") else {
        return Ok(None);
    };
    let path = PathBuf::from(configured);
    if is_executable(&path) {
        Ok(Some(path))
    } else {
        Err(format!(
            "IPERF3_PATH 指向的文件不可执行：{}",
            path.display()
        ))
    }
}

fn select_local_iperf_source(
    configured: Option<PathBuf>,
    use_bundled_default: bool,
) -> LocalIperfSource {
    match configured {
        Some(path) => LocalIperfSource::Explicit(path),
        None if use_bundled_default => LocalIperfSource::Bundled,
        None => LocalIperfSource::System,
    }
}

#[cfg(target_os = "macos")]
fn resolve_iperf3_binary() -> Result<PathBuf, String> {
    let mut candidates = Vec::new();
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
        .find(is_executable)
        .ok_or_else(|| "本机未找到 iperf3；请使用 Homebrew 安装，或设置 IPERF3_PATH".into())
}

fn local_iperf_command(app: &AppHandle) -> Result<ShellCommand, String> {
    match select_local_iperf_source(
        configured_iperf3_binary()?,
        cfg!(any(target_os = "linux", target_os = "windows")),
    ) {
        LocalIperfSource::Explicit(binary) => Ok(app.shell().command(binary)),
        LocalIperfSource::Bundled => app
            .shell()
            .sidecar(IPERF3_SIDECAR)
            .map_err(|error| format!("内置 iperf3 不可用，应用安装可能不完整：{error}")),
        LocalIperfSource::System => {
            #[cfg(target_os = "macos")]
            {
                let binary = resolve_iperf3_binary()?;
                Ok(app.shell().command(binary))
            }
            #[cfg(not(target_os = "macos"))]
            {
                Err("内置 iperf3 不可用，应用安装可能不完整".into())
            }
        }
    }
}

fn is_executable(path: &PathBuf) -> bool {
    if !path.is_file() {
        return false;
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::metadata(path)
            .map(|metadata| metadata.permissions().mode() & 0o111 != 0)
            .unwrap_or(false)
    }

    #[cfg(not(unix))]
    {
        true
    }
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

fn parse_ping_latency(line: &[u8]) -> Option<f64> {
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

async fn stop_ping(process: &mut Option<(Child, JoinHandle<()>)>) {
    if let Some((mut child, task)) = process.take() {
        let _ = child.start_kill();
        let _ = timeout(Duration::from_secs(1), child.wait()).await;
        task.abort();
    }
}

#[allow(clippy::too_many_arguments)]
fn client_args(
    target_host: &str,
    bind_ip: &str,
    iperf_port: u16,
    direction: TransferDirection,
    protocol: TransportProtocol,
    parallel_streams: u8,
    duration_seconds: u16,
    json_stream: bool,
) -> Vec<String> {
    let mut args = vec![
        "-c".into(),
        target_host.trim().into(),
        "-p".into(),
        iperf_port.to_string(),
        "-i".into(),
        REPORT_INTERVAL_SECONDS.into(),
        "-t".into(),
        duration_seconds.to_string(),
        "-P".into(),
        parallel_streams.to_string(),
    ];
    if json_stream {
        let insert_at = 4;
        args.insert(insert_at, "--json-stream".into());
    }
    if protocol == TransportProtocol::Udp {
        args.extend(["-u".into(), "-b".into(), "0".into()]);
    }
    if direction == TransferDirection::Download {
        args.push("-R".into());
    }
    if !bind_ip.trim().is_empty() {
        args.extend(["-B".into(), bind_ip.trim().into()]);
    }
    args
}

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
async fn process_local_output_line(
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
        add_tcp_latency_jitter(&mut sample, previous_latency_ms);
        output.sample_count += 1;
        let _ = app.emit("speed://sample", sample);
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
                        process_local_output_line(
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
        process_local_output_line(
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

#[allow(clippy::too_many_arguments)]
fn run_remote_client_blocking(
    app: &AppHandle,
    client: &RemoteTarget,
    target_host: &str,
    iperf_port: u16,
    direction: TransferDirection,
    protocol: TransportProtocol,
    parallel_streams: u8,
    duration_seconds: u16,
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
        let mut reader = StdBufReader::new(&mut channel);
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
    cancel: Arc<AtomicBool>,
    remote_pid: Arc<AtomicU32>,
) -> Result<(), RunError> {
    let app = app.clone();
    let client = client.clone();
    let target_host = target_host.to_owned();
    tauri::async_runtime::spawn_blocking(move || {
        run_remote_client_blocking(
            &app,
            &client,
            &target_host,
            iperf_port,
            direction,
            protocol,
            parallel_streams,
            duration_seconds,
            &cancel,
            &remote_pid,
        )
    })
    .await
    .map_err(|error| RunError::Message(format!("远端测速任务异常结束：{error}")))?
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

fn parse_text_number(value: &str, unit: &str) -> Option<f64> {
    let value = value.parse::<f64>().ok()?;
    let multiplier = match unit.to_ascii_lowercase().as_str() {
        "bytes" => 1.0,
        "kbytes" => 1_000.0,
        "mbytes" => 1_000_000.0,
        "gbytes" => 1_000_000_000.0,
        "tbytes" => 1_000_000_000_000.0,
        "bits/sec" => 1.0,
        "kbits/sec" => 1_000.0,
        "mbits/sec" => 1_000_000.0,
        "gbits/sec" => 1_000_000_000.0,
        "tbits/sec" => 1_000_000_000_000.0,
        _ => return None,
    };
    Some(value * multiplier)
}

fn parse_text_sample(
    line: &str,
    direction: TransferDirection,
    parallel_streams: u8,
) -> Option<SpeedSampleEvent> {
    let tokens: Vec<&str> = line.split_whitespace().collect();
    if tokens.len() < 6 || !tokens.first()?.starts_with('[') {
        return None;
    }
    if parallel_streams > 1 && !tokens.first()?.contains("SUM") {
        return None;
    }

    let interval_index = tokens.iter().position(|token| {
        let Some((start, end)) = token.split_once('-') else {
            return false;
        };
        start.parse::<f64>().is_ok() && end.parse::<f64>().is_ok()
    })?;
    let (_, end) = tokens[interval_index].split_once('-')?;
    let elapsed = end.parse::<f64>().ok()?;

    let bandwidth_index = tokens
        .iter()
        .position(|token| token.to_ascii_lowercase().ends_with("bits/sec"))?;
    let bandwidth = parse_text_number(
        tokens.get(bandwidth_index.checked_sub(1)?)?,
        tokens[bandwidth_index],
    )?;

    let bytes = (interval_index + 2..bandwidth_index)
        .find_map(|index| {
            let unit = tokens.get(index)?;
            if !unit.to_ascii_lowercase().ends_with("bytes") {
                return None;
            }
            parse_text_number(tokens.get(index.checked_sub(1)?)?, unit)
        })
        .map(|value| value as u64)
        .unwrap_or_default();

    let jitter_ms = (bandwidth_index + 1..tokens.len()).find_map(|index| {
        let token = tokens.get(index)?;
        token
            .eq_ignore_ascii_case("ms")
            .then(|| {
                tokens
                    .get(index.checked_sub(1)?)
                    .and_then(|value| value.parse().ok())
            })
            .flatten()
    });
    let retransmits = tokens
        .iter()
        .position(|token| *token == "sender" || *token == "receiver")
        .and_then(|index| index.checked_sub(1))
        .and_then(|index| tokens.get(index)?.parse::<u64>().ok());

    Some(SpeedSampleEvent {
        elapsed,
        bandwidth_bps: bandwidth,
        bytes,
        latency_ms: None,
        jitter_ms,
        retransmits,
        direction,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{ServerMode, SshAuthMethod, TestMode, TestTopology};

    fn request() -> SpeedTestRequest {
        SpeedTestRequest {
            language: crate::model::UiLanguage::En,
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
            test_mode: TestMode::Advanced,
            direction: TransferDirection::Upload,
            protocol: TransportProtocol::Tcp,
            parallel_streams: 1,
            duration_seconds: 10,
            reuse_existing_server: false,
            allow_host_key_mismatch: false,
            test_topology: TestTopology::LocalToRemote,
            remote_client: None,
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
    fn parses_legacy_tcp_interval_output() {
        let line = "[  5]   0.00-1.00   sec  112 MBytes  939 Mbits/sec  3             sender";
        let sample =
            parse_text_sample(line, TransferDirection::Upload, 1).expect("legacy TCP interval");

        assert_eq!(sample.elapsed, 1.0);
        assert_eq!(sample.bytes, 112_000_000);
        assert_eq!(sample.bandwidth_bps, 939_000_000.0);
        assert_eq!(sample.retransmits, Some(3));
    }

    #[test]
    fn parses_legacy_udp_interval_output() {
        let line = "[SUM]   0.00-1.00   sec  119 MBytes  998 Mbits/sec  0.021 ms  0/0 (0%)";
        let sample =
            parse_text_sample(line, TransferDirection::Download, 8).expect("legacy UDP interval");

        assert_eq!(sample.elapsed, 1.0);
        assert_eq!(sample.bytes, 119_000_000);
        assert_eq!(sample.bandwidth_bps, 998_000_000.0);
        assert_eq!(sample.jitter_ms, Some(0.021));
        assert_eq!(sample.retransmits, None);
    }

    #[test]
    fn skips_non_summary_lines_for_parallel_legacy_output() {
        let stream = "[  5]   0.00-1.00   sec  112 MBytes  939 Mbits/sec  0             sender";
        let summary = "[SUM]   0.00-1.00   sec  896 MBytes  7.51 Gbits/sec  0             sender";

        assert!(parse_text_sample(stream, TransferDirection::Upload, 8).is_none());
        assert!(parse_text_sample(summary, TransferDirection::Upload, 8).is_some());
    }

    #[test]
    fn parses_macos_and_linux_ping_latency() {
        assert_eq!(
            parse_ping_latency(b"64 bytes from 192.168.11.1: icmp_seq=3 ttl=64 time=6.276 ms"),
            Some(6.276)
        );
        assert_eq!(
            parse_ping_latency(b"64 bytes from 127.0.0.1: icmp_seq=0 ttl=64 time<1 ms"),
            Some(1.0)
        );
        assert_eq!(parse_ping_latency(b"Request timeout for icmp_seq 4"), None);
    }

    #[test]
    fn parses_localized_non_utf8_windows_ping_latency() {
        let cp936_line = b"\xca\xb1\xbc\xe4=12.5ms TTL=64";
        assert_eq!(parse_ping_latency(cp936_line), Some(12.5));
        assert_eq!(parse_ping_latency(b"time<1ms TTL=128"), Some(1.0));
    }

    #[test]
    fn buffers_fragmented_process_output_by_line() {
        let mut buffer = LineBuffer::default();
        assert!(buffer.push(b"{\"event\":\"inter").is_empty());
        assert_eq!(
            buffer.push(b"val\"}\r\nsecond\npart"),
            vec![b"{\"event\":\"interval\"}".to_vec(), b"second".to_vec()]
        );
        assert_eq!(buffer.finish(), Some(b"part".to_vec()));
    }

    #[test]
    fn selects_explicit_sidecar_and_system_sources_in_priority_order() {
        let override_path = PathBuf::from("/custom/iperf3");
        assert_eq!(
            select_local_iperf_source(Some(override_path.clone()), true),
            LocalIperfSource::Explicit(override_path)
        );
        assert_eq!(
            select_local_iperf_source(None, true),
            LocalIperfSource::Bundled
        );
        assert_eq!(
            select_local_iperf_source(None, false),
            LocalIperfSource::System
        );
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
            "10.0.0.8",
            "192.168.10.4",
            5201,
            TransferDirection::Download,
            TransportProtocol::Udp,
            8,
            30,
            true,
        );

        assert!(args.windows(2).any(|pair| pair == ["-P", "8"]));
        assert!(args
            .windows(2)
            .any(|pair| pair == ["-i", REPORT_INTERVAL_SECONDS]));
        assert!(args.windows(2).any(|pair| pair == ["-t", "30"]));
        assert!(args.windows(2).any(|pair| pair == ["-b", "0"]));
        assert!(args.iter().any(|argument| argument == "-u"));
        assert!(args.iter().any(|argument| argument == "-R"));
        assert!(args.windows(2).any(|pair| pair == ["-B", "192.168.10.4"]));
    }

    #[test]
    fn builds_continuous_duration_arguments() {
        let args = client_args(
            "10.0.0.8",
            "",
            5201,
            TransferDirection::Upload,
            TransportProtocol::Tcp,
            4,
            0,
            true,
        );

        assert!(args.windows(2).any(|pair| pair == ["-t", "0"]));
        assert!(!args.iter().any(|argument| argument == "-B"));
    }

    #[test]
    fn legacy_text_mode_keeps_bind_arguments() {
        let args = client_args(
            "2001:db8::20",
            "2001:db8::10",
            5201,
            TransferDirection::Upload,
            TransportProtocol::Tcp,
            1,
            10,
            false,
        );

        assert!(!args.iter().any(|argument| argument == "--json-stream"));
        assert!(args.windows(2).any(|pair| pair == ["-B", "2001:db8::10"]));
    }

    #[test]
    fn recognizes_legacy_builds_without_bind_support() {
        assert!(rejects_bind_option("iperf3: unrecognized option '--bind'"));
        assert!(rejects_bind_option("iperf3: illegal option -- B"));
        assert!(!rejects_bind_option(
            "unable to bind to server socket: Cannot assign requested address"
        ));
    }

    #[test]
    fn rejects_a_non_executable_iperf3_file() {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("system clock before Unix epoch")
            .as_nanos();
        let path = std::env::temp_dir().join(format!("iperf3-ui-not-executable-{nonce}"));
        std::fs::write(&path, b"not an executable").expect("create temporary file");

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut permissions = std::fs::metadata(&path)
                .expect("read file metadata")
                .permissions();
            permissions.set_mode(0o600);
            std::fs::set_permissions(&path, permissions).expect("set file permissions");
        }

        assert!(!is_executable(&path));
        let _ = std::fs::remove_file(path);
    }
}
