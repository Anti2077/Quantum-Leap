use crate::{
    i18n::localize,
    model::{validate_bind_ip, validate_remote_iperf_path, ServerMode, SshAuthMethod, UiLanguage},
};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager};

#[cfg(any(target_os = "macos", test))]
use std::collections::BTreeMap;

#[cfg(target_os = "macos")]
use std::sync::MutexGuard;

#[cfg(target_os = "macos")]
use security_framework::passwords::{
    delete_generic_password, get_generic_password, set_generic_password,
};

const KEYCHAIN_SERVICE: &str = "com.anti2077.quantumleap.saved-server";
#[cfg(target_os = "macos")]
const KEYCHAIN_VAULT_ACCOUNT: &str = "credential-vault-v1";
#[cfg(target_os = "macos")]
const KEYCHAIN_ITEM_NOT_FOUND: i32 = -25300;
const METADATA_FILE: &str = "saved-servers.json";

#[cfg(any(target_os = "linux", target_os = "windows"))]
fn credential_entry(id: &str) -> Result<keyring::Entry, String> {
    credential_entry_for(KEYCHAIN_SERVICE, id)
}

#[cfg(any(target_os = "linux", target_os = "windows"))]
fn credential_entry_for(service: &str, id: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(service, id).map_err(|error| format!("无法打开系统凭据存储：{error}"))
}

#[cfg(any(target_os = "linux", target_os = "windows"))]
fn keychain_set(id: &str, password: &str) -> Result<(), String> {
    credential_entry(id)?
        .set_password(password)
        .map_err(|error| format!("保存密码到系统凭据存储失败：{error}"))
}

#[cfg(any(target_os = "linux", target_os = "windows"))]
fn keychain_get(id: &str) -> Result<String, String> {
    credential_entry(id)?
        .get_password()
        .map_err(|error| format!("从系统凭据存储读取密码失败：{error}"))
}

#[cfg(any(target_os = "linux", target_os = "windows"))]
fn keychain_delete(id: &str) {
    if let Ok(entry) = credential_entry(id) {
        let _ = entry.delete_credential();
    }
}

// Serialize read-modify-write operations so concurrent commands cannot lose a
// saved endpoint or race on the shared temporary metadata file.
static METADATA_LOCK: Mutex<()> = Mutex::new(());

#[cfg(any(target_os = "macos", test))]
#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
struct CredentialVault {
    #[serde(default)]
    credentials: BTreeMap<String, String>,
}

#[cfg(target_os = "macos")]
static KEYCHAIN_VAULT_CACHE: Mutex<Option<CredentialVault>> = Mutex::new(None);

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveServerRequest {
    pub id: Option<String>,
    #[serde(default)]
    pub note: String,
    pub host: String,
    pub ssh_port: u16,
    pub iperf_port: u16,
    #[serde(default)]
    pub remote_iperf_path: String,
    #[serde(default)]
    pub bind_ip: String,
    pub server_mode: ServerMode,
    pub username: String,
    pub password: String,
    pub auth_method: SshAuthMethod,
    pub private_key_path: String,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteServerRequest {
    pub id: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct SavedServerMetadata {
    id: String,
    #[serde(default)]
    note: String,
    host: String,
    ssh_port: u16,
    iperf_port: u16,
    #[serde(default)]
    remote_iperf_path: String,
    #[serde(default)]
    bind_ip: String,
    #[serde(default = "default_server_mode")]
    server_mode: ServerMode,
    username: String,
    #[serde(default = "default_password_auth")]
    auth_method: SshAuthMethod,
    #[serde(default)]
    private_key_path: String,
}

fn default_password_auth() -> SshAuthMethod {
    SshAuthMethod::Password
}

fn default_server_mode() -> ServerMode {
    ServerMode::SshManaged
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedServer {
    id: String,
    note: String,
    host: String,
    ssh_port: u16,
    iperf_port: u16,
    remote_iperf_path: String,
    bind_ip: String,
    server_mode: ServerMode,
    username: String,
    password: String,
    auth_method: SshAuthMethod,
    private_key_path: String,
}

fn metadata_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|directory| directory.join(METADATA_FILE))
        .map_err(|error| format!("无法确定常用服务器存储目录：{error}"))
}

fn read_metadata(path: &Path) -> Result<Vec<SavedServerMetadata>, String> {
    if !path.is_file() {
        return Ok(Vec::new());
    }
    let contents = fs::read(path).map_err(|error| format!("读取常用服务器失败：{error}"))?;
    serde_json::from_slice(&contents).map_err(|error| format!("解析常用服务器失败：{error}"))
}

fn write_metadata(path: &Path, records: &[SavedServerMetadata]) -> Result<(), String> {
    let directory = path
        .parent()
        .ok_or_else(|| "常用服务器存储路径无效".to_string())?;
    fs::create_dir_all(directory).map_err(|error| format!("创建配置目录失败：{error}"))?;
    let temporary = path.with_extension("json.tmp");
    let contents = serde_json::to_vec_pretty(records)
        .map_err(|error| format!("序列化常用服务器失败：{error}"))?;
    fs::write(&temporary, contents).map_err(|error| format!("写入常用服务器失败：{error}"))?;
    fs::rename(&temporary, path).map_err(|error| format!("保存常用服务器失败：{error}"))
}

fn new_id() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos()
        .to_string()
}

