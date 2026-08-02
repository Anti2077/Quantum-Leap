import { describe, expect, it } from "vitest";
import { applyReceiverSummary, type SampleSummary } from "./results-model";

const sampled: SampleSummary = {
  average: 8_000_000_000,
  peak: 12_000_000_000,
  bytes: 10_000_000_000,
  retransmits: 0,
  latency: 4,
  jitter: null
};

describe("receiver summaries", () => {
  it("uses received UDP throughput and quality without fabricating a receiver peak", () => {
    const result = applyReceiverSummary(sampled, {
      bandwidthBps: 950_000_000,
      bytes: 1_187_500_000,
      jitterMs: 0.42,
      lostPackets: 12_500,
      packets: 100_000,
      lostPercent: 12.5,
      direction: "upload"
    });

    expect(result).toMatchObject({
      average: 950_000_000,
      peak: 12_000_000_000,
      bytes: 1_187_500_000,
      latency: 4,
      jitter: 0.42
    });
  });

  it("preserves live sampled statistics before a receiver summary arrives", () => {
    expect(applyReceiverSummary(sampled)).toBe(sampled);
  });
});
