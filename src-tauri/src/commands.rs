use crate::{
    model::{SpeedTestRequest, UiLanguage},
    session::{self, AppState},
};
use tauri::{AppHandle, State};

#[tauri::command]
pub(crate) async fn start_speed_test(
    app: AppHandle,
    state: State<'_, AppState>,
    payload: SpeedTestRequest,
) -> Result<(), String> {
    session::start(app, state, payload).await
}

#[tauri::command]
pub(crate) async fn stop_speed_test(
    app: AppHandle,
    state: State<'_, AppState>,
    language: UiLanguage,
) -> Result<(), String> {
    session::stop(app, state, language).await
}
