import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type DownloadEvent, type Update } from "@tauri-apps/plugin-updater";
import { useSyncExternalStore } from "react";
import packageMetadata from "../../../package.json";
import { getUpdateInstallMode, type UpdateInstallMode } from "../../lib/api";

export const RELEASES_URL = "https://github.com/Anti2077/Quantum-Leap/releases/latest";
export const LATEST_RELEASE_API = "https://api.github.com/repos/Anti2077/Quantum-Leap/releases/latest";

export type AppUpdatePhase =
  | "idle"
  | "checking"
  | "upToDate"
  | "available"
  | "downloading"
  | "installing"
  | "error";

export interface AppUpdateState {
  phase: AppUpdatePhase;
  currentVersion: string;
  availableVersion?: string;
  body?: string;
  date?: string;
  releaseUrl?: string;
  installMode: UpdateInstallMode;
  downloadedBytes: number;
  totalBytes?: number;
  errorContext?: "check" | "install";
}

function previewState(): AppUpdateState | null {
  if (!import.meta.env.DEV || typeof window === "undefined") return null;
  const preview = new URLSearchParams(window.location.search).get("updatePreview");
  if (preview !== "available") return null;
  return {
    phase: "available",
    currentVersion: packageMetadata.version,
    availableVersion: "1.5.0",
    body: "Improved update delivery and reliability.\n\n优化应用内更新的下载流程与可靠性。",
    date: "2026-07-29T00:00:00Z",
    installMode: "appInstall",
    downloadedBytes: 0
  };
}

const initialState: AppUpdateState = previewState() ?? {
  phase: "idle",
  currentVersion: packageMetadata.version,
  installMode: "appInstall",
  downloadedBytes: 0
};

let state = initialState;
let pendingUpdate: Update | null = null;
let pendingCheck: Promise<void> | null = null;
let automaticCheckStarted = false;
const listeners = new Set<() => void>();

function isTauriRuntime() {
  return "__TAURI_INTERNALS__" in window;
}

function publish(next: AppUpdateState) {
  state = next;
  listeners.forEach((listener) => listener());
}

function patchState(patch: Partial<AppUpdateState>) {
  publish({ ...state, ...patch });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function snapshot() {
  return state;
}

interface GitHubRelease {
  tag_name: string;
  body: string | null;
  published_at: string;
  html_url: string;
  draft: boolean;
  prerelease: boolean;
}

function parseStableVersion(version: string) {
  const match = version.trim().match(/^v?(\d+)\.(\d+)\.(\d+)$/);
  if (!match) throw new Error(`Invalid stable version: ${version}`);
  return match.slice(1).map(Number);
}

function compareStableVersions(left: string, right: string) {
  const leftParts = parseStableVersion(left);
  const rightParts = parseStableVersion(right);
  for (let index = 0; index < leftParts.length; index += 1) {
    if (leftParts[index] !== rightParts[index]) return leftParts[index] - rightParts[index];
  }
  return 0;
}

async function fetchLatestRelease(): Promise<GitHubRelease> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(LATEST_RELEASE_API, {
      headers: { Accept: "application/vnd.github+json" },
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`GitHub release request failed with status ${response.status}`);

    const release = await response.json() as Partial<GitHubRelease>;
    if (
      typeof release.tag_name !== "string"
      || typeof release.html_url !== "string"
      || typeof release.published_at !== "string"
      || release.draft
      || release.prerelease
    ) {
      throw new Error("GitHub returned invalid release metadata");
    }
    parseStableVersion(release.tag_name);
    return {
      tag_name: release.tag_name,
      body: typeof release.body === "string" ? release.body : null,
      published_at: release.published_at,
      html_url: release.html_url,
      draft: false,
      prerelease: false
    };
  } finally {
    window.clearTimeout(timeout);
  }
}

function isMissingUpdaterManifest(error: unknown) {
  return String(error).includes("Could not fetch a valid release JSON from the remote");
}

