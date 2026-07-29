import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const OWNER = "Anti2077";
const REPOSITORY = "Quantum-Leap";
const API_URL = `https://api.github.com/repos/${OWNER}/${REPOSITORY}/releases`;
const OUTPUT_DIRECTORY = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../docs/images/readme"
);
const MAX_RELEASES = 12;

const COPY = {
  en: {
    title: "Release downloads",
    subtitle: "Install and update packages downloaded from GitHub Releases",
    total: "TOTAL PACKAGE DOWNLOADS",
    empty: "No package downloads yet"
  },
  zh: {
    title: "Release 下载量",
    subtitle: "GitHub Releases 中安装包与应用内更新包的下载次数",
    total: "安装包累计下载",
    empty: "暂无安装包下载"
  }
};

const THEMES = {
  light: {
    background: "#ffffff",
    border: "#d8dee8",
    title: "#182230",
    muted: "#667085",
    grid: "#e8ecf2",
    macos: "#f06f5e",
    windows: "#2589d8",
    linux: "#d6a514"
  },
  dark: {
    background: "#0d1117",
    border: "#30363d",
    title: "#f0f6fc",
    muted: "#8b949e",
    grid: "#30363d",
    macos: "#ff8978",
    windows: "#58aef0",
    linux: "#e3b341"
  }
};

export function classifyPackage(name) {
  const lower = name.toLowerCase();
  if (lower.endsWith(".dmg") || lower.endsWith(".app.tar.gz")) return "macos";
  if (lower.endsWith(".exe") || lower.endsWith(".msi") || lower.endsWith(".nsis.zip")) return "windows";
  if (lower.endsWith(".appimage") || lower.endsWith(".deb") || lower.endsWith(".rpm")) return "linux";
  return null;
}

