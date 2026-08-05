import { getCurrentWindow } from "@tauri-apps/api/window";
import * as Dialog from "@radix-ui/react-dialog";
import { AnimatePresence, motion } from "framer-motion";
import Activity from "lucide-react/dist/esm/icons/activity.js";
import ChevronDown from "lucide-react/dist/esm/icons/chevron-down.js";
import FileKey2 from "lucide-react/dist/esm/icons/file-key-2.js";
import KeyRound from "lucide-react/dist/esm/icons/key-round.js";
import Network from "lucide-react/dist/esm/icons/network.js";
import Radio from "lucide-react/dist/esm/icons/radio.js";
import Server from "lucide-react/dist/esm/icons/server.js";
import Settings2 from "lucide-react/dist/esm/icons/settings-2.js";
import Info from "lucide-react/dist/esm/icons/info.js";
import UserRound from "lucide-react/dist/esm/icons/user-round.js";
import X from "lucide-react/dist/esm/icons/x.js";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type MouseEvent as ReactMouseEvent
} from "react";
import { startSpeedTest, stopSpeedTest } from "../lib/api";
import {
  formatBandwidthParts,
  type BandwidthUnit
} from "../lib/format";
import { useI18n, type TranslationKey } from "../lib/i18n";
import { downloadRating } from "../lib/speed-rating";
import type {
  SavedServer,
  SpeedStateEvent,
  SpeedTestRequest,
  TransferDirection
} from "../lib/types";
import {
  buildSpeedTestRequest,
  confirmSpeedTestRequest,
  deriveTestConfiguration,
  initialForm,
  initialRemoteClientForm,
  type ConnectionForm,
  type RemoteClientForm
} from "../features/speed-test/form-model";
import {
  applyReceiverSummary,
  summarizeSamples,
  type SamplePoint
} from "../features/speed-test/results-model";
import { useSpeedTestSession } from "../features/speed-test/useSpeedTestSession";
import { PromptDialog } from "../features/speed-test/PromptDialog";
import { ResultsPanel } from "../features/speed-test/ResultsPanel";
import {
  EndpointOverview,
  FieldLabel,
  SavedEndpointSelect,
  TopologySelector
} from "../features/speed-test/EndpointConfiguration";
import { TestConfiguration } from "../features/speed-test/TestConfiguration";
import { SavedServersPopover } from "../features/saved-servers/SavedServersPopover";
import { useSavedServers } from "../features/saved-servers/useSavedServers";
import { swapRemoteEndpointForms } from "../features/speed-test/endpoint-model";
import { GlassPanel } from "./GlassPanel";
import { AppSettings } from "./AppSettings";
import {
  ConnectionShell,
  LAYOUT_DIVIDER_WIDTH,
  LayoutResizer,
  useWorkbenchLayout
} from "./workbench/WorkbenchLayout";

const BANDWIDTH_UNIT_KEY = "pulse.bandwidth-unit";
const CONNECTION_FORM_ID = "connection-settings-form";
type DesignPreviewTheme = "air" | "frost" | "crystal";

function designPreviewSamples(): SamplePoint[] {
  const makeDirection = (direction: TransferDirection, base: number, phase: number) =>
    Array.from({ length: 24 }, (_, index): SamplePoint => {
      const bps = base + Math.sin(index * 0.58 + phase) * base * 0.075 + Math.cos(index * 0.23) * base * 0.035;
      return {
        t: (index + 1) * 0.5,
        bps,
        bytes: Math.round((bps * 0.5) / 8),
        retransmits: direction === "upload" && index % 11 === 0 ? 1 : 0,
        latencyMs: 12 + Math.sin(index * 0.42 + phase) * 2,
        jitterMs: 3 + Math.cos(index * 0.37 + phase) * 0.8,
        direction
      };
    });
  return [...makeDirection("upload", 1.16e9, 0.2), ...makeDirection("download", 1.08e9, 1.1)];
}

function savedBandwidthUnit(): BandwidthUnit {
  try {
    return localStorage.getItem(BANDWIDTH_UNIT_KEY) === "Gbps" ? "Gbps" : "Mbps";
  } catch {
    return "Mbps";
  }
}

const phaseLabelKeys: Record<SpeedStateEvent["phase"], TranslationKey> = {
  idle: "ready",
  starting: "connecting",
  confirming: "confirm",
  running: "testing",
  stopping: "stopping",
  completed: "complete",
  cancelled: "stopped",
  failed: "error"
};

function errorMessage(error: unknown, fallback: string) {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  return fallback;
}

