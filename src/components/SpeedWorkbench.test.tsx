import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { listSavedServers } from "../lib/api";
import { I18nProvider } from "../lib/i18n";
import { SpeedWorkbench } from "./SpeedWorkbench";

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => undefined)
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: vi.fn(() => ({ startDragging: vi.fn() }))
}));

vi.mock("../lib/api", () => ({
  deleteSavedServer: vi.fn(),
  getSavedServerPassword: vi.fn(),
  listSavedServers: vi.fn(async () => []),
  saveServer: vi.fn(),
  startSpeedTest: vi.fn(),
  stopSpeedTest: vi.fn()
}));

function mockCompactLayout(compact: boolean) {
  vi.mocked(window.matchMedia).mockImplementation((query: string) => ({
    matches: query === "(max-width: 860px)" ? compact : false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn()
  }));
}

function renderWorkbench() {
  return render(
    <I18nProvider>
      <SpeedWorkbench />
    </I18nProvider>
  );
}

describe("responsive workspace", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.dataset.colorTheme = "dark";
    mockCompactLayout(false);
  });

  it("shows the adjustable workspace at supported window widths", async () => {
    const user = userEvent.setup();
    renderWorkbench();

    expect(document.querySelector("aside.connection-column")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Configure connection" })).toBeNull();

    const separator = screen.getByRole("separator", {
      name: "Resize connection settings and test results"
    });
    expect(separator.getAttribute("aria-valuenow")).toBe("32");

    separator.focus();
    await user.keyboard("{ArrowRight}");
    expect(separator.getAttribute("aria-valuenow")).toBe("34");
    await waitFor(() => expect(localStorage.getItem("pulse.layout-split")).toBe("0.34"));

    await user.dblClick(separator);
    expect(separator.getAttribute("aria-valuenow")).toBe("32");

    const main = document.querySelector("main.app-content") as HTMLElement;
    vi.spyOn(main, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      right: 1000,
      bottom: 700,
      left: 0,
      width: 1000,
      height: 700,
      toJSON: () => undefined
    });
    Object.defineProperty(separator, "setPointerCapture", { value: vi.fn() });
    fireEvent.pointerDown(separator, { button: 0, clientX: 500, pointerId: 1 });
    expect(separator.getAttribute("aria-valuenow")).toBe("50");
  });

  it("uses the command bar and avoids layout persistence in compact mode", () => {
    mockCompactLayout(true);
    const getItem = vi.spyOn(localStorage, "getItem");
    renderWorkbench();

    expect(document.querySelector("aside.connection-column")).toBeNull();
    expect(screen.queryByRole("separator")).toBeNull();
    expect(screen.getByRole("button", { name: "Configure connection" })).not.toBeNull();
    expect(getItem).not.toHaveBeenCalledWith("pulse.layout-split");
  });
});

describe("connection drawer", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.dataset.colorTheme = "dark";
    mockCompactLayout(true);
  });

  it("uses Escape to leave endpoint editing before closing and restores focus", async () => {
    const user = userEvent.setup();
    renderWorkbench();

    const trigger = screen.getByRole("button", { name: "Configure connection" });
    await user.click(trigger);
    expect(screen.getByRole("dialog", { name: "Connect to server" })).not.toBeNull();

    await user.click(screen.getByRole("button", { name: "Device-to-device" }));
    expect(screen.getByRole("region", { name: "Initiator configuration" })).not.toBeNull();
    const serverTrigger = screen.getByRole("button", { name: "Edit device B (server)" });
    await user.click(serverTrigger);
    expect(screen.getByRole("region", { name: "Server configuration" })).not.toBeNull();
    expect(document.activeElement).toBe(serverTrigger);
    await user.click(screen.getByRole("button", { name: "Edit device A (initiator)" }));
    expect(screen.getByRole("region", { name: "Initiator configuration" })).not.toBeNull();

    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(screen.queryByRole("region", { name: "Initiator configuration" })).toBeNull();
    });
    expect(screen.getByRole("dialog", { name: "Device-to-device" })).not.toBeNull();

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });
});

describe("saved server popover", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.dataset.colorTheme = "light";
    mockCompactLayout(false);
    vi.mocked(listSavedServers).mockResolvedValue([
      {
        id: "saved-1",
        note: "fnos",
        host: "192.168.11.128",
        sshPort: 22,
        iperfPort: 5201,
        remoteIperfPath: "iperf3",
        bindIp: "",
        serverMode: "sshManaged",
        username: "anti",
        password: "",
        authMethod: "password",
        privateKeyPath: ""
      }
    ]);
  });

  it("renders readable server details and restores focus after Escape", async () => {
    const user = userEvent.setup();
    renderWorkbench();

    const trigger = screen.getByRole("button", { name: "Favorites" });
    await waitFor(() => expect(listSavedServers).toHaveBeenCalled());
    await user.click(trigger);

    expect(await screen.findByText("fnos")).not.toBeNull();
    expect(screen.getByText("192.168.11.128")).not.toBeNull();
    expect(screen.getByText("SSH 22 - anti")).not.toBeNull();

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByText("fnos")).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });
});