#[cfg(target_os = "macos")]
fn lock_keychain_vault() -> Result<MutexGuard<'static, Option<CredentialVault>>, String> {
    KEYCHAIN_VAULT_CACHE
        .lock()
        .map_err(|_| "macOS 钥匙串保险库状态不可用".to_string())
}

#[cfg(target_os = "macos")]
fn read_keychain_vault() -> Result<CredentialVault, String> {
    match get_generic_password(KEYCHAIN_SERVICE, KEYCHAIN_VAULT_ACCOUNT) {
        Ok(contents) => serde_json::from_slice(&contents)
            .map_err(|error| format!("解析 macOS 钥匙串保险库失败：{error}")),
        Err(error) if error.code() == KEYCHAIN_ITEM_NOT_FOUND => Ok(CredentialVault::default()),
        Err(error) => Err(format!("读取 macOS 钥匙串保险库失败：{error}")),
    }
}

#[cfg(target_os = "macos")]
fn write_keychain_vault(vault: &CredentialVault) -> Result<(), String> {
    let contents = serde_json::to_vec(vault)
        .map_err(|error| format!("序列化 macOS 钥匙串保险库失败：{error}"))?;
    set_generic_password(KEYCHAIN_SERVICE, KEYCHAIN_VAULT_ACCOUNT, &contents)
        .map_err(|error| format!("保存密码到 macOS 钥匙串保险库失败：{error}"))
}

#[cfg(target_os = "macos")]
fn ensure_keychain_vault_loaded(
    cache: &mut Option<CredentialVault>,
) -> Result<&mut CredentialVault, String> {
    if cache.is_none() {
        *cache = Some(read_keychain_vault()?);
    }
    cache
        .as_mut()
        .ok_or_else(|| "macOS 钥匙串保险库状态不可用".to_string())
}

#[cfg(target_os = "macos")]
fn keychain_set(id: &str, password: &str) -> Result<(), String> {
    let mut cache = lock_keychain_vault()?;
    let mut updated = ensure_keychain_vault_loaded(&mut cache)?.clone();
    updated
        .credentials
        .insert(id.to_string(), password.to_string());
    write_keychain_vault(&updated)?;
    *cache = Some(updated);
    Ok(())
}

#[cfg(target_os = "macos")]
fn keychain_get(id: &str) -> Result<String, String> {
    let mut cache = lock_keychain_vault()?;
    let vault = ensure_keychain_vault_loaded(&mut cache)?;
    if let Some(password) = vault.credentials.get(id) {
        return Ok(password.clone());
    }

    // Older releases stored one Keychain item per server. Migrate each legacy
    // item lazily so existing users keep their saved credentials.
    let legacy = get_generic_password(KEYCHAIN_SERVICE, id)
        .map_err(|error| format!("从旧版 macOS 钥匙串条目读取密码失败：{error}"))?;
    let password =
        String::from_utf8(legacy).map_err(|_| "旧版钥匙串中的密码不是有效文本".to_string())?;
    let mut updated = vault.clone();
    updated.credentials.insert(id.to_string(), password.clone());
    write_keychain_vault(&updated)?;
    *cache = Some(updated);
    Ok(password)
}

#[cfg(target_os = "macos")]
fn keychain_delete(id: &str) {
    if let Ok(mut cache) = lock_keychain_vault() {
        if let Ok(vault) = ensure_keychain_vault_loaded(&mut cache) {
            let mut updated = vault.clone();
            if updated.credentials.remove(id).is_some() && write_keychain_vault(&updated).is_ok() {
                *cache = Some(updated);
            }
        }
    }
    let _ = delete_generic_password(KEYCHAIN_SERVICE, id);
}

