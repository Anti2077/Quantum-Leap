mod app_update;
mod commands;
mod i18n;
mod iperf;
mod model;
mod saved_server;
mod session;
mod ssh;

use commands::{start_speed_test, stop_speed_test};
use session::{cleanup_before_exit, AppState};
use tauri::RunEvent;

fn main() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            start_speed_test,
            stop_speed_test,
            saved_server::list_saved_servers,
            saved_server::get_saved_server_password,
            saved_server::save_server,
            saved_server::delete_saved_server,
            app_update::update_install_mode
        ])
        .build(tauri::generate_context!())
        .expect("failed to build app");

    app.run(|handle, event| {
        if matches!(event, RunEvent::ExitRequested { .. }) {
            cleanup_before_exit(handle);
        }
    });
}
