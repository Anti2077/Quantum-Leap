use crate::model::{RemoteTarget, SshAuthMethod};
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
const REMOTE_IPERF_CANDIDATES: &[&str] = &[
    "/opt/bin/iperf3",
    "/usr/local/bin/iperf3",
    "/usr/bin/iperf3",
    "/bin/iperf3",
    "/opt/homebrew/bin/iperf3",
    "/share/CACHEDEV1_DATA/.qpkg/Entware/bin/iperf3",
    "/share/MD0_DATA/.qpkg/Entware/bin/iperf3",
    "/share/HDA_DATA/.qpkg/Entware/bin/iperf3",
];

#[derive(Debug, PartialEq, Eq)]
pub enum SshError {
    HostKeyMismatch(String),
    ExistingServer,
    Iperf3Missing(RemotePackageManager),
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
            Self::Iperf3Missing(_) => write!(formatter, "远端服务器未安装 iperf3"),
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
pub enum RemotePackageManager {
    Apt,
    Dnf,
    Yum,
    Apk,
    Pacman,
    Zypper,
    Homebrew,
    Unknown,
}

impl RemotePackageManager {
    fn from_marker(stderr: &str) -> Self {
        let marker = stderr
            .lines()
            .find_map(|line| line.trim().strip_prefix("IPERF3_NOT_FOUND:"));
        match marker {
            Some("apt-get") => Self::Apt,
            Some("dnf") => Self::Dnf,
            Some("yum") => Self::Yum,
            Some("apk") => Self::Apk,
            Some("pacman") => Self::Pacman,
            Some("zypper") => Self::Zypper,
            Some("brew") => Self::Homebrew,
            _ => Self::Unknown,
        }
    }

    pub fn label(self) -> Option<&'static str> {
        match self {
            Self::Apt => Some("APT"),
            Self::Dnf => Some("DNF"),
            Self::Yum => Some("YUM"),
            Self::Apk => Some("APK"),
            Self::Pacman => Some("Pacman"),
            Self::Zypper => Some("Zypper"),
            Self::Homebrew => Some("Homebrew"),
            Self::Unknown => None,
        }
    }

    pub fn install_command(self) -> Option<&'static str> {
        match self {
            Self::Apt => Some("sudo apt-get update && sudo apt-get install -y iperf3"),
            Self::Dnf => Some("sudo dnf install -y iperf3"),
            Self::Yum => Some("sudo yum install -y iperf3"),
            Self::Apk => Some("sudo apk add iperf3"),
            Self::Pacman => Some("sudo pacman -S --needed iperf3"),
            Self::Zypper => Some("sudo zypper --non-interactive install iperf3"),
            Self::Homebrew => Some("brew install iperf3"),
            Self::Unknown => None,
        }
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
    match remote.auth_method {
        SshAuthMethod::Password => session
            .userauth_password(&remote.username, &remote.password)
            .map_err(|err| SshError::Message(format!("SSH 密码认证失败：{err}")))?,
        SshAuthMethod::PrivateKey => {
            let private_key = resolve_private_key(&remote.private_key_path)?;
            let passphrase = (!remote.passphrase.is_empty()).then_some(remote.passphrase.as_str());
            session
                .userauth_pubkey_file(&remote.username, None, &private_key, passphrase)
                .map_err(|err| SshError::Message(format!("SSH 私钥认证失败：{err}")))?;
        }
    }

    if !session.authenticated() {
        return Err(SshError::Message("SSH 认证未通过".into()));
    }

    Ok(session)
}

fn resolve_private_key(path: &str) -> Result<PathBuf, SshError> {
    let path = path.trim();
    let path = if path == "~" || path.starts_with("~/") {
        let home = env::var_os("HOME")
            .ok_or_else(|| SshError::Message("无法确定用户主目录，不能展开私钥路径".into()))?;
        if path == "~" {
            PathBuf::from(home)
        } else {
            PathBuf::from(home).join(&path[2..])
        }
    } else {
        PathBuf::from(path)
    };

    if !path.is_file() {
        return Err(SshError::Message(format!(
            "SSH 私钥文件不存在：{}",
            path.display()
        )));
    }
    Ok(path)
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

fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\"'\"'"))
}