fn list_inner(app: &AppHandle) -> Result<Vec<SavedServer>, String> {
    let records = read_metadata(&metadata_path(app)?)?;
    Ok(records
        .into_iter()
        .map(|record| {
            SavedServer {
                id: record.id,
                note: record.note,
                host: record.host,
                ssh_port: record.ssh_port,
                iperf_port: record.iperf_port,
                remote_iperf_path: record.remote_iperf_path,
                bind_ip: record.bind_ip,
                server_mode: record.server_mode,
                username: record.username,
                // Passwords are unlocked lazily so launching the app never causes
                // one Keychain authorization dialog per saved server.
                password: String::new(),
                auth_method: record.auth_method,
                private_key_path: record.private_key_path,
            }
        })
        .collect())
}

fn password_inner(app: &AppHandle, request: DeleteServerRequest) -> Result<String, String> {
    let records = read_metadata(&metadata_path(app)?)?;
    let Some(record) = records.iter().find(|record| record.id == request.id) else {
        return Err("常用服务器不存在".into());
    };
    if record.server_mode == ServerMode::Existing {
        return Ok(String::new());
    }
    keychain_get(&request.id)
}

fn save_inner(app: &AppHandle, request: SaveServerRequest) -> Result<SavedServer, String> {
    let _metadata_guard = METADATA_LOCK
        .lock()
        .map_err(|_| "常用服务器存储状态不可用".to_string())?;
    let note = request.note.trim().to_owned();
    let host = request.host.trim().to_owned();
    let username = request.username.trim().to_owned();
    if note.chars().count() > 48 {
        return Err("服务器备注不能超过 48 个字符".into());
    }
    if host.is_empty() {
        return Err("服务器地址不能为空".into());
    }
    if request.server_mode == ServerMode::SshManaged && username.is_empty() {
        return Err("SSH 模式需要填写用户名".into());
    }
    if request.server_mode == ServerMode::SshManaged {
        validate_remote_iperf_path(&request.remote_iperf_path)?;
        validate_bind_ip(&request.bind_ip, "绑定 IP")?;
    }
    if request.server_mode == ServerMode::SshManaged
        && request.auth_method == SshAuthMethod::Password
        && request.password.is_empty()
    {
        return Err("密码登录需要填写 SSH 密码".into());
    }
    if request.server_mode == ServerMode::SshManaged
        && request.auth_method == SshAuthMethod::PrivateKey
        && request.private_key_path.trim().is_empty()
    {
        return Err("密钥登录需要填写私钥路径".into());
    }
    if request.iperf_port == 0
        || (request.server_mode == ServerMode::SshManaged && request.ssh_port == 0)
    {
        return Err("端口必须在 1 到 65535 之间".into());
    }

    let path = metadata_path(app)?;
    let mut records = read_metadata(&path)?;
    let existing_index = request
        .id
        .as_ref()
        .and_then(|id| records.iter().position(|record| &record.id == id))
        .or_else(|| {
            records.iter().position(|record| {
                record.host == host
                    && record.ssh_port == request.ssh_port
                    && record.username == username
                    && record.server_mode == request.server_mode
            })
        });
    let id = existing_index
        .map(|index| records[index].id.clone())
        .unwrap_or_else(new_id);
    let metadata = SavedServerMetadata {
        id: id.clone(),
        note: note.clone(),
        host: host.clone(),
        ssh_port: request.ssh_port,
        iperf_port: request.iperf_port,
        remote_iperf_path: request.remote_iperf_path.trim().to_owned(),
        bind_ip: if request.server_mode == ServerMode::SshManaged {
            request.bind_ip.trim().to_owned()
        } else {
            String::new()
        },
        server_mode: request.server_mode,
        username: username.clone(),
        auth_method: request.auth_method,
        private_key_path: request.private_key_path.trim().to_owned(),
    };

    if request.server_mode == ServerMode::SshManaged {
        keychain_set(&id, &request.password)?;
    } else {
        keychain_delete(&id);
    }
    if let Some(index) = existing_index {
        records[index] = metadata;
    } else {
        records.insert(0, metadata);
    }
    write_metadata(&path, &records)?;

    Ok(SavedServer {
        id,
        note,
        host,
        ssh_port: request.ssh_port,
        iperf_port: request.iperf_port,
        remote_iperf_path: request.remote_iperf_path.trim().to_owned(),
        bind_ip: if request.server_mode == ServerMode::SshManaged {
            request.bind_ip.trim().to_owned()
        } else {
            String::new()
        },
        server_mode: request.server_mode,
        username,
        password: request.password,
        auth_method: request.auth_method,
        private_key_path: request.private_key_path.trim().to_owned(),
    })
}

