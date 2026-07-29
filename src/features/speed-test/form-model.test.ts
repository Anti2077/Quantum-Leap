import { describe, expect, it } from "vitest";
import {
  buildSpeedTestRequest,
  confirmSpeedTestRequest,
  deriveTestConfiguration,
  initialForm,
  initialRemoteClientForm,
  type ConnectionForm,
  type RemoteClientForm
} from "./form-model";

function serverForm(overrides: Partial<ConnectionForm> = {}): ConnectionForm {
  return {
    ...initialForm,
    host: " 192.0.2.10 ",
    username: " operator ",
    password: "secret",
    ...overrides
  };
}

describe("speed test form model", () => {
  it("derives and builds the fixed standard profile", () => {
    const form = serverForm({
      protocol: "udp",
      parallelStreams: "24",
      durationSeconds: "60",
      rateLimitEnabled: true,
      targetBitrateMbps: "125"
    });
    const derived = deriveTestConfiguration(form, initialRemoteClientForm);
    const request = buildSpeedTestRequest("en", form, initialRemoteClientForm, derived);

    expect(derived.valid).toBe(true);
    expect(request).toMatchObject({
      host: "192.0.2.10",
      username: "operator",
      protocol: "tcp",
      parallelStreams: 8,
      durationSeconds: 10,
      targetBitrateBps: 125_000_000,
      testTopology: "localToRemote",
      remoteClient: null
    });
  });

  it("accepts continuous advanced tests and rejects invalid rate limits", () => {
    const continuous = deriveTestConfiguration(
      serverForm({ testMode: "advanced", durationSeconds: "0", parallelStreams: "32" }),
      initialRemoteClientForm
    );
    const invalidRate = deriveTestConfiguration(
      serverForm({ rateLimitEnabled: true, targetBitrateMbps: "100001" }),
      initialRemoteClientForm
    );

    expect(continuous).toMatchObject({ valid: true, continuous: true, duration: 0, parallelStreams: 32 });
    expect(invalidRate).toMatchObject({ valid: false, rateLimitValid: false, targetBitrateBps: 0 });
  });

  it("builds a private-key remote-to-remote request", () => {
    const form = serverForm({
      testTopology: "remoteToRemote",
      authMethod: "privateKey",
      password: "",
      privateKeyPath: " ~/.ssh/server_ed25519 ",
      serverBindIp: "198.51.100.10"
    });
    const client: RemoteClientForm = {
      ...initialRemoteClientForm,
      host: " 203.0.113.20 ",
      username: " runner ",
      authMethod: "privateKey",
      privateKeyPath: " ~/.ssh/client_ed25519 ",
      bindIp: "203.0.113.21"
    };
    const derived = deriveTestConfiguration(form, client);
    const request = buildSpeedTestRequest("zh-CN", form, client, derived);

    expect(derived.valid).toBe(true);
    expect(request.localBindIp).toBe("");
    expect(request.serverBindIp).toBe("198.51.100.10");
    expect(request.remoteClient).toMatchObject({
      host: "203.0.113.20",
      username: "runner",
      privateKeyPath: "~/.ssh/client_ed25519",
      bindIp: "203.0.113.21",
      allowHostKeyMismatch: false
    });
  });

  it("sets only the confirmation flag requested by the prompt", () => {
    const request = buildSpeedTestRequest("en", serverForm(), initialRemoteClientForm);
    const serverTrust = confirmSpeedTestRequest(request, "hostKeyMismatch");
    const existing = confirmSpeedTestRequest(request, "existingServer");

    expect(serverTrust.allowHostKeyMismatch).toBe(true);
    expect(serverTrust.reuseExistingServer).toBe(false);
    expect(existing.reuseExistingServer).toBe(true);
    expect(existing.allowHostKeyMismatch).toBe(false);
  });
});
