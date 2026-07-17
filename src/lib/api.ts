import { invoke } from "@tauri-apps/api/core";
import type { SavedServer, SaveServerRequest, SpeedTestRequest } from "./types";

export const startSpeedTest = (payload: SpeedTestRequest) => invoke("start_speed_test", { payload });
export const stopSpeedTest = () => invoke("stop_speed_test");

export const listSavedServers = () => invoke<SavedServer[]>("list_saved_servers");
export const getSavedServerPassword = (id: string) =>
  invoke<string>("get_saved_server_password", { payload: { id } });
export const saveServer = (payload: SaveServerRequest) =>
  invoke<SavedServer>("save_server", { payload });
export const deleteSavedServer = (id: string) =>
  invoke("delete_saved_server", { payload: { id } });
