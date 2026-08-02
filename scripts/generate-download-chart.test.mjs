import { describe, expect, it } from "vitest";
import { classifyPackage, renderChart, summarizeReleases } from "./generate-download-chart.mjs";

describe("download chart generation", () => {
  it("counts install and updater packages while excluding metadata", () => {
    expect(classifyPackage("Quantum-Leap_1.4.1_macOS_arm64.dmg")).toBe("macos");
    expect(classifyPackage("Quantum-Leap_1.4.1_macOS_arm64.app.tar.gz")).toBe("macos");
    expect(classifyPackage("Quantum-Leap_1.4.1_x64-setup.exe")).toBe("windows");
    expect(classifyPackage("Quantum-Leap_1.5.0_Windows_x64_portable.zip")).toBe("windows");
    expect(classifyPackage("Quantum-Leap_1.4.1_amd64.AppImage")).toBe("linux");
    expect(classifyPackage("Quantum-Leap_1.4.1_amd64.deb")).toBe("linux");
    expect(classifyPackage("latest.json")).toBeNull();
    expect(classifyPackage("Quantum-Leap.AppImage.sig")).toBeNull();
    expect(classifyPackage("SHA256SUMS.txt")).toBeNull();
  });

  it("groups stable release downloads by platform and date", () => {
    const releases = summarizeReleases([
      {
        tag_name: "v1.1.0",
        published_at: "2026-02-01T00:00:00Z",
        assets: [{ name: "app.dmg", download_count: 7 }]
      },
      {
        tag_name: "v1.0.0",
        published_at: "2026-01-01T00:00:00Z",
        assets: [
          { name: "app.exe", download_count: 3 },
          { name: "app.deb", download_count: 2 },
          { name: "app.exe.sig", download_count: 99 }
        ]
      },
      { tag_name: "v2.0.0-beta", prerelease: true, assets: [{ name: "app.dmg", download_count: 100 }] }
    ]);

    expect(releases).toEqual([
      { tag: "1.0.0", publishedAt: "2026-01-01T00:00:00Z", macos: 0, windows: 3, linux: 2, total: 5 },
      { tag: "1.1.0", publishedAt: "2026-02-01T00:00:00Z", macos: 7, windows: 0, linux: 0, total: 7 }
    ]);
  });

  it("renders an accessible localized SVG", () => {
    const svg = renderChart(
      [{ tag: "1.0.0", publishedAt: "2026-01-01", macos: 2, windows: 3, linux: 1, total: 6 }],
      { language: "zh", theme: "dark" }
    );

    expect(svg).toContain("<title id=\"title\">Release 下载量</title>");
    expect(svg).toContain("发布包累计下载");
    expect(svg).toContain("#0d1117");
    expect(svg).toContain(">6</text>");
  });
});
