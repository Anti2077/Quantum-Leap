import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import * as Dialog from "@radix-ui/react-dialog";
import * as Popover from "@radix-ui/react-popover";
import Activity from "lucide-react/dist/esm/icons/activity.js";
import ChevronDown from "lucide-react/dist/esm/icons/chevron-down.js";
import Download from "lucide-react/dist/esm/icons/download.js";
import ExternalLink from "lucide-react/dist/esm/icons/external-link.js";
import Info from "lucide-react/dist/esm/icons/info.js";
import RefreshCw from "lucide-react/dist/esm/icons/refresh-cw.js";
import X from "lucide-react/dist/esm/icons/x.js";
import { useEffect, useRef, useState } from "react";
import packageMetadata from "../../package.json";
import appIcon from "../../src-tauri/icons/128x128.png";
import {
  checkForAppUpdate,
  installAppUpdate,
  startAutomaticUpdateCheck,
  useAppUpdate
} from "../features/app-update/app-update";
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
  const [updateOpen, setUpdateOpen] = useState(false);
  const [version, setVersion] = useState(packageMetadata.version);
  const update = useAppUpdate();
  const [theme, updateTheme] = useState<{ mode: ThemeMode; resolved: ResolvedTheme }>(() => {
    const mode = getThemeMode();
    return { mode, resolved: resolveTheme(mode) };
  });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const showUpdateAfterCheckRef = useRef(false);

  useEffect(() => subscribeTheme((mode, resolved) => updateTheme({ mode, resolved })), []);

  useEffect(() => {
    void startAutomaticUpdateCheck();
  }, []);

  useEffect(() => {
    if (update.phase === "available" && showUpdateAfterCheckRef.current) {
      showUpdateAfterCheckRef.current = false;
      onOpenChange(false);
      setUpdateOpen(true);
    }
  }, [onOpenChange, update.phase]);

  useEffect(() => {
    if (!aboutOpen) return;
    if ("__TAURI_INTERNALS__" in window) {
      void getVersion().then(setVersion).catch(() => setVersion(packageMetadata.version));
    } else {
      setVersion(packageMetadata.version);
    }
  }, [aboutOpen]);

  const showAbout = () => {
    onOpenChange(false);
    setAboutOpen(true);
  };

  const showUpdates = () => {
    if (
      update.phase === "available" ||
      update.phase === "downloading" ||
      update.phase === "installing" ||
      (update.phase === "error" && update.errorContext === "install")
    ) {
      onOpenChange(false);
      setUpdateOpen(true);
      return;
    }

    showUpdateAfterCheckRef.current = true;
    void checkForAppUpdate();
  };

  const updateMenuLabel = (() => {
    if (update.phase === "checking") return t("checkingForUpdates");
    if (update.phase === "upToDate") return t("upToDate");
    if (update.phase === "available" && update.availableVersion) {
      return t("updateAvailable", { version: update.availableVersion });
    }
    if (update.phase === "downloading") return t("downloadingUpdate");
    if (update.phase === "installing") return t("installingUpdate");
    if (update.phase === "error") {
      return update.errorContext === "install" ? t("updateInstallFailed") : t("updateCheckFailed");
    }
    return t("checkForUpdates");
  })();

  const updateInProgress = update.phase === "downloading" || update.phase === "installing";
  const progressPercent = update.totalBytes
    ? Math.min(100, Math.round((update.downloadedBytes / update.totalBytes) * 100))
    : undefined;

  const startUpdate = async () => {
    try {
      await installAppUpdate();
      if (update.installMode === "externalDownload") setUpdateOpen(false);
    } catch {
      // The shared update state exposes the actionable error in the dialog.
    }
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
              {update.availableVersion && <i className="update-available-dot" aria-hidden="true" />}
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
              <fieldset className="appearance-row">
                <legend className="visually-hidden">{t("appearance")}</legend>
                <div className="theme-mode-control" data-theme-mode={theme.mode}>
                  {([
                    ["auto", t("followSystem")],
                    ["light", t("light")],
                    ["dark", t("dark")]
                  ] as const).map(([mode, label]) => (
                    <label key={mode}>
                      <input
                        type="radio"
                        name="theme-mode"
                        value={mode}
                        checked={theme.mode === mode}
                        onChange={() => setThemeMode(mode)}
                      />
                      <span>{label}</span>
                    </label>
                  ))}
                </div>
              </fieldset>

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

              <button
                type="button"
                className={`update-menu-item ${update.phase === "available" ? "has-update" : ""}`}
                onClick={showUpdates}
                disabled={update.phase === "checking"}
              >
                <RefreshCw className={update.phase === "checking" ? "is-spinning" : ""} size={15} aria-hidden="true" />
                <span>{updateMenuLabel}</span>
                {update.phase === "available" ? (
                  <Download size={13} aria-hidden="true" />
                ) : (
                  <ChevronDown size={13} aria-hidden="true" />
                )}
              </button>

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

      <Dialog.Root
        open={updateOpen}
        onOpenChange={(next) => {
          if (!updateInProgress) setUpdateOpen(next);
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="confirm-backdrop update-backdrop" />
          <Dialog.Content
            className="update-dialog"
            aria-describedby="update-dialog-description"
            onEscapeKeyDown={(event) => {
              if (updateInProgress) event.preventDefault();
            }}
            onPointerDownOutside={(event) => {
              if (updateInProgress) event.preventDefault();
            }}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              triggerRef.current?.focus();
            }}
          >
            {!updateInProgress && (
              <Dialog.Close asChild>
                <button type="button" className="about-close" aria-label={t("close")} title={t("close")}>
                  <X size={15} />
                </button>
              </Dialog.Close>
            )}
            <div className="update-dialog-icon" aria-hidden="true">
              <Download size={22} />
            </div>
            <Dialog.Title asChild><h2>{t("updateDialogTitle")}</h2></Dialog.Title>
            <div id="update-dialog-description" className="update-version-row">
              <span>{t("currentVersion", { version: update.currentVersion })}</span>
              <strong>{t("newVersion", { version: update.availableVersion ?? "" })}</strong>
            </div>

            <section className="update-notes" aria-label={t("updateNotes")}>
              <h3>{t("updateNotes")}</h3>
              <p>{update.body?.trim() || t("noUpdateNotes")}</p>
            </section>

            {update.phase === "downloading" && (
              <div className="update-progress" aria-live="polite">
                <div className={progressPercent === undefined ? "is-indeterminate" : ""}>
                  <span style={progressPercent === undefined ? undefined : { width: `${progressPercent}%` }} />
                </div>
                <p>
                  {progressPercent === undefined
                    ? t("downloadingUpdate")
                    : t("downloadProgress", { percent: progressPercent })}
                </p>
              </div>
            )}

            {update.phase === "installing" && (
              <p className="update-installing" aria-live="polite">
                <RefreshCw className="is-spinning" size={14} aria-hidden="true" />
                {t("installingUpdate")}
              </p>
            )}

            {update.phase === "error" && update.errorContext === "install" && (
              <p className="update-error" role="alert">{t("updateInstallFailed")}</p>
            )}

            {busy && !updateInProgress && <p className="update-busy-message">{t("updateBusyMessage")}</p>}

            <div className="update-dialog-actions">
              <Dialog.Close asChild>
                <button type="button" className="secondary-action" disabled={updateInProgress}>{t("later")}</button>
              </Dialog.Close>
              <button
                type="button"
                className="primary-action"
                disabled={busy || updateInProgress}
                onClick={() => void startUpdate()}
              >
                {update.installMode === "externalDownload"
                  ? t("openDownloadPage")
                  : update.phase === "error"
                    ? t("retry")
                    : t("updateAndRestart")}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
