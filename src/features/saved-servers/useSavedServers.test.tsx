import { act, renderHook, waitFor } from "@testing-library/react";
import { useState, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getSavedServerPassword,
  listSavedServers,
  saveServer
} from "../../lib/api";
import { I18nProvider } from "../../lib/i18n";
import type { SavedServer } from "../../lib/types";
import {
  initialForm,
  initialRemoteClientForm,
  type ConnectionForm,
  type RemoteClientForm
} from "../speed-test/form-model";
import { useSavedServers } from "./useSavedServers";

vi.mock("../../lib/api", () => ({
  deleteSavedServer: vi.fn(),
  getSavedServerPassword: vi.fn(),
  listSavedServers: vi.fn(),
  saveServer: vi.fn()
}));

const savedServer: SavedServer = {
  id: "saved-1",
  note: "lab",
  host: "192.0.2.10",
  sshPort: 22,
  iperfPort: 5201,
  remoteIperfPath: "/opt/bin/iperf3",
  bindIp: "192.0.2.11",
  serverMode: "sshManaged",
  username: "operator",
  password: "",
  authMethod: "password",
  privateKeyPath: ""
};

function wrapper({ children }: { children: ReactNode }) {
  return <I18nProvider>{children}</I18nProvider>;
}

describe("saved server controller", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listSavedServers).mockResolvedValue([savedServer]);
  });

  it("loads a saved client with its protected credential", async () => {
    vi.mocked(getSavedServerPassword).mockResolvedValue("stored-password");
    const setStatus = vi.fn();
    const { result } = renderHook(() => {
      const [form, setForm] = useState<ConnectionForm>(initialForm);
      const [clientForm, setClientForm] = useState<RemoteClientForm>(initialRemoteClientForm);
      const saved = useSavedServers({
        form,
        setForm,
        setClientForm,
        setStatus,
        initialServers: []
      });
      return { clientForm, saved };
    }, { wrapper });

    await waitFor(() => expect(result.current.saved.servers).toHaveLength(1));
    await act(async () => {
      await result.current.saved.selectClient(savedServer.id);
    });

    expect(getSavedServerPassword).toHaveBeenCalledWith(savedServer.id, "en");
    expect(result.current.clientForm).toMatchObject({
      host: savedServer.host,
      username: savedServer.username,
      password: "stored-password"
    });
    expect(setStatus).toHaveBeenCalledWith({
      phase: "idle",
      message: "lab is now the test initiator"
    });
  });

  it("saves the current endpoint and updates the local list", async () => {
    const form = {
      ...initialForm,
      host: "198.51.100.20",
      username: "operator",
      password: "secret"
    };
    const saved = { ...savedServer, id: "saved-2", host: form.host };
    vi.mocked(saveServer).mockResolvedValue(saved);
    const { result } = renderHook(() => {
      const [serverForm, setServerForm] = useState<ConnectionForm>(form);
      const [, setClientForm] = useState<RemoteClientForm>(initialRemoteClientForm);
      return useSavedServers({
        form: serverForm,
        setForm: setServerForm,
        setClientForm,
        setStatus: vi.fn(),
        initialServers: []
      });
    }, { wrapper });

    await waitFor(() => expect(listSavedServers).toHaveBeenCalled());
    act(() => result.current.setNoteDraft("primary"));
    await act(async () => {
      await result.current.saveCurrent(true);
    });

    expect(saveServer).toHaveBeenCalledWith(
      expect.objectContaining({ host: form.host, note: "primary" }),
      "en"
    );
    expect(result.current.servers[0]).toEqual(saved);
  });
});
