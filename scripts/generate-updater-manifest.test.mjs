import { describe, expect, it } from "vitest";
import { updaterAssets } from "./generate-updater-manifest.mjs";

describe("updater manifest generation", () => {
  it("uses the catalog-compatible Linux artifact names", () => {
    const assets = updaterAssets("1.5.0");
    expect(assets["linux-x86_64"]).toBe("Quantum-Leap_1.5.0_x86_64.AppImage");
    expect(assets["linux-aarch64"]).toBe("Quantum-Leap_1.5.0_aarch64.AppImage");
  });
  it("serves the universal macOS update to Apple Silicon and Intel Macs", () => {
    const assets = updaterAssets("1.5.0");
    const universalArtifact = "Quantum-Leap_1.5.0_macOS_universal.app.tar.gz";

    expect(assets["darwin-aarch64"]).toBe(universalArtifact);
    expect(assets["darwin-x86_64"]).toBe(universalArtifact);
  });
});
