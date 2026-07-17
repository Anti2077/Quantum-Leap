use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager};

#[cfg(target_os = "macos")]
use security_framework::passwords::{
    delete_generic_password, get_generic_password, set_generic_password,
};

const KEYCHAIN_SERVICE: &str = "com.codex.iperf3ui.saved-server";
const METADATA_FILE: &str = "saved-servers.json";

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveServerRequest {
    pub id: Option<String>,
    pub host: String,
    pub ssh_port: u16,
    pub iperf_port: u16,
    pub username: String,
    pub password: String,
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
    host: String,
    ssh_port: u16,
    iperf_port: u16,
    username: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedServer {
    id: String,
    host: String,
    ssh_port: u16,
    iperf_port: u16,
    username: String,
    password: String,
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
fn keychain_set(id: &str, password: &str) -> Result<(), String> {
    set_generic_password(KEYCHAIN_SERVICE, id, password.as_bytes())
        .map_err(|error| format!("保存密码到 macOS 钥匙串失败：{error}"))
}

#[cfg(target_os = "macos")]
fn keychain_get(id: &str) -> Result<String, String> {
    get_generic_password(KEYCHAIN_SERVICE, id)
        .map_err(|error| format!("从 macOS 钥匙串读取密码失败：{error}"))
        .and_then(|password| {
            String::from_utf8(password).map_err(|_| "钥匙串中的密码不是有效文本".to_string())
        })
}

#[cfg(target_os = "macos")]
fn keychain_delete(id: &str) {
    let _ = delete_generic_password(KEYCHAIN_SERVICE, id);
}

fn list_inner(app: &AppHandle) -> Result<Vec<SavedServer>, String> {
    let records = read_metadata(&metadata_path(app)?)?;
    Ok(records
        .into_iter()
        .map(|record| {
            SavedServer {
                id: record.id,
                host: record.host,
                ssh_port: record.ssh_port,
                iperf_port: record.iperf_port,
                username: record.username,
                // Passwords are unlocked lazily so launching the app never causes
                // one Keychain authorization dialog per saved server.
                password: String::new(),
            }
        })
        .collect())
}

fn password_inner(app: &AppHandle, request: DeleteServerRequest) -> Result<String, String> {
    let records = read_metadata(&metadata_path(app)?)?;
    if !records.iter().any(|record| record.id == request.id) {
        return Err("常用服务器不存在".into());
    }
    keychain_get(&request.id)
}

fn save_inner(app: &AppHandle, request: SaveServerRequest) -> Result<SavedServer, String> {
    let host = request.host.trim().to_owned();
    let username = request.username.trim().to_owned();
    if host.is_empty() || username.is_empty() || request.password.is_empty() {
        return Err("服务器地址、用户名和密码不能为空".into());
    }
    if request.ssh_port == 0 || request.iperf_port == 0 {
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
            })
        });
    let id = existing_index
        .map(|index| records[index].id.clone())
        .unwrap_or_else(new_id);
    let metadata = SavedServerMetadata {
        id: id.clone(),
        host: host.clone(),
        ssh_port: request.ssh_port,
        iperf_port: request.iperf_port,
        username: username.clone(),
    };

    keychain_set(&id, &request.password)?;
    if let Some(index) = existing_index {
        records[index] = metadata;
    } else {
        records.insert(0, metadata);
    }
    write_metadata(&path, &records)?;

    Ok(SavedServer {
        id,
        host,
        ssh_port: request.ssh_port,
        iperf_port: request.iperf_port,
        username,
        password: request.password,
    })
}

fn delete_inner(app: &AppHandle, request: DeleteServerRequest) -> Result<(), String> {
    let path = metadata_path(app)?;
    let mut records = read_metadata(&path)?;
    records.retain(|record| record.id != request.id);
    write_metadata(&path, &records)?;
    keychain_delete(&request.id);
    Ok(())
}

#[tauri::command]
pub async fn list_saved_servers(app: AppHandle) -> Result<Vec<SavedServer>, String> {
    tauri::async_runtime::spawn_blocking(move || list_inner(&app))
        .await
        .map_err(|error| format!("读取常用服务器任务失败：{error}"))?
}

#[tauri::command]
pub async fn save_server(
    app: AppHandle,
    payload: SaveServerRequest,
) -> Result<SavedServer, String> {
    tauri::async_runtime::spawn_blocking(move || save_inner(&app, payload))
        .await
        .map_err(|error| format!("保存常用服务器任务失败：{error}"))?
}

#[tauri::command]
pub async fn get_saved_server_password(
    app: AppHandle,
    payload: DeleteServerRequest,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || password_inner(&app, payload))
        .await
        .map_err(|error| format!("读取服务器密码任务失败：{error}"))?
}

#[tauri::command]
pub async fn delete_saved_server(
    app: AppHandle,
    payload: DeleteServerRequest,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || delete_inner(&app, payload))
        .await
        .map_err(|error| format!("删除常用服务器任务失败：{error}"))?
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
            host: "10.0.0.8".into(),
            ssh_port: 22,
            iperf_port: 5201,
            username: "tester".into(),
        }];

        write_metadata(&path, &records).expect("write metadata");
        let raw = fs::read_to_string(&path).expect("read raw metadata");
        let restored = read_metadata(&path).expect("read metadata");

        assert_eq!(restored, records);
        assert!(!raw.contains("password"));
        let _ = fs::remove_dir_all(directory);
    }
}
