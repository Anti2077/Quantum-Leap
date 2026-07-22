export type VersionRelation = "behind" | "equal" | "ahead";

interface ParsedVersion {
  parts: [number, number, number];
  prerelease: string | null;
}

function parseVersion(value: string): ParsedVersion | null {
  const match = value.trim().replace(/^v/i, "").match(
    /^(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/
  );

  if (!match) return null;

  return {
    parts: [Number(match[1]), Number(match[2] ?? 0), Number(match[3] ?? 0)],
    prerelease: match[4] ?? null
  };
}

/**
 * Compares two semantic versions. `v1.2.0` and `1.2.0` are equivalent, while
 * a prerelease is ordered before its corresponding stable release.
 */
export function compareVersions(local: string, release: string): VersionRelation | null {
  const current = parseVersion(local);
  const latest = parseVersion(release);
  if (!current || !latest) return null;

  for (let index = 0; index < current.parts.length; index += 1) {
    if (current.parts[index] < latest.parts[index]) return "behind";
    if (current.parts[index] > latest.parts[index]) return "ahead";
  }

  if (current.prerelease === latest.prerelease) return "equal";
  if (current.prerelease === null) return "ahead";
  if (latest.prerelease === null) return "behind";
  return current.prerelease.localeCompare(latest.prerelease) < 0 ? "behind" : "ahead";
}
