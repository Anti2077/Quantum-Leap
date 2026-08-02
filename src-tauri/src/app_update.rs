use std::ffi::OsStr;

use serde::Serialize;

#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum UpdateInstallMode {
    AppInstall,
    ExternalDownload,
}

fn can_install_update_for(platform: &str, appimage: Option<&OsStr>) -> bool {
    match platform {
        "macos" => true,
        "linux" => appimage.is_some_and(|value| !value.is_empty()),
        _ => false,
    }
}

#[tauri::command]
pub fn update_install_mode() -> UpdateInstallMode {
    let appimage = std::env::var_os("APPIMAGE");
    if can_install_update_for(std::env::consts::OS, appimage.as_deref()) {
        UpdateInstallMode::AppInstall
    } else {
        UpdateInstallMode::ExternalDownload
    }
}

#[cfg(test)]
mod tests {
    use std::ffi::OsStr;

    use super::can_install_update_for;

    #[test]
    fn platform_install_modes_are_selected_correctly() {
        assert!(can_install_update_for("macos", None));
        assert!(!can_install_update_for("windows", None));
    }

    #[test]
    fn linux_requires_an_appimage_runtime() {
        assert!(can_install_update_for(
            "linux",
            Some(OsStr::new("/Applications/Quantum-Leap.AppImage"))
        ));
        assert!(!can_install_update_for("linux", None));
        assert!(!can_install_update_for("linux", Some(OsStr::new(""))));
    }
}