fn server_start_command(remote: &RemoteTarget, one_off: bool) -> String {
    let candidates = REMOTE_IPERF_CANDIDATES
        .iter()
        .map(|path| shell_quote(path))
        .collect::<Vec<_>>()
        .join(" ");
    let custom_path = shell_quote(remote.iperf_path.trim());
    let log_path = format!("/tmp/iperf3-ui-{}.log", remote.iperf_port);
    let one_off_flag = if one_off { "-1" } else { "" };
    let script = format!(
        "IPERF3_BIN={custom_path}; \
         if [ -n \"$IPERF3_BIN\" ]; then \
           [ -x \"$IPERF3_BIN\" ] || {{ printf 'IPERF3_PATH_INVALID:%s\\n' \"$IPERF3_BIN\" >&2; exit 126; }}; \
         else \
           IPERF3_BIN=$(command -v iperf3 2>/dev/null || true); \
           if [ -z \"$IPERF3_BIN\" ] || [ ! -x \"$IPERF3_BIN\" ]; then \
             IPERF3_BIN=; \
             for candidate in {candidates}; do \
               if [ -x \"$candidate\" ]; then IPERF3_BIN=$candidate; break; fi; \
             done; \
           fi; \
         fi; \
         if [ -z \"$IPERF3_BIN\" ]; then \
           package_manager=unknown; \
           if command -v apt-get >/dev/null 2>&1; then package_manager=apt-get; \
           elif command -v dnf >/dev/null 2>&1; then package_manager=dnf; \
           elif command -v yum >/dev/null 2>&1; then package_manager=yum; \
           elif command -v apk >/dev/null 2>&1; then package_manager=apk; \
           elif command -v pacman >/dev/null 2>&1; then package_manager=pacman; \
           elif command -v zypper >/dev/null 2>&1; then package_manager=zypper; \
           elif command -v brew >/dev/null 2>&1; then package_manager=brew; fi; \
           echo IPERF3_NOT_FOUND:$package_manager >&2; exit 127; \
         fi; \
         start_iperf() {{ \
           if command -v nohup >/dev/null 2>&1; then \
             exec nohup \"$IPERF3_BIN\" -s {one_off_flag} -p {port}; \
           elif command -v setsid >/dev/null 2>&1; then \
             exec setsid \"$IPERF3_BIN\" -s {one_off_flag} -p {port}; \
           else \
             trap '' HUP; exec \"$IPERF3_BIN\" -s {one_off_flag} -p {port}; \
           fi; \
         }}; \
         start_iperf >{log} 2>&1 </dev/null & pid=$!; \
         sleep 0.25; kill -0 $pid 2>/dev/null || {{ cat {log} >&2; exit 1; }}; echo $pid",
        port = remote.iperf_port,
        log = shell_quote(&log_path),
    );
    format!("sh -lc {}", shell_quote(&script))
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

    if let Some(path) = stderr
        .lines()
        .find_map(|line| line.trim().strip_prefix("IPERF3_PATH_INVALID:"))
    {
        return Err(SshError::Message(format!(
            "远端 iperf3 路径不可执行：{path}"
        )));
    }

    if stderr.contains("IPERF3_NOT_FOUND:") {
        return Err(SshError::Iperf3Missing(RemotePackageManager::from_marker(
            stderr,
        )));
    }

    let detail = if stderr.trim().is_empty() {
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
    let command = server_start_command(remote, one_off);
    let (stdout, stderr, status) = run_command(&session, &command)?;
    parse_server_start(&stdout, &stderr, status, reuse_existing)
}

fn cleanup_remote_command(pid: u32, port: u16) -> String {
    format!(
        "sh -lc 'pid={pid}; port={port}; \
         is_target() {{ \
           candidate=\"$1\"; \
           if [ -r \"/proc/$candidate/cmdline\" ]; then \
           command_line=\" $(tr \"\\000\" \" \" < \"/proc/$candidate/cmdline\" 2>/dev/null) \"; \
           else \
             command_line=\" $(ps -p \"$candidate\" -o args= 2>/dev/null) \"; \
           fi; \
           [ -n \"${{command_line# }}\" ] || return 1; \
           case \"$command_line\" in *iperf3*) ;; *) return 1 ;; esac; \
           case \"$command_line\" in *\" -s \"*) ;; *) return 1 ;; esac; \
           case \"$command_line\" in *\" -p $port \"*) return 0 ;; *) return 1 ;; esac; \
         }}; \
         find_targets() {{ \
           targets=; \
           if kill -0 \"$pid\" 2>/dev/null && is_target \"$pid\"; then \
             targets=\"$pid\"; \
           fi; \
           for path in /proc/[0-9]*/cmdline; do \
             [ -r \"$path\" ] || continue; \
             candidate=${{path#/proc/}}; candidate=${{candidate%/cmdline}}; \
             is_target \"$candidate\" || continue; \
             case \" $targets \" in *\" $candidate \"*) ;; *) targets=\"$targets $candidate\" ;; esac; \
           done; \
         }}; \
         find_targets; \
         [ -n \"${{targets# }}\" ] || exit 0; \
         for candidate in $targets; do kill -TERM \"$candidate\" 2>/dev/null || true; done; \
         n=0; \
         while [ \"$n\" -lt 20 ]; do \
           find_targets; [ -z \"${{targets# }}\" ] && exit 0; \
           sleep 0.1; n=$((n+1)); \
         done; \
         for candidate in $targets; do kill -KILL \"$candidate\" 2>/dev/null || true; done; \
         n=0; \
         while [ \"$n\" -lt 10 ]; do \
           find_targets; [ -z \"${{targets# }}\" ] && exit 0; \
           sleep 0.1; n=$((n+1)); \
         done; \
         find_targets; \
         if [ -n \"${{targets# }}\" ]; then \
           echo \"远端 iperf3 清理失败：端口 $port 仍有服务端进程（PID${{targets}}）\" >&2; exit 1; \
         fi'"
    )
}

pub fn cleanup_remote_server(remote: &RemoteTarget, pid: u32) -> Result<(), String> {
    if pid == 0 {
        return Ok(());
    }

    let session = connect(remote).map_err(|error| error.to_string())?;
    let command = cleanup_remote_command(pid, remote.iperf_port);
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

    fn remote(iperf_path: &str) -> RemoteTarget {
        RemoteTarget {
            host: "10.0.0.8".into(),
            ssh_port: 22,
            iperf_port: 5201,
            iperf_path: iperf_path.into(),
            username: "tester".into(),
            password: "secret".into(),
            auth_method: SshAuthMethod::Password,
            private_key_path: String::new(),
            passphrase: String::new(),
            allow_host_key_mismatch: false,
        }
    }

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

    #[test]
    fn reports_missing_iperf3_with_detected_package_manager() {
        assert_eq!(
            parse_server_start("", "IPERF3_NOT_FOUND:apt-get\n", 127, false),
            Err(SshError::Iperf3Missing(RemotePackageManager::Apt))
        );
        assert_eq!(
            RemotePackageManager::Apt.install_command(),
            Some("sudo apt-get update && sudo apt-get install -y iperf3")
        );
    }

    #[test]
    fn reports_missing_iperf3_without_a_known_package_manager() {
        assert_eq!(
            parse_server_start("", "IPERF3_NOT_FOUND:unknown\n", 127, false),
            Err(SshError::Iperf3Missing(RemotePackageManager::Unknown))
        );
        assert_eq!(RemotePackageManager::Unknown.install_command(), None);
    }

    #[test]
    fn cleanup_command_supports_procfs_and_has_valid_shell_syntax() {
        let command = cleanup_remote_command(u32::MAX, u16::MAX);

        assert!(command.contains("/proc/[0-9]*/cmdline"));
        assert!(command.contains("ps -p \"$candidate\" -o args="));
        assert!(command.contains(" -p $port "));
        assert!(command.contains("端口 $port 仍有服务端进程"));
        assert!(std::process::Command::new("sh")
            .args(["-c", &command])
            .status()
            .expect("run cleanup shell")
            .success());
    }

    #[test]
    fn quotes_custom_remote_binary_paths() {
        assert_eq!(shell_quote("/opt/a'b/iperf3"), "'/opt/a'\"'\"'b/iperf3'");
        let command = server_start_command(&remote("/opt/bin/iperf3"), false);
        assert!(command.contains("/opt/bin/iperf3"));
        assert!(command.contains("IPERF3_PATH_INVALID"));
    }

    #[test]
    fn auto_detection_checks_qnap_and_entware_paths() {
        let command = server_start_command(&remote(""), true);
        assert!(command.contains("/opt/bin/iperf3"));
        assert!(command.contains(".qpkg/Entware/bin/iperf3"));
        assert!(command.contains("package_manager=apt-get"));
        assert!(command.contains("IPERF3_NOT_FOUND:$package_manager"));
        assert!(command.contains("command -v nohup"));
        assert!(command.contains("command -v setsid"));
        assert!(command.contains("trap '\"'\"''\"'\"' HUP"));
        assert!(command.contains("-s -1 -p 5201"));
    }

    #[test]
    fn reports_an_invalid_custom_binary_path() {
        let error = parse_server_start("", "IPERF3_PATH_INVALID:/opt/bin/missing", 126, false);
        assert_eq!(
            error,
            Err(SshError::Message(
                "远端 iperf3 路径不可执行：/opt/bin/missing".into()
            ))
        );
    }
}
