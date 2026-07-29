import { act, renderHook } from "@testing-library/react";
import type { DownloadEvent } from "@tauri-apps/plugin-updater";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  check: vi.fn(),
  fetch: vi.fn(),
  getVersion: vi.fn(async () => "1.4.0"),
  getUpdateInstallMode: vi.fn<() => Promise<"appInstall" | "externalDownload">>(async () => "appInstall"),
  openUrl: vi.fn(async () => undefined),
  relaunch: vi.fn(async () => undefined)
}));

vi.mock("@tauri-apps/api/app", () => ({ getVersion: mocks.getVersion }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: mocks.openUrl }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: mocks.relaunch }));
vi.mock("@tauri-apps/plugin-updater", () => ({ check: mocks.check }));
vi.mock("../../lib/api", () => ({ getUpdateInstallMode: mocks.getUpdateInstallMode }));

import {
  checkForAppUpdate,
  installAppUpdate,
  LATEST_RELEASE_API,
  resetAppUpdateForTests,
  startAutomaticUpdateCheck,
  useAppUpdate
} from "./app-update";

function releaseFixture(version = "1.4.0") {
  return {
    tag_name: `v${version}`,
    body: `Release notes for ${version}`,
    published_at: "2026-07-29T00:00:00Z",
    html_url: `https://github.com/Anti2077/Quantum-Leap/releases/tag/v${version}`,
    draft: false,
    prerelease: false
  };
}

function mockLatestRelease(version = "1.4.0") {
  mocks.fetch.mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => releaseFixture(version)
  });
}

function updateFixture(
  downloadAndInstall: (onEvent?: (event: DownloadEvent) => void) => Promise<void> = vi.fn(async () => undefined)
) {
  return {
    currentVersion: "1.4.0",
    version: "1.5.0",
    body: "A faster update flow.",
    date: "2026-07-29T00:00:00Z",
    downloadAndInstall
  };
}