export function SpeedWorkbench() {
  const { language, t, formatNumber } = useI18n();
  const previewParameters = import.meta.env.DEV ? new URLSearchParams(window.location.search) : null;
  const animationPreviewDirection = previewParameters?.get("animationPreview") ?? null;
  const requestedDesignTheme = previewParameters?.get("designPreview") ?? null;
  const designPreviewTheme: DesignPreviewTheme | null =
    requestedDesignTheme === "air" || requestedDesignTheme === "frost" || requestedDesignTheme === "crystal"
      ? requestedDesignTheme
      : null;
  const resultPreview = designPreviewTheme != null && previewParameters?.get("resultPreview") === "1";
  const advancedPreview = designPreviewTheme != null && previewParameters?.get("advancedPreview") === "1";
  const promptPreview = designPreviewTheme != null ? previewParameters?.get("promptPreview") : null;
  const previewDirection: TransferDirection | null =
    animationPreviewDirection === "upload" || animationPreviewDirection === "download"
      ? animationPreviewDirection
      : designPreviewTheme && !resultPreview
        ? "upload"
        : null;
  const [form, setForm] = useState<ConnectionForm>(() =>
    designPreviewTheme
      ? {
          ...initialForm,
          host: "edge.example",
          localBindIp: "192.0.2.10",
          serverBindIp: "198.51.100.20",
          username: "operator",
          password: "preview-password",
          testMode: advancedPreview ? "advanced" : initialForm.testMode,
          protocol: advancedPreview ? "udp" : initialForm.protocol
        }
      : initialForm
  );
  const [clientForm, setClientForm] = useState<RemoteClientForm>(() =>
    designPreviewTheme
      ? {
          ...initialRemoteClientForm,
          host: "192.0.2.20",
          bindIp: "192.0.2.20",
          username: "operator",
          password: "preview-password",
          remoteIperfPath: "/opt/bin/iperf3"
        }
      : initialRemoteClientForm
  );
  const [endpointEditor, setEndpointEditor] = useState<"client" | "server" | null>(null);
  const [clientAdvancedOpen, setClientAdvancedOpen] = useState(false);
  const [serverAdvancedOpen, setServerAdvancedOpen] = useState(advancedPreview);
  const {
    samples,
    latest,
    summaries,
    prompt,
    status,
    setStatus,
    reset: resetSession,
    dismissPrompt
  } = useSpeedTestSession(() => ({
    samples: designPreviewTheme ? designPreviewSamples() : [],
    latest: null,
    prompt:
      promptPreview === "existingServer"
        ? {
            kind: "existingServer",
            title: t("promptExistingTitle"),
            message: t("promptExistingMessage"),
            detail: "edge.example:5201"
          }
        : promptPreview === "hostKeyMismatch"
          ? {
              kind: "hostKeyMismatch",
              title: t("promptHostKeyTitle"),
              message: t("promptHostKeyMessage"),
              detail: "SHA256:preview-host-key-fingerprint"
            }
          : promptPreview === "iperf3Missing"
            ? {
                kind: "iperf3Missing",
                title: t("promptMissingTitle"),
                message: t("promptMissingMessage"),
                detail: "sudo apt-get update && sudo apt-get install -y iperf3"
              }
            : promptPreview === "serverUnavailable"
              ? {
                  kind: "serverUnavailable",
                  title: t("promptUnavailableTitle"),
                  message: t("promptUnavailableMessage"),
                  detail: t("serverAddressDetail", { host: "198.51.100.20", port: 5201 })
                }
              : null,
    status: designPreviewTheme
      ? resultPreview
        ? { phase: "completed", message: t("previewComplete") }
        : { phase: "running", message: t("previewRunning") }
      : { phase: "idle", message: t("waitingForServer") },
    lastGood: {},
    summaries: advancedPreview && resultPreview
      ? {
          upload: {
            bandwidthBps: 942_000_000,
            bytes: 1_177_500_000,
            jitterMs: 0.42,
            lostPackets: 580,
            packets: 91_240,
            lostPercent: 0.64,
            direction: "upload"
          }
        }
      : {}
  }));
  const previewSavedServers: SavedServer[] = designPreviewTheme
    ? [
        { id: "preview-1", note: t("previewCloud"), host: "edge.example", sshPort: 22, iperfPort: 5201, remoteIperfPath: "", bindIp: "", serverMode: "sshManaged", username: "operator", password: "preview", authMethod: "password", privateKeyPath: "" },
        { id: "preview-2", note: t("previewRouter"), host: "198.51.100.20", sshPort: 22, iperfPort: 5201, remoteIperfPath: "", bindIp: "", serverMode: "existing", username: "", password: "", authMethod: "password", privateKeyPath: "" },
        { id: "preview-3", note: t("previewDevMachine"), host: "203.0.113.30", sshPort: 22, iperfPort: 5201, remoteIperfPath: "/opt/bin/iperf3", bindIp: "203.0.113.30", serverMode: "sshManaged", username: "operator", password: "preview", authMethod: "password", privateKeyPath: "" }
      ]
    : [];
  const {
    servers: savedServers,
    menuOpen: savedMenuOpen,
    setMenuOpen: setSavedMenuOpen,
    noteEditorOpen: savedNoteEditorOpen,
    setNoteEditorOpen: setSavedNoteEditorOpen,
    noteDraft: savedNoteDraft,
    setNoteDraft: setSavedNoteDraft,
    busy: savedBusy,
    clientSavedId,
    serverSavedId,
    clearClientSelection,
    clearServerSelection,
    swapSelectedIds,
    selectClient: selectSavedClient,
    selectServer: selectSavedServer,
    selectServerById: selectSavedServerById,
    openNoteEditor,
    saveCurrent: saveCurrentServer,
    remove: removeSavedServer
  } = useSavedServers({
    form,
    setForm,
    setClientForm,
    setStatus,
    initialServers: previewSavedServers
  });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [promptDetailCopied, setPromptDetailCopied] = useState(false);
  const [bandwidthUnit, setBandwidthUnit] = useState<BandwidthUnit>(savedBandwidthUnit);
  const {
    appContentRef,
    endpointEditorRef,
    compactLayout,
    layoutSplit,
    layoutResizing,
    connectionOpen,
    setConnectionOpen,
    setLayoutSplit,
    startLayoutResize,
    moveLayoutResize,
    stopLayoutResize
  } = useWorkbenchLayout({
    endpointEditor,
    initialConnectionOpen: previewParameters?.get("drawerPreview") === "1"
  });
  const requestRef = useRef<SpeedTestRequest | null>(null);
  const previousLanguageRef = useRef(language);

  const startWindowDrag = (event: ReactMouseEvent<HTMLElement>) => {
    if (event.button !== 0 || (event.target as Element).closest("button, input, select, textarea, a")) return;
    event.preventDefault();
    if (!("__TAURI_INTERNALS__" in window)) return;
    void getCurrentWindow().startDragging().catch(() => undefined);
  };

  useEffect(() => setPromptDetailCopied(false), [prompt]);

  useEffect(() => {
    try {
      localStorage.setItem(BANDWIDTH_UNIT_KEY, bandwidthUnit);
    } catch {
      // The selected unit still applies for this session when storage is unavailable.
    }
  }, [bandwidthUnit]);

  const busy = previewDirection != null || ["starting", "running", "stopping"].includes(status.phase);

  useEffect(() => {
    if (previousLanguageRef.current === language) return;
    previousLanguageRef.current = language;
    if (busy || status.phase === "confirming") return;
    setStatus((current) => ({
      ...current,
      message:
        current.phase === "completed"
          ? t("genericCompleted")
          : current.phase === "cancelled"
            ? t("genericStopped")
            : current.phase === "failed"
              ? t("genericFailed")
              : t("waitingForServer")
    }));
  }, [busy, language, status.phase, t]);

  const running = previewDirection != null || status.phase === "running";
  const testConfiguration = deriveTestConfiguration(form, clientForm);
  const {
    standard,
    remoteToRemote,
    sshManaged,
    duration,
    continuous,
    parallelStreams,
    protocol,
    rateLimitValid,
    targetBitrateBps,
    remoteIperfPath,
    clientRemoteIperfPath,
    localBindIp,
    serverBindIp,
    clientBindIp,
    remoteIperfPathInvalid,
    clientRemoteIperfPathInvalid,
    localBindIpInvalid,
    serverBindIpInvalid,
    clientBindIpInvalid,
    valid,
    canSaveCurrentServer
  } = testConfiguration;
  const completedStandard = standard && status.phase === "completed";
  const activeDirection = previewDirection ?? (standard ? (latest?.direction ?? "upload") : form.direction);
  const activeSamples = useMemo(
    () => samples.filter((sample) => sample.direction === activeDirection),
    [activeDirection, samples]
  );
  const uploadStats = useMemo(() => summarizeSamples(samples, "upload"), [samples]);
  const downloadStats = useMemo(() => summarizeSamples(samples, "download"), [samples]);
  const overallStats = useMemo(() => summarizeSamples(samples), [samples]);
  const sampledActiveStats = activeDirection === "upload" ? uploadStats : downloadStats;
  const receiverSummary = summaries[activeDirection];
  const activeStats = applyReceiverSummary(sampledActiveStats, receiverSummary);
  const totalBytes = uploadStats.bytes + downloadStats.bytes;
  const displayedRetransmits = standard ? overallStats.retransmits : activeStats.retransmits;
  const retransmitWarning = protocol === "tcp" && status.phase === "completed" && displayedRetransmits >= 100;
  const displayedStatusMessage = retransmitWarning
    ? t("retransmitWarning", { count: formatNumber(displayedRetransmits) })
    : status.message;
  const displayedBps = designPreviewTheme
    ? resultPreview
      ? downloadStats.average
      : 1.18e9
    : previewDirection
      ? 1e9
      : receiverSummary
        ? receiverSummary.bandwidthBps
        : completedStandard
          ? downloadStats.average
          : (latest?.bandwidthBps ?? 0);
  const rate = useMemo(
    () => formatBandwidthParts(displayedBps, bandwidthUnit),
    [bandwidthUnit, displayedBps]
  );
  const rating = downloadRating(downloadStats.average);
  const motionIntensity = Math.min(1, Math.max(0, displayedBps / 1e9));
  const elapsed = Math.min(duration, Math.max(0, latest?.elapsed ?? 0));
  const completedDuration = standard && latest?.direction === "download" ? duration : 0;
  const progress = designPreviewTheme
    ? 62
    : continuous
      ? 0
      : status.phase === "completed"
        ? 100
        : Math.min(
            100,
            Math.max(0, ((completedDuration + elapsed) / (duration * (standard ? 2 : 1))) * 100)
          );
  const update = <K extends keyof ConnectionForm>(key: K, value: ConnectionForm[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    if (key === "testTopology") {
      setEndpointEditor(value === "remoteToRemote" ? "client" : null);
    }
  };

  const updateServer = <K extends keyof ConnectionForm>(key: K, value: ConnectionForm[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    clearServerSelection();
  };

  const updateClient = <K extends keyof RemoteClientForm>(key: K, value: RemoteClientForm[K]) => {
    setClientForm((current) => ({ ...current, [key]: value }));
    clearClientSelection();
  };

  const swapRemoteEndpoints = () => {
    if (!remoteToRemote || !sshManaged || busy) return;
    const swapped = swapRemoteEndpointForms(form, clientForm);
    setForm(swapped.server);
    setClientForm(swapped.client);
    swapSelectedIds();
    setStatus({ phase: "idle", message: t("endpointsSwapped") });
  };

  const launch = async (request: SpeedTestRequest) => {
    requestRef.current = request;
    setStatus({
      phase: "starting",
      message:
        request.testTopology === "remoteToRemote"
          ? t("connectingDual")
          : request.serverMode === "sshManaged"
            ? t("connectingSsh")
            : t("connectingExisting")
    });
    try {
      await startSpeedTest(request);
    } catch (error) {
      setStatus({ phase: "failed", message: errorMessage(error, t("genericStartError")) });
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!valid || busy) return;

    const request = buildSpeedTestRequest(language, form, clientForm, testConfiguration);

    resetSession();
    setConnectionOpen(false);
    await launch(request);
  };

  const confirmPrompt = async () => {
    const request = requestRef.current;
    if (!request || !prompt) return;
    const nextRequest = confirmSpeedTestRequest(request, prompt.kind);
    dismissPrompt();
    await launch(nextRequest);
  };

  const copyPromptDetail = async () => {
    if (!prompt?.detail) return;
    try {
      await navigator.clipboard.writeText(prompt.detail);
      setPromptDetailCopied(true);
    } catch {
      setStatus({ phase: "failed", message: t("copyFailed") });
    }
  };

  const rejectPrompt = () => {
    const missingIperf3 = prompt?.kind === "iperf3Missing" || prompt?.kind === "clientIperf3Missing";
    const serverUnavailable = prompt?.kind === "serverUnavailable";
    dismissPrompt();
    requestRef.current = null;
    setStatus({
      phase: serverUnavailable ? "failed" : "cancelled",
      message: serverUnavailable
        ? prompt?.message ?? t("promptUnavailableTitle")
        : missingIperf3
          ? t("missingRemoteIperf")
          : t("connectionCancelled")
    });
  };

  const stop = async () => {
    if (!busy) return;
    try {
      await stopSpeedTest(language);
    } catch (error) {
      setStatus({ phase: "failed", message: errorMessage(error, t("genericStartError")) });
    }
  };

  return (
    <div className="app-frame">
      <div className="ambient-plane ambient-plane-top" />
      <div className="ambient-plane ambient-plane-bottom" />

      <header className="titlebar" data-tauri-drag-region onMouseDown={startWindowDrag}>
        <AppSettings
          open={settingsOpen}
          busy={busy || status.phase === "confirming"}
          onOpenChange={(next) => {
            setSettingsOpen(next);
            if (next) setSavedMenuOpen(false);
          }}
        />
        <div className={`titlebar-state phase-${status.phase}`} data-tauri-drag-region>
          <span />
          {t(phaseLabelKeys[status.phase])}
        </div>
      </header>

      <main
        ref={appContentRef}
        className={`app-content ${compactLayout ? "is-compact" : "is-workspace"} ${layoutResizing ? "is-resizing" : ""}`}
        style={{
          "--connection-width": `calc(${layoutSplit * 100}% - ${layoutSplit * LAYOUT_DIVIDER_WIDTH}px)`
        } as CSSProperties}
      >
        <ConnectionShell
          compact={compactLayout}
          open={connectionOpen}
          busy={busy}
          status={status.phase}
          summaryLabel={remoteToRemote ? t("remoteTest") : t("serverAddress")}
          summaryValue={form.host.trim() || t("notConnected")}
          configureLabel={t("configureConnection")}
          stopLabel={t("stopTest")}
          onOpenChange={setConnectionOpen}
          onStop={() => void stop()}
          onNestedEscape={() => {
            if (!endpointEditor) return false;
            setEndpointEditor(null);
            return true;
          }}
        >
          <GlassPanel className="connection-panel">
                    <div className="panel-heading">
              <div>
                <span className="eyebrow">
                  {remoteToRemote ? "Dual SSH" : sshManaged ? "SSH endpoint" : "IPERF3 endpoint"}
                </span>
                {compactLayout ? (
                  <Dialog.Title asChild>
                    <h1>{remoteToRemote ? t("remoteTest") : t("connectServer")}</h1>
                  </Dialog.Title>
                ) : (
                  <h1>{remoteToRemote ? t("remoteTest") : t("connectServer")}</h1>
                )}
                {compactLayout && (
                  <Dialog.Description className="sr-only">
                    {t("connectionPanelDescription")}
                  </Dialog.Description>
                )}
              </div>
              <div className="drawer-heading-actions">
                <SavedServersPopover
                  open={savedMenuOpen}
                  busy={busy}
                  savedBusy={savedBusy}
                  canSaveCurrentServer={canSaveCurrentServer}
                  servers={savedServers}
                  currentHost={form.host.trim()}
                  noteEditorOpen={savedNoteEditorOpen}
                  noteDraft={savedNoteDraft}
                  onOpenChange={setSavedMenuOpen}
                  onOpenNoteEditor={() => openNoteEditor(canSaveCurrentServer)}
                  onNoteDraftChange={setSavedNoteDraft}
                  onCloseNoteEditor={() => setSavedNoteEditorOpen(false)}
                  onSave={() => void saveCurrentServer(canSaveCurrentServer)}
                  onSelect={(server) => void selectSavedServer(server)}
                  onDelete={(id) => void removeSavedServer(id)}
                />
                {compactLayout && (
                  <Dialog.Close asChild>
                    <button
                      type="button"
                      className="drawer-close"
                      aria-label={t("closeConnectionSettings")}
                      title={t("closeConnectionSettings")}
                    >
                      <X size={16} aria-hidden="true" />
                    </button>
                  </Dialog.Close>
                )}
              </div>
            </div>

              <form id={CONNECTION_FORM_ID} onSubmit={submit} className="connection-form">
                <TopologySelector
                  remoteToRemote={remoteToRemote}
                  busy={busy}
                  onChange={(next) => update("testTopology", next ? "remoteToRemote" : "localToRemote")}
                />

                <div className="connection-scroll-region">

                {remoteToRemote && (
                  <EndpointOverview
                    editor={endpointEditor}
                    clientHost={clientForm.host.trim()}
                    serverHost={form.host.trim()}
                    sshManaged={sshManaged}
                    busy={busy}
                    onEditorChange={setEndpointEditor}
                    onSwap={swapRemoteEndpoints}
                  />
                )}

                <AnimatePresence initial={false}>
                  {remoteToRemote && endpointEditor === "client" && (
                    <motion.section
                      ref={endpointEditorRef}
                      className="endpoint-card endpoint-editor-dialog editor-client"
                      role="region"
                      aria-label={t("clientConfiguration")}
                      initial={{ opacity: 0, height: 0, y: -8 }}
                      animate={{ opacity: 1, height: "auto", y: 0 }}
                      exit={{ opacity: 0, height: 0, y: -8 }}
                      transition={{ duration: 0.18, ease: "easeOut" }}
                    >
                      <SavedEndpointSelect
                        value={clientSavedId}
                        servers={savedServers.filter((server) => server.serverMode === "sshManaged")}
                        disabled={busy || savedBusy}
                        onChange={(id) => void selectSavedClient(id)}
                      />

                      <div className="field-grid">
                        <label>
                          <FieldLabel icon={<Radio size={13} />}>{t("clientAddress")}</FieldLabel>
                          <input
                            className="glass-input"
                            value={clientForm.host}
                            disabled={busy}
                            onChange={(event) => updateClient("host", event.target.value)}
                            placeholder="192.168.1.10"
                            spellCheck={false}
                            autoComplete="off"
                          />
                        </label>
                        <label>
                          <FieldLabel icon={<Server size={13} />}>{t("sshPort")}</FieldLabel>
                          <input
                            className="glass-input"
                            type="number"
                            min="1"
                            max="65535"
                            value={clientForm.sshPort}
                            disabled={busy}
                            onChange={(event) => updateClient("sshPort", event.target.value)}
                          />
                        </label>
                      </div>

                      <label>
                        <FieldLabel icon={<UserRound size={13} />}>{t("username")}</FieldLabel>
                        <input
                          className="glass-input"
                          value={clientForm.username}
                          disabled={busy}
                          onChange={(event) => updateClient("username", event.target.value)}
                          placeholder="ubuntu"
                          autoComplete="username"
                        />
                      </label>

                      <div className="test-mode-tabs auth-method-tabs" aria-label={t("clientAuth")}>
                        <button
                          type="button"
                          className={clientForm.authMethod === "password" ? "selected" : ""}
                          disabled={busy}
                          onClick={() => updateClient("authMethod", "password")}
                        >
                          <KeyRound size={14} aria-hidden="true" />
                          {t("passwordLogin")}
                        </button>
                        <button
                          type="button"
                          className={clientForm.authMethod === "privateKey" ? "selected" : ""}
                          disabled={busy}
                          onClick={() => updateClient("authMethod", "privateKey")}
                        >
                          <FileKey2 size={14} aria-hidden="true" />
                          {t("sshKey")}
                        </button>
                      </div>

                      {clientForm.authMethod === "privateKey" ? (
                        <div className="private-key-fields">
                          <label>
                            <FieldLabel icon={<FileKey2 size={13} />}>{t("privateKeyPath")}</FieldLabel>
                            <input
                              className="glass-input"
                              value={clientForm.privateKeyPath}
                              disabled={busy}
                              onChange={(event) => updateClient("privateKeyPath", event.target.value)}
                              placeholder="~/.ssh/id_ed25519"
                              spellCheck={false}
                              autoComplete="off"
                            />
                          </label>
                          <label>
                            <FieldLabel icon={<KeyRound size={13} />}>{t("passphraseOptional")}</FieldLabel>
                            <input
                              className="glass-input"
                              type="password"
                              value={clientForm.passphrase}
                              disabled={busy}
                              onChange={(event) => updateClient("passphrase", event.target.value)}
                              placeholder={t("passphrasePlaceholder")}
                              autoComplete="off"
                            />
                          </label>
                        </div>
                      ) : (
                        <label>
                          <FieldLabel icon={<KeyRound size={13} />}>{t("sshPassword")}</FieldLabel>
                          <input
                            className="glass-input"
                            type="password"
                            value={clientForm.password}
                            disabled={busy}
                            onChange={(event) => updateClient("password", event.target.value)}
                            placeholder={t("clientPasswordPlaceholder")}
                            autoComplete="current-password"
                          />
                        </label>
                      )}

                      <div className="advanced-disclosure">
                        <button
                          type="button"
                          className={`advanced-disclosure-toggle ${clientAdvancedOpen ? "is-open" : ""}`}
                          onClick={() => setClientAdvancedOpen((open) => !open)}
                          disabled={busy}
                          aria-expanded={clientAdvancedOpen}
                        >
                          <span><Settings2 size={14} aria-hidden="true" />{t("advancedOptions")}</span>
                          <span className="advanced-disclosure-meta">
                            {clientForm.remoteIperfPath.trim() || clientBindIp ? t("customSettings") : t("autoDetect")}
                            <ChevronDown size={14} aria-hidden="true" />
                          </span>
                        </button>
                        <AnimatePresence initial={false}>
                        {clientAdvancedOpen && (
                          <motion.div
                            className="advanced-disclosure-motion"
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: "auto", opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ height: { duration: 0.28, ease: [0.22, 1, 0.36, 1] }, opacity: { duration: 0.18 } }}
                          >
                          <div className="advanced-disclosure-fields">
                            <label>
                              <FieldLabel icon={<Network size={13} />}>{t("clientBindIp")}</FieldLabel>
                              <input
                                className="glass-input"
                                value={clientForm.bindIp}
                                disabled={busy}
                                onChange={(event) => updateClient("bindIp", event.target.value)}
                                placeholder={t("bindIpPlaceholder")}
                                spellCheck={false}
                                autoComplete="off"
                                aria-invalid={clientBindIpInvalid}
                              />
                              <span className={`field-helper ${clientBindIpInvalid ? "is-error" : ""}`}>
                                {clientBindIpInvalid ? t("bindIpError") : t("bindIpHelper")}
                              </span>
                            </label>
                            <label className="remote-iperf-path-field">
                              <FieldLabel icon={<Settings2 size={13} />}>{t("clientIperfPath")}</FieldLabel>
                              <input
                                className="glass-input"
                                value={clientForm.remoteIperfPath}
                                disabled={busy}
                                onChange={(event) => updateClient("remoteIperfPath", event.target.value)}
                                placeholder={t("iperfPathPlaceholder")}
                                spellCheck={false}
                                autoComplete="off"
                                aria-invalid={clientRemoteIperfPathInvalid}
                              />
                              <span className={`field-helper ${clientRemoteIperfPathInvalid ? "is-error" : ""}`}>
                                {clientRemoteIperfPathInvalid ? t("absolutePathError") : t("pathHelper")}
                              </span>
                            </label>
                          </div>
                          </motion.div>
                        )}
                        </AnimatePresence>
                      </div>
                    </motion.section>
                  )}
                </AnimatePresence>

                <AnimatePresence initial={false}>
                {(!remoteToRemote || endpointEditor === "server") && (
                <motion.section
                  ref={endpointEditorRef}
                  className={remoteToRemote
                    ? "endpoint-card endpoint-editor-dialog editor-server"
                    : "server-endpoint-form"}
                  role={remoteToRemote ? "region" : undefined}
                  aria-label={remoteToRemote ? t("serverConfiguration") : undefined}
                  initial={remoteToRemote ? { opacity: 0, height: 0, y: -8 } : false}
                  animate={{ opacity: 1, height: "auto", y: 0 }}
                  exit={remoteToRemote ? { opacity: 0, height: 0, y: -8 } : undefined}
                  transition={{ duration: 0.18, ease: "easeOut" }}
                >
                  {remoteToRemote && (
                    <SavedEndpointSelect
                      value={serverSavedId}
                      servers={savedServers}
                      disabled={busy || savedBusy}
                      onChange={(id) => void selectSavedServerById(id)}
                    />
                  )}

                <div className="server-mode-picker">
                  <div className="server-mode-label">
                    <FieldLabel icon={<Server size={13} />}>{t("serverMode")}</FieldLabel>
                    <span className="mode-help" tabIndex={0} aria-label={t("serverModeHelp")}>
                      <Info size={14} aria-hidden="true" />
                      <span className="mode-tooltip" role="tooltip">
                        <strong>{t("sshManaged")}</strong>
                        <span>{t("sshManagedHelp")}</span>
                        <strong>{t("existingService")}</strong>
                        <span>{t("existingServiceHelp")}</span>
                      </span>
                    </span>
                  </div>
                  <div className="test-mode-tabs server-mode-tabs" aria-label={t("serverMode")}>
                    <button
                      type="button"
                      className={sshManaged ? "selected" : ""}
                      disabled={busy}
                      onClick={() => updateServer("serverMode", "sshManaged")}
                    >
                      {t("sshManaged")}
                    </button>
                    <button
                      type="button"
                      className={!sshManaged ? "selected" : ""}
                      disabled={busy}
                      onClick={() => updateServer("serverMode", "existing")}
                    >
                      {t("existingService")}
                    </button>
                  </div>
                </div>

              <label>
                <FieldLabel icon={<Radio size={13} />}>
                  {remoteToRemote ? t("deviceBAddress") : t("serverAddress")}
                </FieldLabel>
                <input
                  autoFocus={!remoteToRemote}
                  className="glass-input"
                  value={form.host}
                  disabled={busy}
                  onChange={(event) => updateServer("host", event.target.value)}
                  placeholder="192.168.1.20"
                  spellCheck={false}
                  autoComplete="off"
                />
              </label>

              {sshManaged ? (
                <>
                  <div className="field-grid">
                    <label>
                      <FieldLabel icon={<Server size={13} />}>{t("sshPort")}</FieldLabel>
                      <input
                        className="glass-input"
                        type="number"
                        min="1"
                        max="65535"
                        value={form.sshPort}
                        disabled={busy}
                        onChange={(event) => updateServer("sshPort", event.target.value)}
                      />
                    </label>
                    <label>
                      <FieldLabel icon={<Activity size={13} />}>{t("testPort")}</FieldLabel>
                      <input
                        className="glass-input"
                        type="number"
                        min="1"
                        max="65535"
                        value={form.iperfPort}
                        disabled={busy}
                        onChange={(event) => updateServer("iperfPort", event.target.value)}
                      />
                    </label>
                  </div>
                  <label>
                    <FieldLabel icon={<UserRound size={13} />}>{t("username")}</FieldLabel>
                    <input
                      className="glass-input"
                      value={form.username}
                      disabled={busy}
                      onChange={(event) => updateServer("username", event.target.value)}
                      placeholder="ubuntu"
                      autoComplete="username"
                    />
                  </label>
                  <div className="test-mode-tabs auth-method-tabs" aria-label={t("sshAuth")}>
                    <button
                      type="button"
                      className={form.authMethod === "password" ? "selected" : ""}
                      disabled={busy}
                      onClick={() => updateServer("authMethod", "password")}
                    >
                      <KeyRound size={14} aria-hidden="true" />
                      {t("passwordLogin")}
                    </button>
                    <button
                      type="button"
                      className={form.authMethod === "privateKey" ? "selected" : ""}
                      disabled={busy}
                      onClick={() => updateServer("authMethod", "privateKey")}
                    >
                      <FileKey2 size={14} aria-hidden="true" />
                      {t("sshKey")}
                    </button>
                  </div>
                  <AnimatePresence mode="wait" initial={false}>
                    {form.authMethod === "privateKey" ? (
                      <motion.div
                        key="private-key-fields"
                        className="private-key-fields"
                        initial={{ opacity: 0, y: -6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -6 }}
                      >
                        <label>
                          <FieldLabel icon={<FileKey2 size={13} />}>{t("privateKeyPath")}</FieldLabel>
                          <input
                            className="glass-input"
                            value={form.privateKeyPath}
                            disabled={busy}
                            onChange={(event) => updateServer("privateKeyPath", event.target.value)}
                            placeholder="~/.ssh/id_ed25519"
                            spellCheck={false}
                            autoComplete="off"
                          />
                        </label>
                        <label>
                          <FieldLabel icon={<KeyRound size={13} />}>{t("passphraseOptional")}</FieldLabel>
                          <input
                            className="glass-input"
                            type="password"
                            value={form.passphrase}
                            disabled={busy}
                            onChange={(event) => updateServer("passphrase", event.target.value)}
                            placeholder={t("passphrasePlaceholder")}
                            autoComplete="off"
                          />
                        </label>
                      </motion.div>
                    ) : (
                      <motion.label
                        key="password-field"
                        initial={{ opacity: 0, y: -6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -6 }}
                      >
                        <FieldLabel icon={<KeyRound size={13} />}>{t("sshPassword")}</FieldLabel>
                        <input
                          className="glass-input"
                          type="password"
                          value={form.password}
                          disabled={busy}
                          onChange={(event) => updateServer("password", event.target.value)}
                          placeholder={t("passwordPlaceholder")}
                          autoComplete="current-password"
                        />
                      </motion.label>
                    )}
                  </AnimatePresence>
                  <div className="advanced-disclosure">
                    <button
                      type="button"
                      className={`advanced-disclosure-toggle ${serverAdvancedOpen ? "is-open" : ""}`}
                      onClick={() => setServerAdvancedOpen((open) => !open)}
                      disabled={busy}
                      aria-expanded={serverAdvancedOpen}
                    >
                      <span><Settings2 size={14} aria-hidden="true" />{t("advancedOptions")}</span>
                      <span className="advanced-disclosure-meta">
                        {form.remoteIperfPath.trim() || serverBindIp || (!remoteToRemote && localBindIp)
                          ? t("customSettings")
                          : t("autoDetect")}
                        <ChevronDown size={14} aria-hidden="true" />
                      </span>
                    </button>
                    <AnimatePresence initial={false}>
                    {serverAdvancedOpen && (
                      <motion.div
                        className="advanced-disclosure-motion"
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ height: { duration: 0.28, ease: [0.22, 1, 0.36, 1] }, opacity: { duration: 0.18 } }}
                      >
                      <div className="advanced-disclosure-fields">
                        {!remoteToRemote && (
                          <label>
                            <FieldLabel icon={<Network size={13} />}>{t("localBindIp")}</FieldLabel>
                            <input
                              className="glass-input"
                              value={form.localBindIp}
                              disabled={busy}
                              onChange={(event) => update("localBindIp", event.target.value)}
                              placeholder={t("bindIpPlaceholder")}
                              spellCheck={false}
                              autoComplete="off"
                              aria-invalid={localBindIpInvalid}
                            />
                            <span className={`field-helper ${localBindIpInvalid ? "is-error" : ""}`}>
                              {localBindIpInvalid ? t("bindIpError") : t("bindIpHelper")}
                            </span>
                          </label>
                        )}
                        <label>
                          <FieldLabel icon={<Network size={13} />}>{t("serverBindIp")}</FieldLabel>
                          <input
                            className="glass-input"
                            value={form.serverBindIp}
                            disabled={busy}
                            onChange={(event) => updateServer("serverBindIp", event.target.value)}
                            placeholder={t("bindIpPlaceholder")}
                            spellCheck={false}
                            autoComplete="off"
                            aria-invalid={serverBindIpInvalid}
                          />
                          <span className={`field-helper ${serverBindIpInvalid ? "is-error" : ""}`}>
                            {serverBindIpInvalid ? t("bindIpError") : t("serverBindIpHelper")}
                          </span>
                        </label>
                        <label className="remote-iperf-path-field">
                          <FieldLabel icon={<Settings2 size={13} />}>{t("serverIperfPath")}</FieldLabel>
                          <input
                            className="glass-input"
                            value={form.remoteIperfPath}
                            disabled={busy}
                            onChange={(event) => updateServer("remoteIperfPath", event.target.value)}
                            placeholder={t("iperfPathPlaceholder")}
                            spellCheck={false}
                            autoComplete="off"
                            aria-invalid={remoteIperfPathInvalid}
                            aria-describedby="remote-iperf-path-help"
                          />
                          <span
                            id="remote-iperf-path-help"
                            className={`field-helper ${remoteIperfPathInvalid ? "is-error" : ""}`}
                          >
                            {remoteIperfPathInvalid ? t("absolutePathError") : t("pathHelper")}
                          </span>
                        </label>
                      </div>
                      </motion.div>
                    )}
                    </AnimatePresence>
                  </div>
                </>
              ) : (
                <>
                  <label>
                    <FieldLabel icon={<Activity size={13} />}>{t("testPort")}</FieldLabel>
                    <input
                      className="glass-input"
                      type="number"
                      min="1"
                      max="65535"
                      value={form.iperfPort}
                      disabled={busy}
                      onChange={(event) => updateServer("iperfPort", event.target.value)}
                    />
                  </label>
                  {!remoteToRemote && (
                    <div className="advanced-disclosure">
                      <button
                        type="button"
                        className={`advanced-disclosure-toggle ${serverAdvancedOpen ? "is-open" : ""}`}
                        onClick={() => setServerAdvancedOpen((open) => !open)}
                        disabled={busy}
                        aria-expanded={serverAdvancedOpen}
                      >
                        <span><Settings2 size={14} aria-hidden="true" />{t("advancedOptions")}</span>
                        <span className="advanced-disclosure-meta">
                          {localBindIp ? t("customSettings") : t("autoDetect")}
                          <ChevronDown size={14} aria-hidden="true" />
                        </span>
                      </button>
                      <AnimatePresence initial={false}>
                      {serverAdvancedOpen && (
                        <motion.div
                          className="advanced-disclosure-motion"
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: "auto", opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ height: { duration: 0.28, ease: [0.22, 1, 0.36, 1] }, opacity: { duration: 0.18 } }}
                        >
                        <div className="advanced-disclosure-fields">
                          <label>
                            <FieldLabel icon={<Network size={13} />}>{t("localBindIp")}</FieldLabel>
                            <input
                              className="glass-input"
                              value={form.localBindIp}
                              disabled={busy}
                              onChange={(event) => update("localBindIp", event.target.value)}
                              placeholder={t("bindIpPlaceholder")}
                              spellCheck={false}
                              autoComplete="off"
                              aria-invalid={localBindIpInvalid}
                            />
                            <span className={`field-helper ${localBindIpInvalid ? "is-error" : ""}`}>
                              {localBindIpInvalid ? t("bindIpError") : t("bindIpHelper")}
                            </span>
                          </label>
                        </div>
                        </motion.div>
                      )}
                      </AnimatePresence>
                    </div>
                  )}
                </>
              )}

                </motion.section>
                )}
                </AnimatePresence>

                </div>

                <TestConfiguration
                  form={form}
                  standard={standard}
                  busy={busy}
                  valid={valid}
                  onUpdate={update}
                  onStop={() => void stop()}
                />
          </form>
        </GlassPanel>
        </ConnectionShell>

        {!compactLayout && (
          <LayoutResizer
            value={layoutSplit}
            label={t("resizePanels")}
            help={t("resizePanelsHelp")}
            setValue={setLayoutSplit}
            onPointerDown={startLayoutResize}
            onPointerMove={moveLayoutResize}
            onPointerUp={stopLayoutResize}
          />
        )}

        <ResultsPanel
          t={t}
          formatNumber={formatNumber}
          standard={standard}
          remoteToRemote={remoteToRemote}
          running={running}
          busy={busy}
          continuous={continuous}
          completedStandard={completedStandard}
          activeDirection={activeDirection}
          protocol={protocol}
          parallelStreams={parallelStreams}
          clientHost={clientForm.host.trim()}
          serverHost={form.host.trim()}
          serverPort={form.iperfPort}
          samples={samples}
          activeSamples={activeSamples}
          bandwidthUnit={bandwidthUnit}
          onBandwidthUnitChange={setBandwidthUnit}
          status={status}
          motionIntensity={motionIntensity}
          progress={progress}
          rate={rate}
          rating={rating}
          uploadStats={uploadStats}
          downloadStats={downloadStats}
          overallStats={overallStats}
          activeStats={activeStats}
          receiverSummary={receiverSummary}
          totalBytes={totalBytes}
          retransmitWarning={retransmitWarning}
          displayedStatusMessage={displayedStatusMessage}
        />
      </main>

      <PromptDialog
        prompt={prompt}
        detailCopied={promptDetailCopied}
        t={t}
        onConfirm={confirmPrompt}
        onReject={rejectPrompt}
        onCopyDetail={copyPromptDetail}
      />
    </div>
  );
}
