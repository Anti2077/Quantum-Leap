import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || !value) throw new Error(`Invalid argument near ${key ?? "end of command"}`);
    options[key.slice(2)] = value;
  }
  return options;
}

function cargoVersion(cargoToml) {
  const packageBlock = cargoToml.match(/\[package\]([\s\S]*?)(?:\n\[|$)/)?.[1];
  return packageBlock?.match(/^version\s*=\s*"([^"]+)"/m)?.[1];
}

async function requiredText(filePath, description) {
  const value = (await readFile(filePath, "utf8")).trim();
  if (!value) throw new Error(`${description} is empty: ${filePath}`);
  return value;
}

export function updaterAssets(version) {
  const macOSUniversal = `Quantum-Leap_${version}_macOS_universal.app.tar.gz`;
  return {
    "darwin-aarch64": macOSUniversal,
    "darwin-x86_64": macOSUniversal,
    "linux-x86_64": `Quantum-Leap_${version}_Linux_x86_64.AppImage`,
    "linux-aarch64": `Quantum-Leap_${version}_Linux_aarch64.AppImage`
  };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const version = options.version;
  const assetsDirectory = path.resolve(options.assets ?? "release");
  const notesPath = options.notes ? path.resolve(options.notes) : null;
  const baseUrl = options["base-url"] ?? (version
    ? `https://github.com/Anti2077/Quantum-Leap/releases/download/v${version}`
    : null);
  const outputPath = path.resolve(options.output ?? path.join(assetsDirectory, "latest.json"));
  const pubDate = options["pub-date"] ?? new Date().toISOString();

  if (!version || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error("--version must be a valid semantic version without a leading v");
  }
  if (!baseUrl || !baseUrl.startsWith("https://")) throw new Error("--base-url must use HTTPS");
  if (Number.isNaN(Date.parse(pubDate))) throw new Error("--pub-date must be an RFC 3339 timestamp");

  const [packageJson, tauriConfig, cargoToml] = await Promise.all([
    readFile(path.resolve("package.json"), "utf8").then(JSON.parse),
    readFile(path.resolve("src-tauri/tauri.conf.json"), "utf8").then(JSON.parse),
    readFile(path.resolve("src-tauri/Cargo.toml"), "utf8")
  ]);
  const versions = [packageJson.version, tauriConfig.version, cargoVersion(cargoToml)];
  if (versions.some((candidate) => candidate !== version)) {
    throw new Error(`Version mismatch: requested ${version}, package/config/Cargo contain ${versions.join(", ")}`);
  }

  const assets = updaterAssets(version);
  const platforms = {};

  for (const [platform, filename] of Object.entries(assets)) {
    await readFile(path.join(assetsDirectory, filename));
    const signature = await requiredText(path.join(assetsDirectory, `${filename}.sig`), `${platform} signature`);
    platforms[platform] = {
      signature,
      url: `${baseUrl.replace(/\/$/, "")}/${encodeURIComponent(filename)}`
    };
  }

  const notes = notesPath ? await requiredText(notesPath, "Release notes") : "";
  const manifest = {
    version,
    notes,
    pub_date: new Date(pubDate).toISOString(),
    platforms
  };

  await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.log(`Wrote updater manifest: ${outputPath}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
