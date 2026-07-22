export type ThemeMode = "auto" | "light" | "dark";
export type ResolvedTheme = Exclude<ThemeMode, "auto">;

const THEME_MODE_KEY = "quantum-leap.theme-mode";
const systemTheme = window.matchMedia("(prefers-color-scheme: dark)");
const listeners = new Set<(mode: ThemeMode, resolved: ResolvedTheme) => void>();

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
  listeners.forEach((listener) => listener(mode, resolved));
}

export function subscribeTheme(listener: (mode: ThemeMode, resolved: ResolvedTheme) => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
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