describe("app update state", () => {
  beforeEach(() => {
    resetAppUpdateForTests();
    vi.clearAllMocks();
    Object.defineProperty(window, "__TAURI_INTERNALS__", { configurable: true, value: {} });
    vi.stubGlobal("fetch", mocks.fetch);
    mocks.getUpdateInstallMode.mockResolvedValue("appInstall");
    mocks.getVersion.mockResolvedValue("1.4.0");
    mockLatestRelease();
  });

  it("runs the automatic check only once per process and skips a missing manifest for the current release", async () => {
    const { result } = renderHook(() => useAppUpdate());

    await act(async () => {
      await startAutomaticUpdateCheck();
      await startAutomaticUpdateCheck();
    });

    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(mocks.fetch).toHaveBeenCalledWith(LATEST_RELEASE_API, expect.any(Object));
    expect(mocks.check).not.toHaveBeenCalled();
    expect(result.current).toMatchObject({ phase: "upToDate", currentVersion: "1.4.0" });
  });

  it("keeps update metadata and relaunches after download and installation", async () => {
    mockLatestRelease("1.5.0");
    const downloadAndInstall = vi.fn(async (onEvent?: (event: DownloadEvent) => void) => {
      onEvent?.({ event: "Started", data: { contentLength: 100 } });
      onEvent?.({ event: "Progress", data: { chunkLength: 40 } });
      onEvent?.({ event: "Progress", data: { chunkLength: 60 } });
      onEvent?.({ event: "Finished" });
    });
    mocks.check.mockResolvedValue(updateFixture(downloadAndInstall));
    const { result } = renderHook(() => useAppUpdate());

    await act(async () => checkForAppUpdate());
    expect(result.current).toMatchObject({
      phase: "available",
      availableVersion: "1.5.0",
      body: "A faster update flow."
    });

    await act(async () => installAppUpdate());
    expect(downloadAndInstall).toHaveBeenCalledTimes(1);
    expect(mocks.relaunch).toHaveBeenCalledTimes(1);
    expect(result.current).toMatchObject({ phase: "installing", downloadedBytes: 100, totalBytes: 100 });
  });

  it("opens the release page instead of installing for external-download packages", async () => {
    mockLatestRelease("1.5.0");
    const downloadAndInstall = vi.fn();
    mocks.getUpdateInstallMode.mockResolvedValue("externalDownload");
    mocks.check.mockResolvedValue(updateFixture(downloadAndInstall));

    await act(async () => checkForAppUpdate());
    await act(async () => installAppUpdate());

    expect(mocks.openUrl).toHaveBeenCalledWith("https://github.com/Anti2077/Quantum-Leap/releases/tag/v1.5.0");
    expect(downloadAndInstall).not.toHaveBeenCalled();
    expect(mocks.relaunch).not.toHaveBeenCalled();
  });

  it("distinguishes check failures from install failures", async () => {
    mocks.fetch.mockRejectedValueOnce(new Error("offline"));
    mocks.check.mockRejectedValueOnce(new Error("offline"));
    const { result } = renderHook(() => useAppUpdate());

    await act(async () => checkForAppUpdate());
    expect(result.current).toMatchObject({ phase: "error", errorContext: "check" });

    mockLatestRelease("1.5.0");
    mocks.check.mockResolvedValueOnce(updateFixture(vi.fn(async () => Promise.reject(new Error("bad signature")))));
    await act(async () => checkForAppUpdate());
    await act(async () => installAppUpdate());
    expect(result.current).toMatchObject({ phase: "error", errorContext: "install", availableVersion: "1.5.0" });
  });

  it("offers the release page when a newer bootstrap release has no updater manifest", async () => {
    mockLatestRelease("1.5.0");
    mocks.check.mockRejectedValue(new Error("Could not fetch a valid release JSON from the remote"));
    const { result } = renderHook(() => useAppUpdate());

    await act(async () => checkForAppUpdate());
    expect(result.current).toMatchObject({
      phase: "available",
      currentVersion: "1.4.0",
      availableVersion: "1.5.0",
      installMode: "externalDownload",
      releaseUrl: "https://github.com/Anti2077/Quantum-Leap/releases/tag/v1.5.0"
    });

    await act(async () => installAppUpdate());
    expect(mocks.openUrl).toHaveBeenCalledWith("https://github.com/Anti2077/Quantum-Leap/releases/tag/v1.5.0");
  });

  it("does not hide invalid updater metadata behind the download-page fallback", async () => {
    mockLatestRelease("1.5.0");
    mocks.check.mockRejectedValue(new Error("invalid updater signature metadata"));
    const { result } = renderHook(() => useAppUpdate());

    await act(async () => checkForAppUpdate());
    expect(result.current).toMatchObject({ phase: "error", errorContext: "check" });
    expect(result.current.installMode).toBe("appInstall");
  });

  it("allows a manual retry after both update sources fail", async () => {
    mocks.fetch.mockRejectedValueOnce(new Error("offline"));
    mocks.check.mockRejectedValueOnce(new Error("offline"));
    const { result } = renderHook(() => useAppUpdate());

    await act(async () => checkForAppUpdate());
    expect(result.current).toMatchObject({ phase: "error", errorContext: "check" });

    mockLatestRelease();
    await act(async () => checkForAppUpdate());
    expect(result.current).toMatchObject({ phase: "upToDate", currentVersion: "1.4.0" });
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    expect(mocks.check).toHaveBeenCalledTimes(1);
  });

  it("falls back to the signed updater when GitHub release metadata is unavailable", async () => {
    mocks.fetch.mockRejectedValue(new Error("API unavailable"));
    mocks.check.mockResolvedValue(null);
    const { result } = renderHook(() => useAppUpdate());

    await act(async () => checkForAppUpdate());
    expect(result.current).toMatchObject({ phase: "upToDate", currentVersion: "1.4.0" });
    expect(mocks.check).toHaveBeenCalledTimes(1);
  });
});
