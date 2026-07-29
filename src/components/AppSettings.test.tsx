import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppUpdateState } from "../features/app-update/app-update";
import { I18nProvider } from "../lib/i18n";
import { AppSettings } from "./AppSettings";

const updateMocks = vi.hoisted(() => ({
  check: vi.fn(async () => undefined),
  install: vi.fn(async () => undefined),
  state: {
    phase: "available",
    currentVersion: "1.4.0",
    availableVersion: "1.5.0",
    body: "Improved update delivery.",
    installMode: "appInstall",
    downloadedBytes: 0
  } as AppUpdateState
}));

vi.mock("../features/app-update/app-update", () => ({
  checkForAppUpdate: updateMocks.check,
  installAppUpdate: updateMocks.install,
  startAutomaticUpdateCheck: updateMocks.check,
  useAppUpdate: () => updateMocks.state
}));

function renderSettings(busy = false) {
  return render(
    <I18nProvider>
      <AppSettings open busy={busy} onOpenChange={vi.fn()} />
    </I18nProvider>
  );
}

describe("application update settings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    updateMocks.state = {
      phase: "available",
      currentVersion: "1.4.0",
      availableVersion: "1.5.0",
      body: "Improved update delivery.",
      installMode: "appInstall",
      downloadedBytes: 0
    };
  });

  it("shows an update indicator and opens the confirmation dialog", async () => {
    const user = userEvent.setup();
    const { container } = renderSettings();

    expect(container.querySelector(".update-available-dot")).not.toBeNull();
    await user.click(screen.getByRole("button", { name: "Version 1.5.0 available" }));

    expect(screen.getByRole("dialog", { name: "Update available" })).not.toBeNull();
    expect(screen.getByText("Current version 1.4.0")).not.toBeNull();
    expect(screen.getByText("New version 1.5.0")).not.toBeNull();
    await user.click(screen.getByRole("button", { name: "Update and restart" }));
    expect(updateMocks.install).toHaveBeenCalledTimes(1);
  });

  it("blocks installation while a speed test is active", async () => {
    const user = userEvent.setup();
    renderSettings(true);
    await user.click(screen.getByRole("button", { name: "Version 1.5.0 available" }));

    expect(screen.getByText("Finish the current test before installing the update.")).not.toBeNull();
    expect((screen.getByRole("button", { name: "Update and restart" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("uses the external download action for DEB installations and restores trigger focus", async () => {
    updateMocks.state = { ...updateMocks.state, installMode: "externalDownload" };
    const user = userEvent.setup();
    renderSettings();
    const trigger = screen.getByRole("button", { name: "Settings" });
    await user.click(screen.getByRole("button", { name: "Version 1.5.0 available" }));
    expect(screen.getByRole("button", { name: "Open download page" })).not.toBeNull();

    await user.click(screen.getByRole("button", { name: "Later" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Update available" })).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });

  it("renders Simplified Chinese update copy", async () => {
    localStorage.setItem("quantum-leap.language", "zh-CN");
    const user = userEvent.setup();
    renderSettings();
    await user.click(screen.getByRole("button", { name: "发现版本 1.5.0" }));
    expect(screen.getByRole("dialog", { name: "发现新版本" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "更新并重新启动" })).not.toBeNull();
  });
});
