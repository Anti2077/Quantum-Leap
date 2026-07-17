use crate::model::RemoteTarget;
use ssh2::{CheckResult, HashType, KnownHostFileKind, Session};
use std::{
    env,
    io::Read,
    net::{SocketAddr, TcpStream, ToSocketAddrs},
    path::PathBuf,
    time::Duration,
};

const CONNECT_TIMEOUT: Duration = Duration::from_secs(8);
const SESSION_TIMEOUT_MS: u32 = 12_000;

#[derive(Debug, PartialEq, Eq)]
pub enum SshError {
    HostKeyMismatch(String),
    ExistingServer,
    Message(String),
}

impl std::fmt::Display for SshError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::HostKeyMismatch(fingerprint) => write!(
                formatter,
                "SSH 主机密钥与 known_hosts 不一致。SHA256 指纹：{fingerprint}"
            ),
            Self::ExistingServer => write!(formatter, "测速端口已有服务正在监听"),
            Self::Message(message) => formatter.write_str(message),
        }
    }
}

impl From<String> for SshError {
    fn from(message: String) -> Self {
        Self::Message(message)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RemoteServer {
    Managed(u32),
    Existing,
}

impl RemoteServer {
    pub fn managed_pid(self) -> u32 {
        match self {
            Self::Managed(pid) => pid,
            Self::Existing => 0,
        }
    }

    pub fn is_managed(self) -> bool {
        matches!(self, Self::Managed(_))
    }
}

fn resolve_addresses(remote: &RemoteTarget) -> Result<Vec<SocketAddr>, SshError> {
    (remote.host.as_str(), remote.ssh_port)
        .to_socket_addrs()
        .map(|addresses| addresses.collect())
        .map_err(|err| SshError::Message(format!("无法解析服务器地址：{err}")))
}

fn connect(remote: &RemoteTarget) -> Result<Session, SshError> {
    let addresses = resolve_addresses(remote)?;
    if addresses.is_empty() {
        return Err(SshError::Message("服务器地址没有可用的网络端点".into()));
    }

    let mut last_error = None;
    let tcp = addresses
        .iter()
        .find_map(
            |address| match TcpStream::connect_timeout(address, CONNECT_TIMEOUT) {
                Ok(stream) => Some(stream),
                Err(error) => {
                    last_error = Some(error);
                    None
                }
            },
        )
        .ok_or_else(|| {
            SshError::Message(format!(
                "连接 SSH 失败：{}",
                last_error
                    .map(|error| error.to_string())
                    .unwrap_or_else(|| "未知网络错误".into())
            ))
        })?;

    let _ = tcp.set_read_timeout(Some(CONNECT_TIMEOUT));
    let _ = tcp.set_write_timeout(Some(CONNECT_TIMEOUT));

    let mut session =
        Session::new().map_err(|err| SshError::Message(format!("创建 SSH 会话失败：{err}")))?;
    session.set_timeout(SESSION_TIMEOUT_MS);
    session.set_tcp_stream(tcp);
    session
        .handshake()
        .map_err(|err| SshError::Message(format!("SSH 握手失败：{err}")))?;
    verify_known_host(&session, remote)?;
    session
        .userauth_password(&remote.username, &remote.password)
        .map_err(|err| SshError::Message(format!("SSH 认证失败：{err}")))?;

    if !session.authenticated() {
        return Err(SshError::Message("SSH 认证未通过".into()));
    }

    Ok(session)
}

fn verify_known_host(session: &Session, remote: &RemoteTarget) -> Result<(), SshError> {
    let Some(home) = env::var_os("HOME") else {
        return Ok(());
    };
    let path = PathBuf::from(home).join(".ssh/known_hosts");
    if !path.is_file() {
        return Ok(());
    }

    let mut known_hosts = session
        .known_hosts()
        .map_err(|err| SshError::Message(format!("无法检查 SSH 主机密钥：{err}")))?;
    known_hosts
        .read_file(&path, KnownHostFileKind::OpenSSH)
        .map_err(|err| SshError::Message(format!("无法读取 SSH known_hosts：{err}")))?;
    let (host_key, _) = session
        .host_key()
        .ok_or_else(|| SshError::Message("服务器没有提供 SSH 主机密钥".into()))?;

    match known_hosts.check_port(&remote.host, remote.ssh_port, host_key) {
        CheckResult::Match | CheckResult::NotFound => Ok(()),
        CheckResult::Mismatch if remote.allow_host_key_mismatch => Ok(()),
        CheckResult::Mismatch => {
            let fingerprint = session
                .host_key_hash(HashType::Sha256)
                .map(format_fingerprint)
                .unwrap_or_else(|| "不可用".into());
            Err(SshError::HostKeyMismatch(fingerprint))
        }
        CheckResult::Failure => Err(SshError::Message("SSH 主机密钥校验失败".into())),
    }
}

fn format_fingerprint(bytes: &[u8]) -> String {
    bytes
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<Vec<_>>()
        .join(":")
}

fn run_command(session: &Session, command: &str) -> Result<(String, String, i32), String> {
    let mut channel = session
        .channel_session()
        .map_err(|err| format!("打开 SSH 通道失败：{err}"))?;
    channel
        .exec(command)
        .map_err(|err| format!("执行远端命令失败：{err}"))?;

    let mut stdout = String::new();
    let mut stderr = String::new();
    channel
        .read_to_string(&mut stdout)
        .map_err(|err| format!("读取远端输出失败：{err}"))?;
    channel
        .stderr()
        .read_to_string(&mut stderr)
        .map_err(|err| format!("读取远端错误输出失败：{err}"))?;
    channel
        .wait_close()
        .map_err(|err| format!("关闭 SSH 通道失败：{err}"))?;
    let exit_status = channel
        .exit_status()
        .map_err(|err| format!("读取远端退出状态失败：{err}"))?;

    Ok((stdout, stderr, exit_status))
}

fn parse_server_start(
    stdout: &str,
    stderr: &str,
    status: i32,
    reuse_existing: bool,
) -> Result<RemoteServer, SshError> {
    if status == 0 {
        return stdout
            .lines()
            .find_map(|line| line.trim().parse::<u32>().ok())
            .map(RemoteServer::Managed)
            .ok_or_else(|| SshError::Message("远端 iperf3 已启动，但未返回进程 PID".into()));
    }

    let normalized_error = stderr.to_ascii_lowercase();
    if reuse_existing && normalized_error.contains("address already in use") {
        return Ok(RemoteServer::Existing);
    }

    if normalized_error.contains("address already in use") {
        return Err(SshError::ExistingServer);
    }

    let detail = if stderr.contains("IPERF3_NOT_FOUND") {
        "远端服务器未安装 iperf3".to_string()
    } else if stderr.trim().is_empty() {
        format!("远端 iperf3 启动失败（退出码 {status}）")
    } else {
        format!("远端 iperf3 启动失败：{}", stderr.trim())
    };
    Err(SshError::Message(detail))
}

pub fn start_remote_server(
    remote: &RemoteTarget,
    reuse_existing: bool,
    one_off: bool,
) -> Result<RemoteServer, SshError> {
    let session = connect(remote)?;
    let log_path = format!("/tmp/iperf3-ui-{}.log", remote.iperf_port);
    let one_off_flag = if one_off { "-1" } else { "" };
    let command = format!(
        "sh -lc 'command -v iperf3 >/dev/null 2>&1 || {{ echo IPERF3_NOT_FOUND >&2; exit 127; }}; \
         nohup iperf3 -s {one_off_flag} -p {port} >{log} 2>&1 </dev/null & pid=$!; \
         sleep 0.25; kill -0 $pid 2>/dev/null || {{ cat {log} >&2; exit 1; }}; echo $pid'",
        port = remote.iperf_port,
        log = log_path,
        one_off_flag = one_off_flag
    );
    let (stdout, stderr, status) = run_command(&session, &command)?;
    parse_server_start(&stdout, &stderr, status, reuse_existing)
}

pub fn cleanup_remote_server(remote: &RemoteTarget, pid: u32) -> Result<(), String> {
    if pid == 0 {
        return Ok(());
    }

    let session = connect(remote).map_err(|error| error.to_string())?;
    let command = format!(
        "sh -lc 'case \"$(ps -p {pid} -o comm= 2>/dev/null)\" in *iperf3*) ;; *) exit 0 ;; esac; \
         kill -TERM {pid} >/dev/null 2>&1 || true; \
         n=0; while kill -0 {pid} >/dev/null 2>&1 && [ $n -lt 10 ]; do sleep 0.1; n=$((n+1)); done; \
         kill -KILL {pid} >/dev/null 2>&1 || true'"
    );
    let (_, stderr, status) = run_command(&session, &command)?;

    if status == 0 {
        Ok(())
    } else {
        Err(format!("清理远端 iperf3 失败：{}", stderr.trim()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_managed_server_pid() {
        assert_eq!(
            parse_server_start("4821\n", "", 0, true),
            Ok(RemoteServer::Managed(4821))
        );
    }

    #[test]
    fn reuses_an_existing_listener_when_enabled() {
        let error =
            "iperf3: error - unable to start listener for connections: Address already in use";
        assert_eq!(
            parse_server_start("", error, 1, true),
            Ok(RemoteServer::Existing)
        );
    }

    #[test]
    fn refuses_an_existing_listener_when_disabled() {
        let error =
            "iperf3: error - unable to start listener for connections: Address already in use";
        assert!(matches!(
            parse_server_start("", error, 1, false),
            Err(SshError::ExistingServer)
        ));
    }
}