fn delete_inner(app: &AppHandle, request: DeleteServerRequest) -> Result<(), String> {
    let _metadata_guard = METADATA_LOCK
        .lock()
        .map_err(|_| "常用服务器存储状态不可用".to_string())?;
    let path = metadata_path(app)?;
    let mut records = read_metadata(&path)?;
    records.retain(|record| record.id != request.id);
    write_metadata(&path, &records)?;
    keychain_delete(&request.id);
    Ok(())
}

#[tauri::command]
pub async fn list_saved_servers(
    app: AppHandle,
    language: UiLanguage,
) -> Result<Vec<SavedServer>, String> {
    tauri::async_runtime::spawn_blocking(move || list_inner(&app))
        .await
        .map_err(|error| localize(language, format!("读取常用服务器任务失败：{error}")))?
        .map_err(|error| localize(language, error))
}

#[tauri::command]
pub async fn save_server(
    app: AppHandle,
    payload: SaveServerRequest,
    language: UiLanguage,
) -> Result<SavedServer, String> {
    tauri::async_runtime::spawn_blocking(move || save_inner(&app, payload))
        .await
        .map_err(|error| localize(language, format!("保存常用服务器任务失败：{error}")))?
        .map_err(|error| localize(language, error))
}

#[tauri::command]
pub async fn get_saved_server_password(
    app: AppHandle,
    payload: DeleteServerRequest,
    language: UiLanguage,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || password_inner(&app, payload))
        .await
        .map_err(|error| localize(language, format!("读取服务器密码任务失败：{error}")))?
        .map_err(|error| localize(language, error))
}

#[tauri::command]
pub async fn delete_saved_server(
    app: AppHandle,
    payload: DeleteServerRequest,
    language: UiLanguage,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || delete_inner(&app, payload))
        .await
        .map_err(|error| localize(language, format!("删除常用服务器任务失败：{error}")))?
        .map_err(|error| localize(language, error))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn metadata_round_trip_never_contains_password() {
        let directory = std::env::temp_dir().join(format!("iperf3-ui-test-{}", new_id()));
        let path = directory.join(METADATA_FILE);
        let records = vec![SavedServerMetadata {
            id: "server-1".into(),
            note: "上海测试节点".into(),
            host: "10.0.0.8".into(),
            ssh_port: 22,
            iperf_port: 5201,
            remote_iperf_path: "/opt/bin/iperf3".into(),
            bind_ip: "192.168.10.8".into(),
            server_mode: ServerMode::SshManaged,
            username: "tester".into(),
            auth_method: SshAuthMethod::Password,
            private_key_path: String::new(),
        }];

        write_metadata(&path, &records).expect("write metadata");
        let raw = fs::read_to_string(&path).expect("read raw metadata");
        let restored = read_metadata(&path).expect("read metadata");

        assert_eq!(restored, records);
        assert!(!raw.contains("\"password\":"));
        assert!(raw.contains("/opt/bin/iperf3"));
        assert!(raw.contains("192.168.10.8"));
        let _ = fs::remove_dir_all(directory);
    }

    #[test]
    fn legacy_metadata_without_note_remains_readable() {
        let legacy = br#"[{"id":"server-1","host":"10.0.0.8","sshPort":22,"iperfPort":5201,"username":"root"}]"#;
        let restored: Vec<SavedServerMetadata> =
            serde_json::from_slice(legacy).expect("read legacy metadata");

        assert_eq!(restored[0].note, "");
        assert_eq!(restored[0].bind_ip, "");
    }

    #[test]
    fn credential_vault_keeps_all_passwords_in_one_payload() {
        let mut vault = CredentialVault::default();
        vault
            .credentials
            .insert("server-1".into(), "first-secret".into());
        vault
            .credentials
            .insert("server-2".into(), "second-secret".into());

        let encoded = serde_json::to_vec(&vault).expect("serialize vault");
        let restored: CredentialVault = serde_json::from_slice(&encoded).expect("read vault");

        assert_eq!(restored, vault);
        assert_eq!(restored.credentials.len(), 2);
    }

    #[cfg(any(target_os = "linux", target_os = "windows"))]
    #[test]
    fn native_credential_store_round_trip_when_enabled() {
        if std::env::var_os("QUANTUM_LEAP_CREDENTIAL_TEST").is_none() {
            return;
        }
        let service = format!("{KEYCHAIN_SERVICE}.integration-test.{}", new_id());
        let id = format!("integration-test-{}", new_id());
        let entry = credential_entry_for(&service, &id).expect("open credential store");
        entry
            .set_password("temporary-secret")
            .expect("store credential");
        assert_eq!(
            entry.get_password().expect("read credential"),
            "temporary-secret"
        );
        entry.delete_credential().expect("delete credential");
        assert!(entry.get_password().is_err());
    }
}
