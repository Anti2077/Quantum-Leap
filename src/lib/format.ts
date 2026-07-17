export const formatBandwidthParts = (bps: number) => {
  if (!Number.isFinite(bps) || bps <= 0) return { value: "0.00", unit: "Mbps" };
  if (bps >= 1e9) return { value: (bps / 1e9).toFixed(2), unit: "Gbps" };
  if (bps >= 1e6) return { value: (bps / 1e6).toFixed(2), unit: "Mbps" };
  if (bps >= 1e3) return { value: (bps / 1e3).toFixed(1), unit: "Kbps" };
  return { value: bps.toFixed(0), unit: "bps" };
};

export const formatBandwidth = (bps: number) => {
  const { value, unit } = formatBandwidthParts(bps);
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
