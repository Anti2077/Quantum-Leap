import { afterEach, describe, expect, it } from "vitest";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { prepareAppRun } from "./prepare-appimage.mjs";
import { verifyAppImage } from "./verify-appimage.mjs";

const directories = [];
async function temporaryDirectory() {
  const directory = await mkdtemp(path.join(tmpdir(), "appimage-test-"));
  directories.push(directory);
  return directory;
}
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe.skipIf(process.platform === "win32")("AppImage launch permissions", () => {
  it.each(["x86_64", "aarch64"])("prepares a fresh %s launcher with public execution permission", async (arch) => {
    const launcher = await prepareAppRun(arch, await temporaryDirectory(), async (url) => {
      expect(url).toContain(`/apprun-old/AppRun-${arch}`);
      return Buffer.from("launcher contents");
    });
    expect((await stat(launcher)).mode & 0o777).toBe(0o755);
  });

  it("repairs an existing 0770 cache without changing or downloading the launcher", async () => {
    const cache = await temporaryDirectory();
    await mkdir(path.join(cache, "tauri"));
    const launcher = path.join(cache, "tauri/AppRun-x86_64");
    await writeFile(launcher, "existing launcher", { mode: 0o770 });
    await prepareAppRun("x86_64", cache, () => { throw new Error("Unexpected download"); });
    expect(await readFile(launcher, "utf8")).toBe("existing launcher");
    expect((await stat(launcher)).mode & 0o777).toBe(0o755);
  });

  it("does not cache a failed download", async () => {
    const cache = await temporaryDirectory();
    await expect(prepareAppRun("x86_64", cache, async () => { throw new Error("Download failed"); })).rejects.toThrow("Download failed");
    await expect(stat(path.join(cache, "tauri/AppRun-x86_64"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects the published package's 0770 permission even when its owner can execute it", async () => {
    const directory = await temporaryDirectory();
    await chmod(directory, 0o700);
    await mkdir(path.join(directory, "usr/bin"), { recursive: true, mode: 0o755 });
    for (const file of ["AppRun", "AppRun.wrapped", "usr/bin/iperf3_ui", "usr/bin/iperf3"]) {
      await writeFile(path.join(directory, file), "launcher", { mode: 0o755 });
    }
    await chmod(path.join(directory, "AppRun.wrapped"), 0o770);
    await expect(verifyAppImage(directory)).rejects.toThrow("AppRun.wrapped");
    await chmod(path.join(directory, "AppRun.wrapped"), 0o755);
    await expect(verifyAppImage(directory)).resolves.toBeUndefined();
  });
});
