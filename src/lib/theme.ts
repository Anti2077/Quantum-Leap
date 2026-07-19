export type ThemeMode = "auto" | "light" | "dark";
export type ResolvedTheme = Exclude<ThemeMode, "auto">;

const THEME_MODE_KEY = "quantum-leap.theme-mode";
const systemTheme = window.matchMedia("(prefers-color-scheme: dark)");

export function getThemeMode(): ThemeMode {
  try {
    const saved = localStorage.getItem(THEME_MODE_KEY);
    return saved === "light" || saved === "dark" ? saved : "auto";
  } catch {
    return "auto";
  }
}

export function resolveTheme(mode: ThemeMode): ResolvedTheme {
  return mode === "auto" ? (systemTheme.matches ? "dark" : "light") : mode;
}

export function applyTheme(mode: ThemeMode) {
  const resolved = resolveTheme(mode);
  document.documentElement.dataset.themeMode = mode;
  document.documentElement.dataset.colorTheme = resolved;
  document.documentElement.style.colorScheme = resolved;
}

export function setThemeMode(mode: ThemeMode) {
  try {
    localStorage.setItem(THEME_MODE_KEY, mode);
  } catch {
    // Theme selection still applies for the current session.
  }
  applyTheme(mode);
}

export function initializeTheme() {
  applyTheme(getThemeMode());
  systemTheme.addEventListener("change", () => {
    if (getThemeMode() === "auto") applyTheme("auto");
  });
}
