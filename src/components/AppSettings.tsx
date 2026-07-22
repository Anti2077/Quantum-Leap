import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import * as Dialog from "@radix-ui/react-dialog";
import * as Popover from "@radix-ui/react-popover";
import Activity from "lucide-react/dist/esm/icons/activity.js";
import ChevronDown from "lucide-react/dist/esm/icons/chevron-down.js";
import ExternalLink from "lucide-react/dist/esm/icons/external-link.js";
import Info from "lucide-react/dist/esm/icons/info.js";
import Moon from "lucide-react/dist/esm/icons/moon.js";
import Sun from "lucide-react/dist/esm/icons/sun.js";
import X from "lucide-react/dist/esm/icons/x.js";
import { useEffect, useRef, useState } from "react";
import packageMetadata from "../../package.json";
import appIcon from "../../src-tauri/icons/128x128.png";
import { useI18n, type UiLanguage } from "../lib/i18n";
import {
  getThemeMode,
  resolveTheme,
  setThemeMode,
  subscribeTheme,
  type ResolvedTheme,
  type ThemeMode
} from "../lib/theme";

const PROJECT_URL = "https://github.com/Anti2077/Quantum-Leap";

export function AppSettings({
  open,
  busy,
  onOpenChange
}: {
  open: boolean;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { language, setLanguage, t } = useI18n();
  const [aboutOpen, setAboutOpen] = useState(false);
  const [version, setVersion] = useState(packageMetadata.version);
  const [theme, updateTheme] = useState<{ mode: ThemeMode; resolved: ResolvedTheme }>(() => {
    const mode = getThemeMode();
    return { mode, resolved: resolveTheme(mode) };
  });
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => subscribeTheme((mode, resolved) => updateTheme({ mode, resolved })), []);

  useEffect(() => {
    if (!aboutOpen) return;
    if ("__TAURI_INTERNALS__" in window) {
      void getVersion().then(setVersion).catch(() => setVersion(packageMetadata.version));
    } else {
      setVersion(packageMetadata.version);
    }
  }, [aboutOpen]);

  const toggleSystemTheme = () => {
    if (theme.mode === "auto") setThemeMode(theme.resolved);
    else setThemeMode("auto");
  };

  const toggleManualTheme = () => {
    if (theme.mode === "auto") return;
    setThemeMode(theme.resolved === "light" ? "dark" : "light");
  };

  const showAbout = () => {
    onOpenChange(false);
    setAboutOpen(true);
  };

  const openProjectHomepage = () => {
    if ("__TAURI_INTERNALS__" in window) void openUrl(PROJECT_URL);
    else window.open(PROJECT_URL, "_blank", "noopener,noreferrer");
  };

  return (
    <>
      <Popover.Root open={open} onOpenChange={onOpenChange}>
        <div className="app-settings-control">
          <Popover.Trigger asChild>
            <button
              ref={triggerRef}
              type="button"
              className={`brand-mark settings-trigger ${open ? "is-open" : ""}`}
              aria-label={t("settings")}
            >
              <Activity size={15} aria-hidden="true" />
              <span>Quantum Leap</span>
              {language === "zh-CN" && <small>跃迁</small>}
              <ChevronDown className="settings-chevron" size={13} aria-hidden="true" />
            </button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content
              className="settings-popover"
              side="bottom"
              align="start"
              sideOffset={6}
              collisionPadding={12}
              aria-label={t("settings")}
            >
              <div className="settings-heading">{t("settings")}</div>
              <div className="settings-section-label">{t("appearance")}</div>
              <div className="appearance-row">
                <label className="system-theme-control">
                  <input
                    type="checkbox"
                    checked={theme.mode === "auto"}
                    onChange={toggleSystemTheme}
                  />
                  <span className="compact-switch" aria-hidden="true"><i /></span>
                  <span>{t("followSystem")}</span>
                </label>
                <button
                  type="button"
                  className={`manual-theme-switch is-${theme.resolved}`}
                  disabled={theme.mode === "auto"}
                  onClick={toggleManualTheme}
                  aria-label={theme.resolved === "light" ? t("light") : t("dark")}
                  title={theme.resolved === "light" ? t("light") : t("dark")}
                >
                  <Sun size={13} aria-hidden="true" />
                  <span aria-hidden="true"><i /></span>
                  <Moon size={13} aria-hidden="true" />
                </button>
              </div>

              <label className="language-row">
                <span>{t("language")}</span>
                <select
                  value={language}
                  disabled={busy}
                  onChange={(event) => setLanguage(event.target.value as UiLanguage)}
                >
                  <option value="en">English</option>
                  <option value="zh-CN">简体中文</option>
                </select>
              </label>

              <button type="button" className="about-menu-item" onClick={showAbout}>
                <Info size={15} aria-hidden="true" />
                <span>{t("about")}</span>
                <ChevronDown size={13} aria-hidden="true" />
              </button>
            </Popover.Content>
          </Popover.Portal>
        </div>
      </Popover.Root>

      <Dialog.Root open={aboutOpen} onOpenChange={setAboutOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="confirm-backdrop about-backdrop" />
          <Dialog.Content
              className="about-dialog"
              aria-describedby={undefined}
              onCloseAutoFocus={(event) => {
                event.preventDefault();
                triggerRef.current?.focus();
              }}
            >
              <Dialog.Close asChild>
                <button type="button" className="about-close" aria-label={t("close")} title={t("close")}>
                  <X size={15} />
                </button>
              </Dialog.Close>
              <img src={appIcon} alt="" className="about-icon" />
              <Dialog.Title asChild><h2>Quantum Leap</h2></Dialog.Title>
              {language === "zh-CN" && <span className="about-subtitle">跃迁</span>}
              <p className="about-version">{t("version", { version })}</p>
              <p className="about-copyright">Copyright © 2026 Anti2077</p>
              <span className="about-license">{t("license")}</span>
              <button type="button" className="project-link" onClick={openProjectHomepage}>
                {t("projectHomepage")}
                <ExternalLink size={13} aria-hidden="true" />
              </button>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
