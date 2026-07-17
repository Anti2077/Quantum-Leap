export type BandwidthUnit = "Mbps" | "Gbps";

export const formatBandwidthParts = (bps: number, fixedUnit?: BandwidthUnit) => {
  const safeBps = Number.isFinite(bps) && bps > 0 ? bps : 0;
  if (fixedUnit === "Gbps") {
    return { value: (safeBps / 1e9).toFixed(3), unit: fixedUnit };
  }
  if (fixedUnit === "Mbps") {
    return { value: (safeBps / 1e6).toFixed(2), unit: fixedUnit };
  }
  if (!Number.isFinite(bps) || bps <= 0) return { value: "0.00", unit: "Mbps" };
  if (bps >= 1e9) return { value: (bps / 1e9).toFixed(2), unit: "Gbps" };
  if (bps >= 1e6) return { value: (bps / 1e6).toFixed(2), unit: "Mbps" };
  if (bps >= 1e3) return { value: (bps / 1e3).toFixed(1), unit: "Kbps" };
  return { value: bps.toFixed(0), unit: "bps" };
};

export const formatBandwidth = (bps: number, fixedUnit?: BandwidthUnit) => {
  const { value, unit } = formatBandwidthParts(bps, fixedUnit);
  return `${value} ${unit}`;
};

export const formatLatency = (ms?: number | null) => {
  if (ms == null || !Number.isFinite(ms)) return "--";
  return `${ms.toFixed(1)} ms`;
};

export const formatBytes = (bytes: number) => {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 MB";
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(2)} GB`;
  return `${(bytes / 1e6).toFixed(1)} MB`;
};
