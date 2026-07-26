// @vitest-environment node
import { describe, expect, it } from "vitest";
import { analyzeLinkHealth, type HealthSample } from "./link-health";

function tcpSamples(scale = 1): HealthSample[] {
  return Array.from({ length: 20 }, (_, index) => ({
    bps: (900_000_000 + Math.sin(index) * 20_000_000) * scale,
    bytes: 56_250_000 * scale,
    retransmits: 0,
    latencyMs: 5 + Math.sin(index) * 0.4,
    baselineLatencyMs: 3,
    jitterMs: 0.4,
    packets: null,
    lostPackets: null,
    lossPercent: null,
    omitted: false
  }));
}

describe("link health diagnostics", () => {
  it("does not use absolute throughput in the health score", () => {
    const slow = analyzeLinkHealth("tcp", tcpSamples(0.1));
    const fast = analyzeLinkHealth("tcp", tcpSamples(10));

    expect(slow.score).toBe(fast.score);
    expect(slow.level).toBe(fast.level);
  });

  it("reports a healthy stable TCP transfer", () => {
    const report = analyzeLinkHealth("tcp", tcpSamples());

    expect(report.score).toBeGreaterThanOrEqual(85);
    expect(report.level).toBe("healthy");
    expect(report.confidence).toBe("full");
  });

  it("penalizes sustained retransmissions instead of a fixed total", () => {
    const samples = tcpSamples().map((sample, index) => ({
      ...sample,
      retransmits: index < 12 ? 15 : 0
    }));
    const report = analyzeLinkHealth("tcp", samples);
    const retransmission = report.metrics.find((metric) => metric.key === "retransmission");

    expect(retransmission?.level).toBe("poor");
    expect(retransmission?.secondaryValue).toBe(60);
  });

  it("treats zero-throughput intervals as transfer stalls", () => {
    const samples = tcpSamples().map((sample, index) => index < 4
      ? { ...sample, bps: 0, bytes: 0 }
      : sample);
    const report = analyzeLinkHealth("tcp", samples);
    const stability = report.metrics.find((metric) => metric.key === "transferStability");

    expect(stability?.level).toBe("poor");
    expect(stability?.primaryValue).toBe(0);
  });

  it("uses weighted UDP packet loss from the final summary", () => {
    const report = analyzeLinkHealth("udp", tcpSamples(), [{
      seconds: 10,
      bandwidthBps: 100_000_000,
      bytes: 125_000_000,
      jitterMs: 2,
      retransmits: null,
      packets: 10_000,
      lostPackets: 250,
      lossPercent: 2.5,
      direction: "upload"
    }]);
    const loss = report.metrics.find((metric) => metric.key === "packetLoss");

    expect(loss?.primaryValue).toBe(2.5);
    expect(loss?.level).toBe("poor");
  });

  it("marks missing measurements as unavailable instead of healthy", () => {
    const samples = tcpSamples().map((sample) => ({
      ...sample,
      latencyMs: null,
      baselineLatencyMs: null
    }));
    const report = analyzeLinkHealth("tcp", samples);

    expect(report.confidence).toBe("partial");
    expect(report.metrics.find((metric) => metric.key === "loadedLatency")?.score).toBeNull();
    expect(report.metrics.find((metric) => metric.key === "latencyStability")?.score).toBeNull();
  });
});
