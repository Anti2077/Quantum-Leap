import { describe, expect, it } from "vitest";
import type { SavedServer } from "../../lib/types";
import { initialForm, initialRemoteClientForm } from "./form-model";
import {
  buildSaveServerRequest,
  savedServerToClientForm,
  swapRemoteEndpointForms
} from "./endpoint-model";

const saved: SavedServer = {
  id: "server-1",
  note: "edge",
  host: "198.51.100.10",
  sshPort: 2222,
  iperfPort: 5202,
  remoteIperfPath: "/opt/bin/iperf3",
  bindIp: "198.51.100.11",
  serverMode: "sshManaged",
  username: "operator",
  password: "",
  authMethod: "privateKey",
  privateKeyPath: "/keys/edge"
};

describe("endpoint model", () => {
  it("maps saved private-key credentials to a remote client", () => {
    expect(savedServerToClientForm(saved, "passphrase", "fallback")).toMatchObject({
      host: saved.host,
      sshPort: "2222",
      password: "passphrase",
      passphrase: "passphrase",
      privateKeyPath: "/keys/edge"
    });
  });

  it("swaps remote endpoints without changing test parameters", () => {
    const server = { ...initialForm, host: "server", username: "server-user", password: "server-secret" };
    const client = { ...initialRemoteClientForm, host: "client", username: "client-user", password: "client-secret" };
    const swapped = swapRemoteEndpointForms(server, client);

    expect(swapped.server).toMatchObject({ host: "client", username: "client-user", testMode: "standard" });
    expect(swapped.client).toMatchObject({ host: "server", username: "server-user" });
  });

  it("normalizes saved-server payloads and stores the active credential", () => {
    const request = buildSaveServerRequest(
      {
        ...initialForm,
        host: " edge.example ",
        username: " operator ",
        authMethod: "privateKey",
        privateKeyPath: " /keys/edge ",
        passphrase: "secret"
      },
      " primary ",
      "existing"
    );
    expect(request).toMatchObject({
      id: "existing",
      note: "primary",
      host: "edge.example",
      username: "operator",
      password: "secret",
      privateKeyPath: "/keys/edge"
    });
  });
});
