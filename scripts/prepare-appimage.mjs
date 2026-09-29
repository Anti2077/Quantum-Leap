import { execFile } from "node:child_process";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

function downloadLauncher(url) {
  return new Promise((resolve, reject) => {
    execFile("curl", ["--fail", "--location", "--silent", "--show-error", "--retry", "3", "--connect-timeout", "20", "--max-time", "90", url],
      { encoding: null, maxBuffer: 1024 * 1024 }, (error, stdout) => error ? reject(error) : resolve(stdout));
  });
}

export async function prepareAppRun(arch, cacheHome, download = downloadLauncher) {
  if (!["x86_64", "aarch64"].includes(arch)) throw new Error(`Unsupported AppImage architecture: ${arch}`);
  if (!path.isAbsolute(cacheHome)) throw new Error("AppImage cache directory must be absolute");
  const directory = path.join(cacheHome, "tauri");
  const launcher = path.join(directory, `AppRun-${arch}`);
  await mkdir(directory, { recursive: true });
  let cached;
  try {
    cached = await readFile(launcher);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (!cached?.length) {
    // Use the same launcher and cache location as Tauri's Linux bundler.
    const bytes = await download(`https://github.com/tauri-apps/binary-releases/releases/download/apprun-old/AppRun-${arch}`);
    if (!bytes.length) throw new Error("Downloaded AppRun is empty");
    const temporary = `${launcher}.${process.pid}.tmp`;
    try {
      await writeFile(temporary, bytes, { mode: 0o755 });
      await rename(temporary, launcher);
    } finally {
      await rm(temporary, { force: true });
    }
  }
  // Tauri otherwise creates this file as 0770. SquashFS assigns root ownership,
  // so AppRun.wrapped must also be readable/executable by ordinary users.
  await chmod(launcher, 0o755);
  return launcher;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arch = process.env.TAURI_ENV_ARCH ?? { x64: "x86_64", arm64: "aarch64" }[process.arch];
  const cacheHome = process.env.XDG_CACHE_HOME || path.join(homedir(), ".cache");
  await prepareAppRun(arch, cacheHome);
}
