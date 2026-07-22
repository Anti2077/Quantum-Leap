import { invoke } from "@tauri-apps/api/core";
import type { UiLanguage } from "./i18n";
import type { SavedServer, SaveServerRequest, SpeedTestRequest } from "./types";

export const startSpeedTest = (payload: SpeedTestRequest) => invoke("start_speed_test", { payload });
export const stopSpeedTest = (language: UiLanguage) => invoke("stop_speed_test", { language });

export const listSavedServers = (language: UiLanguage) =>
  invoke<SavedServer[]>("list_saved_servers", { language });
export const getSavedServerPassword = (id: string, language: UiLanguage) =>
  invoke<string>("get_saved_server_password", { payload: { id }, language });
export const saveServer = (payload: SaveServerRequest, language: UiLanguage) =>
  invoke<SavedServer>("save_server", { payload, language });
export const deleteSavedServer = (id: string, language: UiLanguage) =>
  invoke("delete_saved_server", { payload: { id }, language });
