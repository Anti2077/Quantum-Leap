import { beforeEach, describe, expect, it, vi } from "vitest";
import { clampChartTooltipPercent } from "./chart";
import { shouldScheduleParticleFrame } from "./motion";
import { applyTheme, setThemeMode, subscribeTheme } from "./theme";

describe("chart tooltip positioning", () => {
  it("keeps edge tooltips inside the chart", () => {
    expect(clampChartTooltipPercent(-20)).toBe(14);
    expect(clampChartTooltipPercent(50)).toBe(50);
    expect(clampChartTooltipPercent(120)).toBe(86);
  });
});

describe("particle scheduling", () => {
  it("does not keep an idle or reduced-motion canvas running", () => {
    expect(shouldScheduleParticleFrame({ active: false, activeMix: 0, reducedMotion: false, pageVisible: true })).toBe(false);
    expect(shouldScheduleParticleFrame({ active: true, activeMix: 1, reducedMotion: true, pageVisible: true })).toBe(false);
    expect(shouldScheduleParticleFrame({ active: true, activeMix: 1, reducedMotion: false, pageVisible: false })).toBe(false);
  });

  it("runs only while active or finishing its transition", () => {
    expect(shouldScheduleParticleFrame({ active: true, activeMix: 1, reducedMotion: false, pageVisible: true })).toBe(true);
    expect(shouldScheduleParticleFrame({ active: false, activeMix: 0.2, reducedMotion: false, pageVisible: true })).toBe(true);
  });
});

describe("theme switching", () => {
  beforeEach(() => localStorage.clear());

  it("updates the document and notifies canvas subscribers", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeTheme(listener);

    applyTheme("dark");
    expect(document.documentElement.dataset.colorTheme).toBe("dark");

    setThemeMode("light");
    expect(document.documentElement.dataset.colorTheme).toBe("light");
    expect(localStorage.getItem("quantum-leap.theme-mode")).toBe("light");
    expect(listener).toHaveBeenLastCalledWith("light", "light");

    unsubscribe();
  });
});
