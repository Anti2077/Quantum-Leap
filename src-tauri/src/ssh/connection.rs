use super::SshError;
use crate::model::{RemoteTarget, SshAuthMethod};
use ssh2::{CheckResult, HashType, KnownHostFileKind, Session};
use std::{
    net::{SocketAddr, TcpStream, ToSocketAddrs},
    path::{Path, PathBuf},
    time::Duration,
};

const CONNECT_TIMEOUT: Duration = Duration::from_secs(8);
const SESSION_TIMEOUT_MS: u32 = 12_000;

fn resolve_addresses(remote: &RemoteTarget) -> Result<Vec<SocketAddr>, SshError> {
    (remote.host.as_str(), remote.ssh_port)
        .to_socket_addrs()
        .map(|addresses| addresses.collect())
        .map_err(|err| SshError::Message(format!("无法解析服务器地址：{err}")))
}

pub(crate) fn connect(remote: &RemoteTarget) -> Result<Session, SshError> {
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

pub(super) fn expand_user_path(path: &str, home: Option<&Path>) -> Result<PathBuf, SshError> {
    let path = path.trim();
    if path == "~" || path.starts_with("~/") {
        let home =
            home.ok_or_else(|| SshError::Message("无法确定用户主目录，不能展开私钥路径".into()))?;
        if path == "~" {
            Ok(home.to_path_buf())
        } else {
            Ok(home.join(&path[2..]))
        }
    } else {
        Ok(PathBuf::from(path))
    }
}

fn resolve_private_key(path: &str) -> Result<PathBuf, SshError> {
    let path = expand_user_path(path, dirs::home_dir().as_deref())?;

    if !path.is_file() {
        return Err(SshError::Message(format!(
            "SSH 私钥文件不存在：{}",
            path.display()
        )));
    }
    Ok(path)
}

fn verify_known_host(session: &Session, remote: &RemoteTarget) -> Result<(), SshError> {
    let Some(home) = dirs::home_dir() else {
        return Ok(());
    };
    let path = home.join(".ssh/known_hosts");
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
