import type { SpeedSample, SpeedSummary, TransferDirection } from "../../lib/types";

export interface SamplePoint {
  t: number;
  bps: number;
  bytes: number;
  retransmits: number;
  latencyMs: number | null;
  jitterMs: number | null;
  direction: TransferDirection;
}

export interface SampleSummary {
  average: number;
  peak: number;
  bytes: number;
  retransmits: number;
  latency: number | null;
  jitter: number | null;
}

export const SAMPLE_HISTORY_LIMIT = 280;

export function toSamplePoint(sample: SpeedSample): SamplePoint {
  return {
    t: sample.elapsed,
    bps: sample.bandwidthBps,
    bytes: sample.bytes,
    retransmits: sample.retransmits ?? 0,
    latencyMs: sample.latencyMs ?? null,
    jitterMs: sample.jitterMs ?? null,
    direction: sample.direction
  };
}

export function appendSample(samples: SamplePoint[], sample: SpeedSample): SamplePoint[] {
  return [...samples.slice(-(SAMPLE_HISTORY_LIMIT - 1)), toSamplePoint(sample)];
}

export function summarizeSamples(
  samples: SamplePoint[],
  direction?: TransferDirection
): SampleSummary {
  const selected = direction ? samples.filter((sample) => sample.direction === direction) : samples;
  const latency = selected.map((sample) => sample.latencyMs).filter((value): value is number => value != null);
  const jitter = selected.map((sample) => sample.jitterMs).filter((value): value is number => value != null);
  return {
    average: selected.length
      ? selected.reduce((sum, sample) => sum + sample.bps, 0) / selected.length
      : 0,
    peak: Math.max(...selected.map((sample) => sample.bps), 0),
    bytes: selected.reduce((sum, sample) => sum + sample.bytes, 0),
    retransmits: selected.reduce((sum, sample) => sum + sample.retransmits, 0),
    latency: latency.length ? latency.reduce((sum, value) => sum + value, 0) / latency.length : null,
    jitter: jitter.length ? jitter.reduce((sum, value) => sum + value, 0) / jitter.length : null
  };
}

export function applyReceiverSummary(
  sampled: SampleSummary,
  receiver?: SpeedSummary
): SampleSummary {
  if (!receiver) return sampled;
  return {
    ...sampled,
    average: receiver.bandwidthBps,
    bytes: receiver.bytes,
    jitter: receiver.jitterMs ?? null
  };
}
