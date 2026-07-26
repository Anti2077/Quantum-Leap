import type { SpeedSummary, TransportProtocol } from "./types";

export type HealthLevel = "healthy" | "good" | "attention" | "poor" | "unknown";
export type HealthConfidence = "full" | "partial" | "insufficient";
export type HealthMetricKey = "retransmission" | "packetLoss" | "loadedLatency" | "latencyStability" | "udpJitter" | "transferStability";

export interface HealthSample {
  bps: number;
  bytes: number;
  retransmits: number;
  latencyMs: number | null;
  baselineLatencyMs: number | null;
  jitterMs: number | null;
  packets: number | null;
  lostPackets: number | null;
  lossPercent: number | null;
  omitted: boolean;
}

export interface HealthMetric {
  key: HealthMetricKey;
  level: Exclude<HealthLevel, "healthy">;
  score: number | null;
  primaryValue: number | null;
  secondaryValue: number | null;
}

export interface HealthReport {
  protocol: TransportProtocol;
  score: number | null;
  level: HealthLevel;
  confidence: HealthConfidence;
  sampleCount: number;
  metrics: HealthMetric[];
}

type WeightedMetric = HealthMetric & { weight: number };

const clampScore = (score: number) => Math.max(0, Math.min(100, Math.round(score)));

function percentile(values: number[], fraction: number) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = (sorted.length - 1) * fraction;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

function metricLevel(score: number | null): HealthMetric["level"] {
  if (score == null) return "unknown";
  if (score >= 85) return "good";
  if (score >= 60) return "attention";
  return "poor";
}

function reportLevel(score: number | null): HealthLevel {
  if (score == null) return "unknown";
  if (score >= 85) return "healthy";
  if (score >= 70) return "good";
  if (score >= 50) return "attention";
  return "poor";
}

function retransmissionMetric(samples: HealthSample[], summaries: SpeedSummary[]): WeightedMetric {
  const summaryRetransmits = summaries
    .map((summary) => summary.retransmits)
    .filter((value): value is number => value != null);
  const retransmits = summaryRetransmits.length
    ? summaryRetransmits.reduce((total, value) => total + value, 0)
    : samples.reduce((total, sample) => total + sample.retransmits, 0);
  const summaryBytes = summaries.reduce((total, summary) => total + Math.max(0, summary.bytes), 0);
  const bytes = summaryBytes > 0 ? summaryBytes : samples.reduce((total, sample) => total + Math.max(0, sample.bytes), 0);
  if (bytes <= 0) {
    return { key: "retransmission", level: "unknown", score: null, primaryValue: null, secondaryValue: null, weight: 0.4 };
  }

  const perGib = retransmits / (bytes / 2 ** 30);
  const affectedPercent = samples.length
    ? samples.filter((sample) => sample.retransmits > 0).length / samples.length * 100
    : 0;
  const densityScore = perGib === 0 ? 100 : perGib <= 1 ? 95 : perGib <= 5 ? 85 : perGib <= 20 ? 65 : perGib <= 50 ? 40 : 15;
  const spreadScore = affectedPercent <= 5 ? 100 : affectedPercent <= 15 ? 85 : affectedPercent <= 30 ? 60 : affectedPercent <= 50 ? 35 : 15;
  const score = clampScore(Math.min(densityScore, spreadScore));
  return { key: "retransmission", level: metricLevel(score), score, primaryValue: perGib, secondaryValue: affectedPercent, weight: 0.4 };
}

function packetLossMetric(samples: HealthSample[], summaries: SpeedSummary[]): WeightedMetric {
  const packetSummaries = summaries.filter((summary) => summary.packets != null && summary.lostPackets != null);
  const packetSamples = samples.filter((sample) => sample.packets != null && sample.lostPackets != null);
  const source = packetSummaries.length ? packetSummaries : packetSamples;
  const packets = source.reduce((total, entry) => total + (entry.packets ?? 0), 0);
  const lostPackets = source.reduce((total, entry) => total + (entry.lostPackets ?? 0), 0);
  const reportedPercent = summaries
    .map((summary) => summary.lossPercent)
    .find((value): value is number => value != null && Number.isFinite(value));
  const lossPercent = packets > 0 ? lostPackets / packets * 100 : reportedPercent ?? null;
  if (lossPercent == null) {
    return { key: "packetLoss", level: "unknown", score: null, primaryValue: null, secondaryValue: null, weight: 0.5 };
  }
  const score = lossPercent <= 0.05 ? 100 : lossPercent <= 0.2 ? 90 : lossPercent <= 1 ? 70 : lossPercent <= 3 ? 40 : 10;
  return { key: "packetLoss", level: metricLevel(score), score, primaryValue: lossPercent, secondaryValue: lostPackets, weight: 0.5 };
}

