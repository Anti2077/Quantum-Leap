import { describe, expect, it } from "vitest";
import { downloadRating } from "./speed-rating";

describe("download speed ratings", () => {
  it.each([
    [49.99, "ratingSlow"],
    [50, "ratingMeh"],
    [200, "ratingNpc"],
    [500, "ratingSolid"],
    [800, "ratingElite"],
    [2000, "ratingPrime"],
    [4000, "ratingOverdrive"],
    [8000, "ratingLegend"]
  ] as const)("maps %s Mbps to %s", (mbps, labelKey) => {
    expect(downloadRating(mbps * 1e6).labelKey).toBe(labelKey);
  });
});