function publishAvailableFromRelease(
  currentVersion: string,
  release: GitHubRelease,
  installMode: UpdateInstallMode = "externalDownload"
) {
  pendingUpdate = null;
  publish({
    phase: "available",
    currentVersion,
    availableVersion: release.tag_name.replace(/^v/, ""),
    body: release.body ?? undefined,
    date: release.published_at,
    releaseUrl: release.html_url,
    installMode,
    downloadedBytes: 0
  });
}

async function performCheck() {
  patchState({ phase: "checking", errorContext: undefined });
  const [currentVersion, installMode] = await Promise.all([
    getVersion().catch(() => packageMetadata.version),
    getUpdateInstallMode().catch(() => "externalDownload" as const)
  ]);

  let latestRelease: GitHubRelease | undefined;
  try {
    latestRelease = await fetchLatestRelease();
    if (compareStableVersions(latestRelease.tag_name, currentVersion) <= 0) {
      pendingUpdate = null;
      publish({
        phase: "upToDate",
        currentVersion,
        installMode,
        downloadedBytes: 0
      });
      return;
    }
    if (installMode === "externalDownload") {
      publishAvailableFromRelease(currentVersion, latestRelease);
      return;
    }
  } catch {
    // The signed updater endpoint remains usable when GitHub's API is unavailable.
  }

  try {
    const update = await check({ timeout: 15_000 });
    if (!update) {
      if (latestRelease) {
        publishAvailableFromRelease(currentVersion, latestRelease);
        return;
      }
      pendingUpdate = null;
      publish({
        phase: "upToDate",
        currentVersion,
        installMode,
        downloadedBytes: 0
      });
      return;
    }

    pendingUpdate = update;
    publish({
      phase: "available",
      currentVersion: update.currentVersion || currentVersion,
      availableVersion: update.version,
      body: update.body,
      date: update.date,
      releaseUrl: latestRelease?.html_url,
      installMode,
      downloadedBytes: 0
    });
  } catch (error) {
    if (latestRelease && isMissingUpdaterManifest(error)) {
      publishAvailableFromRelease(currentVersion, latestRelease);
      return;
    }
    patchState({ phase: "error", errorContext: "check" });
  }
}

export function checkForAppUpdate() {
  if (!isTauriRuntime()) return Promise.resolve();
  if (pendingCheck) return pendingCheck;

  pendingCheck = performCheck().finally(() => {
    pendingCheck = null;
  });
  return pendingCheck;
}

export function startAutomaticUpdateCheck() {
  if (automaticCheckStarted) return pendingCheck ?? Promise.resolve();
  automaticCheckStarted = true;
  return checkForAppUpdate();
}

function handleDownloadEvent(event: DownloadEvent) {
  if (event.event === "Started") {
    patchState({
      phase: "downloading",
      downloadedBytes: 0,
      totalBytes: event.data.contentLength
    });
  } else if (event.event === "Progress") {
    patchState({
      phase: "downloading",
      downloadedBytes: state.downloadedBytes + event.data.chunkLength
    });
  } else {
    patchState({ phase: "installing" });
  }
}

export async function installAppUpdate() {
  if (state.installMode === "externalDownload") {
    try {
      await openUrl(state.releaseUrl ?? RELEASES_URL);
    } catch {
      patchState({ phase: "error", errorContext: "install" });
      throw new Error("Unable to open the release page");
    }
    return;
  }
  if (!pendingUpdate || state.phase === "downloading" || state.phase === "installing") return;

  patchState({ phase: "downloading", downloadedBytes: 0, totalBytes: undefined, errorContext: undefined });
  try {
    await pendingUpdate.downloadAndInstall(handleDownloadEvent);
    patchState({ phase: "installing" });
    await relaunch();
  } catch {
    patchState({ phase: "error", errorContext: "install" });
  }
}

export function useAppUpdate() {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

export function resetAppUpdateForTests() {
  state = initialState;
  pendingUpdate = null;
  pendingCheck = null;
  automaticCheckStarted = false;
  listeners.clear();
}
