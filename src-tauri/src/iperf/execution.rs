#[cfg(test)]
use super::latency::parse_ping_latency;
#[cfg(test)]
use super::parser::{add_tcp_latency_jitter, parse_sample, parse_text_sample};
use crate::model::{ServerMode, SpeedTestRequest, TransferDirection, TransportProtocol};
use crate::ssh::SshError;
use serde_json::Value;
#[cfg(unix)]
use std::fs;
use std::{
    env,
    path::{Path, PathBuf},
};
use tauri::AppHandle;
use tauri_plugin_shell::{process::Command as ShellCommand, ShellExt};
use tokio::sync::watch;

const REPORT_INTERVAL_SECONDS: &str = "0.5";
const IPERF3_SIDECAR: &str = "iperf3";

#[derive(Debug, PartialEq, Eq)]
enum LocalIperfSource {
    Explicit(PathBuf),
    Bundled,
    System,
}

#[derive(Default)]
pub(super) struct ClientOutput {
    pub(super) sample_count: u32,
    pub(super) error: Option<String>,
}

#[derive(Default)]
pub(super) struct LineBuffer {
    pending: Vec<u8>,
}

impl LineBuffer {
    pub(super) fn push(&mut self, chunk: &[u8]) -> Vec<Vec<u8>> {
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

    pub(super) fn finish(&mut self) -> Option<Vec<u8>> {
        if self.pending.is_empty() {
            None
        } else {
            Some(std::mem::take(&mut self.pending))
        }
    }
}

#[derive(Debug)]
pub enum RunError {
    Cancelled,
    ServerUnavailable,
    Remote(SshError),
    Message(String),
}

pub(super) fn is_server_unavailable(detail: &str) -> bool {
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

pub(super) fn rejects_bind_option(detail: &str) -> bool {
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

pub(super) fn bind_unsupported_error(endpoint: &str, detail: &str) -> RunError {
    RunError::Message(format!(
        "{endpoint} iperf3 不支持绑定 IP（-B）：{}",
        detail.trim()
    ))
}

pub(super) fn should_report_server_unavailable(request: &SpeedTestRequest, detail: &str) -> bool {
    request.server_mode == ServerMode::Existing || is_server_unavailable(detail)
}

pub(super) fn parse_error_line(line: &str) -> Option<String> {
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
        .find(|path| is_executable(path))
        .ok_or_else(|| "本机未找到 iperf3；请使用 Homebrew 安装，或设置 IPERF3_PATH".into())
}

pub(super) fn local_iperf_command(app: &AppHandle) -> Result<ShellCommand, String> {
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

fn is_executable(path: &Path) -> bool {
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

pub(super) async fn wait_for_cancel(cancel: &mut watch::Receiver<bool>) {
    if *cancel.borrow() {
        return;
    }
    while cancel.changed().await.is_ok() {
        if *cancel.borrow() {
            return;
        }
    }
}

#[allow(clippy::too_many_arguments)]
pub(super) fn client_args(
    target_host: &str,
    bind_ip: &str,
    iperf_port: u16,
    direction: TransferDirection,
    protocol: TransportProtocol,
    parallel_streams: u8,
    duration_seconds: u16,
    target_bitrate_bps: u64,
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
        args.push("-u".into());
    }
    if target_bitrate_bps > 0 {
        let streams = u64::from(parallel_streams.max(1));
        let per_stream_bitrate_bps = target_bitrate_bps.div_ceil(streams);
        args.extend(["-b".into(), per_stream_bitrate_bps.to_string()]);
    } else if protocol == TransportProtocol::Udp {
        args.extend(["-b".into(), "0".into()]);
    }
    if direction == TransferDirection::Download {
        args.push("-R".into());
    }
    if !bind_ip.trim().is_empty() {
        args.extend(["-B".into(), bind_ip.trim().into()]);
    }
    args
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{ServerMode, SpeedSampleEvent, SshAuthMethod, TestMode, TestTopology};

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
            target_bitrate_bps: 0,
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
            0,
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
            0,
            true,
        );

        assert!(args.windows(2).any(|pair| pair == ["-t", "0"]));
        assert!(!args.iter().any(|argument| argument == "-B"));
        assert!(!args.iter().any(|argument| argument == "-b"));
    }

    #[test]
    fn divides_total_target_bitrate_across_parallel_streams() {
        let args = client_args(
            "127.0.0.1",
            "",
            5201,
            TransferDirection::Upload,
            TransportProtocol::Tcp,
            8,
            10,
            100_000_000,
            true,
        );

        assert!(args.windows(2).any(|pair| pair == ["-b", "12500000"]));
    }

    #[test]
    fn rounds_per_stream_bitrate_up_to_preserve_small_total_limits() {
        let args = client_args(
            "127.0.0.1",
            "",
            5201,
            TransferDirection::Upload,
            TransportProtocol::Udp,
            3,
            10,
            10,
            true,
        );

        assert!(args.windows(2).any(|pair| pair == ["-b", "4"]));
        assert!(args.iter().any(|argument| argument == "-u"));
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
            0,
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

    #[cfg(unix)]
    #[test]
    fn rejects_a_non_executable_iperf3_file() {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("system clock before Unix epoch")
            .as_nanos();
        let path = std::env::temp_dir().join(format!("iperf3-ui-not-executable-{nonce}"));
        std::fs::write(&path, b"not an executable").expect("create temporary file");

        use std::os::unix::fs::PermissionsExt;
        let mut permissions = std::fs::metadata(&path)
            .expect("read file metadata")
            .permissions();
        permissions.set_mode(0o600);
        std::fs::set_permissions(&path, permissions).expect("set file permissions");

        assert!(!is_executable(&path));
        let _ = std::fs::remove_file(path);
    }

    #[cfg(windows)]
    #[test]
    fn accepts_an_existing_windows_iperf3_exe() {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("system clock before Unix epoch")
            .as_nanos();
        let path = std::env::temp_dir().join(format!("iperf3-ui-executable-{nonce}.exe"));
        std::fs::write(&path, b"test executable placeholder").expect("create temporary file");

        assert!(is_executable(&path));
        let _ = std::fs::remove_file(path);
    }
}