export function summarizeReleases(releases) {
  return releases
    .filter((release) => !release.draft && !release.prerelease)
    .map((release) => {
      const counts = { macos: 0, windows: 0, linux: 0 };
      for (const asset of release.assets ?? []) {
        const platform = classifyPackage(asset.name ?? "");
        if (platform) counts[platform] += Number(asset.download_count) || 0;
      }
      return {
        tag: String(release.tag_name ?? "untagged").replace(/^v/i, ""),
        publishedAt: release.published_at ?? release.created_at ?? "",
        ...counts,
        total: counts.macos + counts.windows + counts.linux
      };
    })
    .sort((a, b) => a.publishedAt.localeCompare(b.publishedAt));
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function niceMaximum(value) {
  if (value <= 4) return 4;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalized = value / magnitude;
  const ceiling = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return ceiling * magnitude;
}

function formatCount(value) {
  return new Intl.NumberFormat("en-US").format(value);
}

export function renderChart(allReleases, { language = "en", theme = "light" } = {}) {
  const copy = COPY[language];
  const colors = THEMES[theme];
  if (!copy || !colors) throw new Error(`Unsupported chart variant: ${language}/${theme}`);

  const releases = allReleases.slice(-MAX_RELEASES);
  const total = allReleases.reduce((sum, release) => sum + release.total, 0);
  const width = 920;
  const height = 440;
  const plot = { left: 72, top: 176, right: 878, bottom: 370 };
  const plotWidth = plot.right - plot.left;
  const plotHeight = plot.bottom - plot.top;
  const maximum = niceMaximum(Math.max(...releases.map((release) => release.total), 0));
  const slotWidth = plotWidth / Math.max(releases.length, 1);
  const barWidth = Math.min(54, slotWidth * 0.58);
  const segments = [];

  for (let index = 0; index < releases.length; index += 1) {
    const release = releases[index];
    const x = plot.left + slotWidth * index + (slotWidth - barWidth) / 2;
    let y = plot.bottom;
    for (const platform of ["macos", "windows", "linux"]) {
      const segmentHeight = (release[platform] / maximum) * plotHeight;
      y -= segmentHeight;
      if (segmentHeight > 0) {
        segments.push(
          `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${segmentHeight.toFixed(1)}" fill="${colors[platform]}"/>`
        );
      }
    }
    if (release.total > 0) {
      segments.push(
        `<text class="value" x="${(x + barWidth / 2).toFixed(1)}" y="${Math.max(plot.top + 12, y - 8).toFixed(1)}" text-anchor="middle">${formatCount(release.total)}</text>`
      );
    }
    segments.push(
      `<text class="axis" x="${(x + barWidth / 2).toFixed(1)}" y="395" text-anchor="middle">v${escapeXml(release.tag)}</text>`
    );
  }

  const grid = [];
  for (let index = 0; index <= 4; index += 1) {
    const y = plot.bottom - (plotHeight * index) / 4;
    const value = Math.round((maximum * index) / 4);
    grid.push(`<line x1="${plot.left}" y1="${y}" x2="${plot.right}" y2="${y}" stroke="${colors.grid}"/>`);
    grid.push(`<text class="axis" x="60" y="${y + 4}" text-anchor="end">${formatCount(value)}</text>`);
  }

  const description = releases.length === 0
    ? copy.empty
    : releases.map((release) => `v${release.tag}: ${release.total}`).join(", ");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="920" height="440" viewBox="0 0 920 440" role="img" aria-labelledby="title description">
  <title id="title">${escapeXml(copy.title)}</title>
  <desc id="description">${escapeXml(description)}</desc>
  <style>
    text { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; letter-spacing: 0; }
    .heading { fill: ${colors.title}; font-size: 24px; font-weight: 700; }
    .subtitle { fill: ${colors.muted}; font-size: 13px; }
    .total-label { fill: ${colors.muted}; font-size: 10px; font-weight: 600; }
    .total-value { fill: ${colors.title}; font-size: 30px; font-weight: 700; }
    .axis { fill: ${colors.muted}; font-size: 11px; }
    .value { fill: ${colors.title}; font-size: 11px; font-weight: 600; }
    .legend { fill: ${colors.muted}; font-size: 12px; }
  </style>
  <rect x="0.5" y="0.5" width="919" height="439" rx="8" fill="${colors.background}" stroke="${colors.border}"/>
  <text class="heading" x="32" y="45">${escapeXml(copy.title)}</text>
  <text class="subtitle" x="32" y="69">${escapeXml(copy.subtitle)}</text>
  <text class="total-label" x="888" y="29" text-anchor="end">${escapeXml(copy.total)}</text>
  <text class="total-value" x="888" y="61" text-anchor="end">${formatCount(total)}</text>
  <g transform="translate(32 108)">
    <rect width="10" height="10" rx="2" fill="${colors.macos}"/><text class="legend" x="17" y="10">macOS</text>
    <rect x="90" width="10" height="10" rx="2" fill="${colors.windows}"/><text class="legend" x="107" y="10">Windows</text>
    <rect x="198" width="10" height="10" rx="2" fill="${colors.linux}"/><text class="legend" x="215" y="10">Linux</text>
  </g>
  ${grid.join("\n  ")}
  ${segments.join("\n  ")}
</svg>
`;
}

async function fetchReleases() {
  const releases = [];
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": `${REPOSITORY}-download-chart`,
    "X-GitHub-Api-Version": "2022-11-28"
  };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

  for (let page = 1; page <= 10; page += 1) {
    const response = await fetch(`${API_URL}?per_page=100&page=${page}`, { headers });
    if (!response.ok) {
      throw new Error(`GitHub Releases request failed: ${response.status} ${response.statusText}`);
    }
    const batch = await response.json();
    if (!Array.isArray(batch)) throw new Error("GitHub Releases returned an unexpected response");
    releases.push(...batch);
    if (batch.length < 100) break;
  }
  return releases;
}

export async function generateCharts() {
  const releases = summarizeReleases(await fetchReleases());
  await mkdir(OUTPUT_DIRECTORY, { recursive: true });
  for (const language of Object.keys(COPY)) {
    for (const theme of Object.keys(THEMES)) {
      const output = path.join(OUTPUT_DIRECTORY, `downloads-${language}-${theme}.svg`);
      await writeFile(output, renderChart(releases, { language, theme }), "utf8");
    }
  }
  console.log(`Generated download charts for ${releases.length} releases (${releases.reduce((sum, release) => sum + release.total, 0)} package downloads).`);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  await generateCharts();
}
