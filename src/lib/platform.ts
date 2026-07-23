export type RuntimePlatform = "macos" | "windows" | "linux";

export function detectRuntimePlatform(userAgent: string): RuntimePlatform {
  if (/windows/i.test(userAgent)) return "windows";
  if (/linux|x11/i.test(userAgent)) return "linux";
  return "macos";
}
