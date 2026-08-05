import { describe, expect, it } from "vitest";
import contract from "../../contracts/speed-test.json";
import { SPEED_EVENT_NAMES } from "./speed-events";
import type {
  RemoteClientRequest,
  SpeedPromptEvent,
  SpeedSample,
  SpeedStateEvent,
  SpeedSummary,
  SpeedTestRequest
} from "./types";

function enumValue<const T extends readonly string[]>(value: string, allowed: T): T[number] {
  expect(allowed).toContain(value);
  return value as T[number];
}

function expectExactKeys(value: object, keys: string[]) {
  expect(Object.keys(value).sort()).toEqual([...keys].sort());
}

describe("Tauri speed-test contract", () => {
  it("keeps command request fields and enum values aligned", () => {
    const remoteClient: RemoteClientRequest = {
      ...contract.request.remoteClient,
      authMethod: enumValue(contract.request.remoteClient.authMethod, ["password", "privateKey"])
    };
    const request: SpeedTestRequest = {
      ...contract.request,
      language: enumValue(contract.request.language, ["en", "zh-CN"]),
      serverMode: enumValue(contract.request.serverMode, ["sshManaged", "existing"]),
      authMethod: enumValue(contract.request.authMethod, ["password", "privateKey"]),
      testMode: enumValue(contract.request.testMode, ["standard", "advanced"]),
      direction: enumValue(contract.request.direction, ["upload", "download"]),
      protocol: enumValue(contract.request.protocol, ["tcp", "udp"]),
      testTopology: enumValue(contract.request.testTopology, ["localToRemote", "remoteToRemote"]),
      remoteClient
    };

    expectExactKeys(request, [
      "language", "host", "sshPort", "iperfPort", "remoteIperfPath", "localBindIp",
      "serverBindIp", "serverMode", "username", "password", "authMethod", "privateKeyPath",
      "passphrase", "testMode", "direction", "protocol", "parallelStreams", "durationSeconds",
      "targetBitrateBps", "reuseExistingServer", "allowHostKeyMismatch", "testTopology",
      "remoteClient"
    ]);
    expectExactKeys(remoteClient, [
      "host", "sshPort", "remoteIperfPath", "bindIp", "username", "password", "authMethod",
      "privateKeyPath", "passphrase", "allowHostKeyMismatch"
    ]);
    expect(request).toEqual(contract.request);
  });

  it("keeps event names and payloads aligned", () => {
    const state: SpeedStateEvent = {
      ...contract.events.state,
      phase: enumValue(contract.events.state.phase, [
        "idle", "starting", "confirming", "running", "stopping", "completed", "cancelled", "failed"
      ])
    };
    const prompt: SpeedPromptEvent = {
      ...contract.events.prompt,
      kind: enumValue(contract.events.prompt.kind, [
        "hostKeyMismatch", "clientHostKeyMismatch", "existingServer", "iperf3Missing",
        "clientIperf3Missing", "serverUnavailable"
      ])
    };
    const sample: SpeedSample = {
      ...contract.events.sample,
      direction: enumValue(contract.events.sample.direction, ["upload", "download"])
    };
    const summary: SpeedSummary = {
      ...contract.events.summary,
      direction: enumValue(contract.events.summary.direction, ["upload", "download"])
    };

    expect(SPEED_EVENT_NAMES).toEqual(contract.eventNames);
    expectExactKeys(state, ["phase", "message"]);
    expectExactKeys(prompt, ["kind", "title", "message", "detail"]);
    expectExactKeys(sample, [
      "elapsed", "bandwidthBps", "bytes", "latencyMs", "jitterMs", "retransmits", "direction"
    ]);
    expectExactKeys(summary, [
      "bandwidthBps", "bytes", "jitterMs", "lostPackets", "packets", "lostPercent", "direction"
    ]);
  });
});
