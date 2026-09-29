import { stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export async function verifyAppImage(directory) {
  for (const relative of [".", "usr", "usr/bin", "AppRun", "AppRun.wrapped", "usr/bin/iperf3_ui", "usr/bin/iperf3"]) {
    const info = await stat(path.join(directory, relative));
    // Checking access() or test -x as the build owner would miss mode 0770.
    if ((info.mode & 0o005) !== 0o005) {
      throw new Error(`${relative} is not readable/executable by ordinary users (mode ${(info.mode & 0o777).toString(8)})`);
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) throw new Error("Usage: node scripts/verify-appimage.mjs EXTRACTED_APPDIR");
  await verifyAppImage(process.argv[2]);
}
