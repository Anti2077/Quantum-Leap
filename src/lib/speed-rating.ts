export type SpeedRating = {
  key: "legend" | "overdrive" | "prime" | "elite" | "solid" | "npc" | "meh" | "slow";
  labelKey:
    | "ratingLegend"
    | "ratingOverdrive"
    | "ratingPrime"
    | "ratingElite"
    | "ratingSolid"
    | "ratingNpc"
    | "ratingMeh"
    | "ratingSlow";
};

export function downloadRating(bitsPerSecond: number): SpeedRating {
  const mbps = bitsPerSecond / 1e6;
  if (mbps >= 8000) return { key: "legend", labelKey: "ratingLegend" };
  if (mbps >= 4000) return { key: "overdrive", labelKey: "ratingOverdrive" };
  if (mbps >= 2000) return { key: "prime", labelKey: "ratingPrime" };
  if (mbps >= 800) return { key: "elite", labelKey: "ratingElite" };
  if (mbps >= 500) return { key: "solid", labelKey: "ratingSolid" };
  if (mbps >= 200) return { key: "npc", labelKey: "ratingNpc" };
  if (mbps >= 50) return { key: "meh", labelKey: "ratingMeh" };
  return { key: "slow", labelKey: "ratingSlow" };
}
