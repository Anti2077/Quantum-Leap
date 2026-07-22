import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import * as Dialog from "@radix-ui/react-dialog";
import * as Popover from "@radix-ui/react-popover";
import Activity from "lucide-react/dist/esm/icons/activity.js";
import ChevronDown from "lucide-react/dist/esm/icons/chevron-down.js";
import CircleAlert from "lucide-react/dist/esm/icons/circle-alert.js";
import Download from "lucide-react/dist/esm/icons/download.js";
import ExternalLink from "lucide-react/dist/esm/icons/external-link.js";
import Info from "lucide-react/dist/esm/icons/info.js";
import LoaderCircle from "lucide-react/dist/esm/icons/loader-circle.js";
import Moon from "lucide-react/dist/esm/icons/moon.js";
import RefreshCw from "lucide-react/dist/esm/icons/refresh-cw.js";
import Sun from "lucide-react/dist/esm/icons/sun.js";
import X from "lucide-react/dist/esm/icons/x.js";
import { useCallback, useEffect, useRef, useState } from "react";
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
import { compareVersions, type VersionRelation } from "../lib/version";

const PROJECT_URL = "https://github.com/Anti2077/Quantum-Leap";
const LATEST_RELEASE_URL = `${PROJECT_URL}/releases/latest`;
const LATEST_RELEASE_API_URL = "https://api.github.com/repos/Anti2077/Quantum-Leap/releases/latest";

type UpdateState =
  | { phase: "checking" }
  | { phase: "failed" }
  | { phase: "ready"; relation: VersionRelation; releaseVersion: string };

interface LatestReleaseResponse {
  tag_name?: string;
}

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
  const [updateOpen, setUpdateOpen] = useState(false);
  const [version, setVersion] = useState(packageMetadata.version);
  const [updateState, setUpdateState] = useState<UpdateState>({ phase: "checking" });
  const [theme, updateTheme] = useState<{ mode: ThemeMode; resolved: ResolvedTheme }>(() => {
    const mode = getThemeMode();
    return { mode, resolved: resolveTheme(mode) };
  });
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => subscribeTheme((mode, resolved) => updateTheme({ mode, resolved })), []);

  const resolveAppVersion = useCallback(async () => {
    if (!("__TAURI_INTERNALS__" in window)) return packageMetadata.version;

    try {
      const appVersion = await getVersion();
      setVersion(appVersion);
      return appVersion;
    } catch {
      setVersion(packageMetadata.version);
      return packageMetadata.version;
    }
  }, []);

  const checkForUpdates = useCallback(async () => {
    setUpdateState({ phase: "checking" });

    try {
      const [appVersion, response] = await Promise.all([
        resolveAppVersion(),
        fetch(LATEST_RELEASE_API_URL, {
          headers: { Accept: "application/vnd.github+json" }
        })
      ]);
      if (!response.ok) throw new Error(`GitHub API returned ${response.status}`);

      const release = await response.json() as LatestReleaseResponse;
      const releaseVersion = release.tag_name?.trim();
      const relation = releaseVersion ? compareVersions(appVersion, releaseVersion) : null;
      if (!releaseVersion || !relation) throw new Error("GitHub release version is invalid");

      setUpdateState({ phase: "ready", relation, releaseVersion });
    } catch {
      setUpdateState({ phase: "failed" });
    }
  }, [resolveAppVersion]);

  useEffect(() => {
    void checkForUpdates();
  }, [checkForUpdates]);

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

  const showUpdates = () => {
    onOpenChange(false);
    setUpdateOpen(true);
  };

  const openProjectHomepage = () => {
    if ("__TAURI_INTERNALS__" in window) void openUrl(PROJECT_URL);
    else window.open(PROJECT_URL, "_blank", "noopener,noreferrer");
  };

  const openLatestRelease = () => {
    if ("__TAURI_INTERNALS__" in window) void openUrl(LATEST_RELEASE_URL);
    else window.open(LATEST_RELEASE_URL, "_blank", "noopener,noreferrer");
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
              <button type="button" className="about-menu-item" onClick={showUpdates}>
                <Download size={15} aria-hidden="true" />
                <span>{t("checkForUpdates")}</span>
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

      <Dialog.Root open={updateOpen} onOpenChange={setUpdateOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="confirm-backdrop about-backdrop" />
          <Dialog.Content
            className="about-dialog update-dialog"
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
            <Download className="update-icon" size={44} aria-hidden="true" />
            <Dialog.Title asChild><h2>{t("checkForUpdates")}</h2></Dialog.Title>
            <p className="about-version">{t("version", { version })}</p>

            {updateState.phase === "checking" && (
              <p className="update-status" role="status">
                <LoaderCircle className="update-spinner" size={14} aria-hidden="true" />
                {t("checkingForUpdates")}
              </p>
            )}
            {updateState.phase === "failed" && (
              <>
                <p className="update-status is-error" role="status">
                  <CircleAlert size={14} aria-hidden="true" />
                  {t("updateCheckFailed")}
                </p>
                <button type="button" className="project-link" onClick={() => void checkForUpdates()}>
                  <RefreshCw size={13} aria-hidden="true" />
                  {t("retry")}
                </button>
              </>
            )}
            {updateState.phase === "ready" && (
              <>
                <p className="update-release">{t("latestRelease", { version: updateState.releaseVersion })}</p>
                <p className={`update-status is-${updateState.relation}`} role="status">
                  {updateState.relation === "behind" && <Download size={14} aria-hidden="true" />}
                  {updateState.relation === "ahead" && <Info size={14} aria-hidden="true" />}
                  {updateState.relation === "equal" && <Info size={14} aria-hidden="true" />}
                  {updateState.relation === "behind"
                    ? t("updateAvailable")
                    : updateState.relation === "ahead"
                      ? t("developmentVersion")
                      : t("upToDate")}
                </p>
                <button type="button" className="project-link" onClick={openLatestRelease}>
                  {t("openLatestRelease")}
                  <ExternalLink size={13} aria-hidden="true" />
                </button>
              </>
            )}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