function loadedLatencyMetric(samples: HealthSample[], weight: number): WeightedMetric {
  const baseline = percentile(samples.map((sample) => sample.baselineLatencyMs).filter((value): value is number => value != null), 0.5);
  const loaded = percentile(samples.map((sample) => sample.latencyMs).filter((value): value is number => value != null), 0.5);
  if (baseline == null || loaded == null) {
    return { key: "loadedLatency", level: "unknown", score: null, primaryValue: null, secondaryValue: baseline, weight };
  }
  const increase = Math.max(0, loaded - baseline);
  const score = increase <= 5 ? 100 : increase <= 15 ? 85 : increase <= 30 ? 65 : increase <= 60 ? 40 : 15;
  return { key: "loadedLatency", level: metricLevel(score), score, primaryValue: increase, secondaryValue: baseline, weight };
}

function latencyStabilityMetric(samples: HealthSample[]): WeightedMetric {
  const latencies = samples.map((sample) => sample.latencyMs).filter((value): value is number => value != null);
  const median = percentile(latencies, 0.5);
  const high = percentile(latencies, 0.95);
  if (median == null || high == null) {
    return { key: "latencyStability", level: "unknown", score: null, primaryValue: null, secondaryValue: null, weight: 0.2 };
  }
  const spread = Math.max(0, high - median);
  const score = spread <= 2 ? 100 : spread <= 5 ? 85 : spread <= 15 ? 65 : spread <= 40 ? 40 : 15;
  return { key: "latencyStability", level: metricLevel(score), score, primaryValue: spread, secondaryValue: median, weight: 0.2 };
}

function udpJitterMetric(samples: HealthSample[], summaries: SpeedSummary[]): WeightedMetric {
  const summaryJitter = summaries.map((summary) => summary.jitterMs).find((value): value is number => value != null);
  const jitter = summaryJitter ?? percentile(samples.map((sample) => sample.jitterMs).filter((value): value is number => value != null), 0.5);
  if (jitter == null) {
    return { key: "udpJitter", level: "unknown", score: null, primaryValue: null, secondaryValue: null, weight: 0.25 };
  }
  const score = jitter <= 1 ? 100 : jitter <= 3 ? 85 : jitter <= 10 ? 60 : jitter <= 30 ? 35 : 10;
  return { key: "udpJitter", level: metricLevel(score), score, primaryValue: jitter, secondaryValue: null, weight: 0.25 };
}

function transferStabilityMetric(samples: HealthSample[], weight: number): WeightedMetric {
  const rates = samples.map((sample) => sample.bps).filter((value) => Number.isFinite(value) && value >= 0);
  const median = percentile(rates, 0.5);
  const low = percentile(rates, 0.1);
  if (median == null || low == null || median <= 0) {
    return { key: "transferStability", level: "unknown", score: null, primaryValue: null, secondaryValue: null, weight };
  }
  const ratio = low / median * 100;
  const score = ratio >= 90 ? 100 : ratio >= 75 ? 80 : ratio >= 55 ? 55 : ratio >= 35 ? 30 : 10;
  return { key: "transferStability", level: metricLevel(score), score, primaryValue: ratio, secondaryValue: null, weight };
}

export function analyzeLinkHealth(
  protocol: TransportProtocol,
  rawSamples: HealthSample[],
  summaries: SpeedSummary[] = []
): HealthReport {
  const samples = rawSamples.filter((sample) => !sample.omitted && Number.isFinite(sample.bps));
  const metrics: WeightedMetric[] = protocol === "tcp"
    ? [retransmissionMetric(samples, summaries), loadedLatencyMetric(samples, 0.3), latencyStabilityMetric(samples), transferStabilityMetric(samples, 0.1)]
    : [packetLossMetric(samples, summaries), udpJitterMetric(samples, summaries), loadedLatencyMetric(samples, 0.15), transferStabilityMetric(samples, 0.1)];
  const available = metrics.filter((metric) => metric.score != null);
  const weight = available.reduce((total, metric) => total + metric.weight, 0);
  const enoughSamples = samples.length >= 6;
  const score = enoughSamples && weight > 0
    ? clampScore(available.reduce((total, metric) => total + (metric.score ?? 0) * metric.weight, 0) / weight)
    : null;
  const confidence: HealthConfidence = !enoughSamples || available.length < 2
    ? "insufficient"
    : available.length === metrics.length
      ? "full"
      : "partial";

  return {
    protocol,
    score,
    level: reportLevel(score),
    confidence,
    sampleCount: samples.length,
    metrics: metrics.map(({ weight: _weight, ...metric }) => metric)
  };
}
