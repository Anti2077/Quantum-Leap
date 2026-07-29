import { getCurrentWindow } from "@tauri-apps/api/window";
import * as Dialog from "@radix-ui/react-dialog";
import * as Popover from "@radix-ui/react-popover";
import { AnimatePresence, motion } from "framer-motion";
import Activity from "lucide-react/dist/esm/icons/activity.js";
import ArrowDownToLine from "lucide-react/dist/esm/icons/arrow-down-to-line.js";
import ArrowRightLeft from "lucide-react/dist/esm/icons/arrow-right-left.js";
import ArrowUpFromLine from "lucide-react/dist/esm/icons/arrow-up-from-line.js";
import ChevronDown from "lucide-react/dist/esm/icons/chevron-down.js";
import CircleAlert from "lucide-react/dist/esm/icons/circle-alert.js";
import BookMarked from "lucide-react/dist/esm/icons/book-marked.js";
import Clock3 from "lucide-react/dist/esm/icons/clock-3.js";
import Check from "lucide-react/dist/esm/icons/check.js";
import FileKey2 from "lucide-react/dist/esm/icons/file-key-2.js";
import Gauge from "lucide-react/dist/esm/icons/gauge.js";
import GripVertical from "lucide-react/dist/esm/icons/grip-vertical.js";
import KeyRound from "lucide-react/dist/esm/icons/key-round.js";
import Layers3 from "lucide-react/dist/esm/icons/layers-3.js";
import Network from "lucide-react/dist/esm/icons/network.js";
import Play from "lucide-react/dist/esm/icons/play.js";
import Plus from "lucide-react/dist/esm/icons/plus.js";
import Radio from "lucide-react/dist/esm/icons/radio.js";
import Server from "lucide-react/dist/esm/icons/server.js";
import Settings2 from "lucide-react/dist/esm/icons/settings-2.js";
import Info from "lucide-react/dist/esm/icons/info.js";
import Square from "lucide-react/dist/esm/icons/square.js";
import Trash2 from "lucide-react/dist/esm/icons/trash-2.js";
import UserRound from "lucide-react/dist/esm/icons/user-round.js";
import Waves from "lucide-react/dist/esm/icons/waves.js";
import X from "lucide-react/dist/esm/icons/x.js";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode
} from "react";
import {
  deleteSavedServer,
  getSavedServerPassword,
  listSavedServers,
  saveServer,
  startSpeedTest,
  stopSpeedTest
} from "../lib/api";
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
  STANDARD_DURATION_SECONDS,
  STANDARD_PARALLEL_STREAMS,
  type ConnectionForm,
  type RemoteClientForm
} from "../features/speed-test/form-model";
import {
  summarizeSamples,
  type SamplePoint
} from "../features/speed-test/results-model";
import { useSpeedTestSession } from "../features/speed-test/useSpeedTestSession";
import { PromptDialog } from "../features/speed-test/PromptDialog";
import { ResultsPanel } from "../features/speed-test/ResultsPanel";
import {
  buildSaveServerRequest,
  matchingSavedServer,
  savedServerToClientForm,
  savedServerToConnectionForm,
  swapRemoteEndpointForms
} from "../features/speed-test/endpoint-model";
import { GlassPanel } from "./GlassPanel";
import { AppSettings } from "./AppSettings";

const BANDWIDTH_UNIT_KEY = "pulse.bandwidth-unit";
const LAYOUT_SPLIT_KEY = "pulse.layout-split";
const DEFAULT_LAYOUT_SPLIT = 0.32;
const MIN_LAYOUT_SPLIT = 0.25;
const MAX_LAYOUT_SPLIT = 0.5;
const LAYOUT_DIVIDER_WIDTH = 20;
const COMPACT_LAYOUT_QUERY = "(max-width: 860px)";
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

function savedLayoutSplit(): number {
  try {
    const storedValue = localStorage.getItem(LAYOUT_SPLIT_KEY);
    if (storedValue == null) return DEFAULT_LAYOUT_SPLIT;
    const value = Number(storedValue);
    return Number.isFinite(value)
      ? Math.min(MAX_LAYOUT_SPLIT, Math.max(MIN_LAYOUT_SPLIT, value))
      : DEFAULT_LAYOUT_SPLIT;
  } catch {
    return DEFAULT_LAYOUT_SPLIT;
  }
}

function usesCompactLayout() {
  return window.matchMedia(COMPACT_LAYOUT_QUERY).matches;
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

function FieldLabel({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <span className="field-label">
      {icon}
      {children}
    </span>
  );
}

function TargetRateInput({
  value,
  disabled,
  onChange
}: {
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const { t } = useI18n();
  return (
    <label className="target-rate-field">
      <div className="duration-input target-rate-input">
        <input
          className="glass-input"
          type="number"
          min="0.1"
          max="100000"
          step="0.1"
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          aria-label={t("targetRate")}
        />
        <span>{t("megabitsPerSecond")}</span>
      </div>
    </label>
  );
}

function AutoHeight({ children }: { children: ReactNode }) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | "auto">("auto");

  useEffect(() => {
    const content = contentRef.current;
    if (!content || typeof ResizeObserver === "undefined") return;

    const updateHeight = () => {
      const nextHeight = content.getBoundingClientRect().height;
      setHeight((current) => current === nextHeight ? current : nextHeight);
    };

    updateHeight();
    const observer = new ResizeObserver(updateHeight);
    observer.observe(content);
    return () => observer.disconnect();
  }, []);

  return (
    <motion.div
      className="test-settings-transition"
      initial={false}
      animate={{ height }}
      transition={{ height: { duration: 0.5, ease: [0.4, 0, 0.2, 1] } }}
    >
      <div ref={contentRef} className="test-settings-content">
        {children}
      </div>
    </motion.div>
  );
}

function ConnectionShell({
  compact,
  open,
  busy,
  status,
  summaryLabel,
  summaryValue,
  configureLabel,
  stopLabel,
  onOpenChange,
  onStop,
  onNestedEscape,
  children
}: {
  compact: boolean;
  open: boolean;
  busy: boolean;
  status: SpeedStateEvent["phase"];
  summaryLabel: string;
  summaryValue: string;
  configureLabel: string;
  stopLabel: string;
  onOpenChange: (open: boolean) => void;
  onStop: () => void;
  onNestedEscape: () => boolean;
  children: ReactNode;
}) {
  if (!compact) {
    return <aside className="connection-column">{children}</aside>;
  }

  return (
    <div className="command-bar" aria-label={configureLabel}>
      <div className="command-endpoint">
        <span className={`command-status phase-${status}`} aria-hidden="true" />
        <div>
          <span>{summaryLabel}</span>
          <strong>{summaryValue}</strong>
        </div>
      </div>
      <div className="command-actions">
        <button
          type="button"
          className="command-stop"
          onClick={onStop}
          disabled={!busy}
          aria-label={stopLabel}
          title={stopLabel}
        >
          <Square size={14} fill="currentColor" aria-hidden="true" />
        </button>
        <Dialog.Root open={open} onOpenChange={onOpenChange}>
          <Dialog.Trigger asChild>
            <button type="button" className="configure-trigger">
              <Settings2 size={15} aria-hidden="true" />
              {configureLabel}
            </button>
          </Dialog.Trigger>
          <Dialog.Portal>
            <Dialog.Overlay className="connection-drawer-overlay" />
            <Dialog.Content
              className="connection-drawer"
              onEscapeKeyDown={(event) => {
                if (!onNestedEscape()) return;
                event.preventDefault();
              }}
            >
              {children}
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      </div>
    </div>
  );
}

function SavedEndpointSelect({
  value,
  servers,
  disabled,
  onChange
}: {
  value: string;
  servers: SavedServer[];
  disabled: boolean;
  onChange: (id: string) => void;
}) {
  const { t } = useI18n();
  return (
    <label>
      <FieldLabel icon={<BookMarked size={13} />}>{t("loadSavedDevice")}</FieldLabel>
      <select
        className="glass-input"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">{t("enterManually")}</option>
        {servers.map((server) => (
          <option value={server.id} key={server.id}>
            {server.note ? `${server.note} · ${server.host}` : server.host}
          </option>
        ))}
      </select>
    </label>
  );
}

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
          testMode: advancedPreview ? "advanced" : initialForm.testMode
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
  const [clientSavedId, setClientSavedId] = useState("");
  const [serverSavedId, setServerSavedId] = useState("");
  const [endpointEditor, setEndpointEditor] = useState<"client" | "server" | null>(null);
  const [clientAdvancedOpen, setClientAdvancedOpen] = useState(false);
  const [serverAdvancedOpen, setServerAdvancedOpen] = useState(advancedPreview);
  const {
    samples,
    latest,
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
    lastGood: {}
  }));
  const [savedServers, setSavedServers] = useState<SavedServer[]>(() =>
    designPreviewTheme
      ? [
          { id: "preview-1", note: t("previewCloud"), host: "edge.example", sshPort: 22, iperfPort: 5201, remoteIperfPath: "", bindIp: "", serverMode: "sshManaged", username: "operator", password: "preview", authMethod: "password", privateKeyPath: "" },
          { id: "preview-2", note: t("previewRouter"), host: "198.51.100.20", sshPort: 22, iperfPort: 5201, remoteIperfPath: "", bindIp: "", serverMode: "existing", username: "", password: "", authMethod: "password", privateKeyPath: "" },
          { id: "preview-3", note: t("previewDevMachine"), host: "203.0.113.30", sshPort: 22, iperfPort: 5201, remoteIperfPath: "/opt/bin/iperf3", bindIp: "203.0.113.30", serverMode: "sshManaged", username: "operator", password: "preview", authMethod: "password", privateKeyPath: "" }
        ]
      : []
  );
  const [savedMenuOpen, setSavedMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [savedNoteEditorOpen, setSavedNoteEditorOpen] = useState(false);
  const [savedNoteDraft, setSavedNoteDraft] = useState("");
  const [savedBusy, setSavedBusy] = useState(false);
  const [promptDetailCopied, setPromptDetailCopied] = useState(false);
  const [bandwidthUnit, setBandwidthUnit] = useState<BandwidthUnit>(savedBandwidthUnit);
  const [compactLayout, setCompactLayout] = useState(usesCompactLayout);
  const [layoutSplit, setLayoutSplit] = useState(() =>
    usesCompactLayout() ? DEFAULT_LAYOUT_SPLIT : savedLayoutSplit()
  );
  const [layoutResizing, setLayoutResizing] = useState(false);
  const [connectionOpen, setConnectionOpen] = useState(
    () => previewParameters?.get("drawerPreview") === "1"
  );
  const requestRef = useRef<SpeedTestRequest | null>(null);
  const appContentRef = useRef<HTMLElement>(null);
  const endpointEditorRef = useRef<HTMLElement>(null);
  const previousLanguageRef = useRef(language);

  const startWindowDrag = (event: ReactMouseEvent<HTMLElement>) => {
    if (event.button !== 0 || (event.target as Element).closest("button, input, select, textarea, a")) return;
    event.preventDefault();
    if (!("__TAURI_INTERNALS__" in window)) return;
    void getCurrentWindow().startDragging().catch(() => undefined);
  };

  const updateLayoutSplit = (clientX: number) => {
    if (compactLayout) return;
    const bounds = appContentRef.current?.getBoundingClientRect();
    if (!bounds) return;
    const availableWidth = Math.max(1, bounds.width - LAYOUT_DIVIDER_WIDTH);
    const next = (clientX - bounds.left - LAYOUT_DIVIDER_WIDTH / 2) / availableWidth;
    setLayoutSplit(Math.min(MAX_LAYOUT_SPLIT, Math.max(MIN_LAYOUT_SPLIT, next)));
  };

  const startLayoutResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (compactLayout || event.button !== 0) return;
    event.preventDefault();
    if (typeof event.currentTarget.setPointerCapture === "function") {
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    setLayoutResizing(true);
    updateLayoutSplit(event.clientX);
  };

  const moveLayoutResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!layoutResizing) return;
    event.preventDefault();
    updateLayoutSplit(event.clientX);
  };

  const stopLayoutResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!layoutResizing) return;
    if (
      typeof event.currentTarget.hasPointerCapture === "function" &&
      event.currentTarget.hasPointerCapture(event.pointerId)
    ) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setLayoutResizing(false);
  };

  useEffect(() => setPromptDetailCopied(false), [prompt]);

  useEffect(() => {
    void listSavedServers(language)
      .then(setSavedServers)
      .catch(() => undefined);
  }, [language]);

  useEffect(() => {
    try {
      localStorage.setItem(BANDWIDTH_UNIT_KEY, bandwidthUnit);
    } catch {
      // The selected unit still applies for this session when storage is unavailable.
    }
  }, [bandwidthUnit]);

  useEffect(() => {
    const media = window.matchMedia(COMPACT_LAYOUT_QUERY);
    const updateLayoutMode = (event: MediaQueryListEvent) => {
      setCompactLayout(event.matches);
      setLayoutResizing(false);
      if (!event.matches) setConnectionOpen(false);
    };
    media.addEventListener("change", updateLayoutMode);
    return () => media.removeEventListener("change", updateLayoutMode);
  }, []);

  useEffect(() => {
    if (compactLayout) return;
    try {
      localStorage.setItem(LAYOUT_SPLIT_KEY, layoutSplit.toString());
    } catch {
      // The adjusted layout still applies for this session when storage is unavailable.
    }
  }, [compactLayout, layoutSplit]);

  useEffect(() => {
    if (savedMenuOpen) return;
    setSavedNoteEditorOpen(false);
    setSavedNoteDraft("");
  }, [savedMenuOpen]);

  const busy = previewDirection != null || ["starting", "running", "stopping"].includes(status.phase);

  useEffect(() => {
    if (!compactLayout || !connectionOpen || !endpointEditor) return;
    const frame = requestAnimationFrame(() => {
      endpointEditorRef.current?.scrollIntoView({ block: "nearest" });
    });
    return () => cancelAnimationFrame(frame);
  }, [compactLayout, connectionOpen, endpointEditor]);

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
  const activeStats = activeDirection === "upload" ? uploadStats : downloadStats;
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
    setServerSavedId("");
  };

  const updateClient = <K extends keyof RemoteClientForm>(key: K, value: RemoteClientForm[K]) => {
    setClientForm((current) => ({ ...current, [key]: value }));
    setClientSavedId("");
  };

  const selectSavedClient = async (id: string) => {
    setClientSavedId(id);
    if (!id || savedBusy) return;
    const server = savedServers.find((candidate) => candidate.id === id);
    if (!server || server.serverMode !== "sshManaged") return;
    setSavedBusy(true);
    try {
      const password = server.password || (await getSavedServerPassword(server.id, language));
      setSavedServers((current) =>
        current.map((saved) => (saved.id === server.id ? { ...saved, password } : saved))
      );
      setClientForm(savedServerToClientForm(server, password, initialRemoteClientForm.privateKeyPath));
      setStatus({ phase: "idle", message: t("clientSelected", { name: server.note || server.host }) });
    } catch (error) {
      setStatus({ phase: "failed", message: errorMessage(error, t("savedActionError")) });
    } finally {
      setSavedBusy(false);
    }
  };

  const swapRemoteEndpoints = () => {
    if (!remoteToRemote || !sshManaged || busy) return;
    const swapped = swapRemoteEndpointForms(form, clientForm);
    setForm(swapped.server);
    setClientForm(swapped.client);
    const previousClientSavedId = clientSavedId;
    setClientSavedId(serverSavedId);
    setServerSavedId(previousClientSavedId);
    setStatus({ phase: "idle", message: t("endpointsSwapped") });
  };

  const selectSavedServer = async (server: SavedServer) => {
    if (savedBusy) return;
    setSavedBusy(true);
    try {
      const password = server.serverMode === "sshManaged"
        ? server.password || (await getSavedServerPassword(server.id, language))
        : "";
      setSavedServers((current) =>
        current.map((saved) => (saved.id === server.id ? { ...saved, password } : saved))
      );
      setForm((current) => savedServerToConnectionForm(current, server, password, initialForm.privateKeyPath));
      setServerSavedId(server.id);
      setSavedMenuOpen(false);
      setStatus({ phase: "idle", message: t("serverLoaded", { host: server.host }) });
    } catch (error) {
      setStatus({ phase: "failed", message: errorMessage(error, t("savedActionError")) });
    } finally {
      setSavedBusy(false);
    }
  };

  const selectSavedServerById = async (id: string) => {
    setServerSavedId(id);
    if (!id || savedBusy) return;
    const server = savedServers.find((candidate) => candidate.id === id);
    if (server) await selectSavedServer(server);
  };

  const openSavedNoteEditor = () => {
    if (!canSaveCurrentServer || savedBusy) return;
    const existing = matchingSavedServer(savedServers, form);
    setSavedNoteDraft(existing?.note ?? "");
    setSavedNoteEditorOpen(true);
  };

  const saveCurrentServer = async () => {
    if (!canSaveCurrentServer || savedBusy) return;
    const existing = matchingSavedServer(savedServers, form);
    setSavedBusy(true);
    try {
      const saved = await saveServer(
        buildSaveServerRequest(form, savedNoteDraft, existing?.id),
        language
      );
      setSavedServers((current) => [saved, ...current.filter((server) => server.id !== saved.id)]);
      setSavedNoteEditorOpen(false);
      setSavedNoteDraft("");
      setStatus({ phase: "idle", message: t("serverSaved", { name: saved.note || saved.host }) });
    } catch (error) {
      setStatus({ phase: "failed", message: errorMessage(error, t("savedActionError")) });
    } finally {
      setSavedBusy(false);
    }
  };

  const removeSavedServer = async (id: string) => {
    if (savedBusy) return;
    setSavedBusy(true);
    try {
      await deleteSavedServer(id, language);
      setSavedServers((current) => current.filter((server) => server.id !== id));
    } catch (error) {
      setStatus({ phase: "failed", message: errorMessage(error, t("savedActionError")) });
    } finally {
      setSavedBusy(false);
    }
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
                <Popover.Root open={savedMenuOpen} onOpenChange={setSavedMenuOpen}>
                  <div className="saved-server-control">
                    <Popover.Trigger asChild>
                      <button
                        type="button"
                        className={savedMenuOpen ? "saved-server-trigger active" : "saved-server-trigger"}
                        disabled={busy}
                        title={t("savedServers")}
                      >
                        <BookMarked size={15} aria-hidden="true" />
                        {t("savedServers")}
                      </button>
                    </Popover.Trigger>
                    <Popover.Portal>
                      <Popover.Content
                        className="saved-server-menu"
                        side="bottom"
                        align="end"
                        sideOffset={8}
                        collisionPadding={12}
                      >
                      <div className="saved-menu-heading">
                        <strong>{t("savedServers")}</strong>
                        <button
                          type="button"
                          onClick={openSavedNoteEditor}
                          disabled={!canSaveCurrentServer || savedBusy}
                          aria-label={t("addCurrentServer")}
                          title={t("addCurrentServer")}
                        >
                          <Plus size={14} />
                        </button>
                      </div>
                      <AnimatePresence initial={false}>
                        {savedNoteEditorOpen && (
                          <motion.form
                            className="saved-note-editor"
                            onSubmit={(event) => {
                              event.preventDefault();
                              void saveCurrentServer();
                            }}
                            initial={{ opacity: 0, height: 0, y: -4 }}
                            animate={{ opacity: 1, height: "auto", y: 0 }}
                            exit={{ opacity: 0, height: 0, y: -4 }}
                          >
                            <span title={form.host.trim()}>{form.host.trim()}</span>
                            <div className="saved-note-row">
                              <input
                                autoFocus
                                value={savedNoteDraft}
                                maxLength={48}
                                onChange={(event) => setSavedNoteDraft(event.target.value)}
                                placeholder={t("optionalNote")}
                                aria-label={t("serverNote")}
                              />
                              <button
                                type="submit"
                                disabled={savedBusy}
                                aria-label={t("save")}
                                title={t("save")}
                              >
                                <Check size={14} />
                              </button>
                              <button
                                type="button"
                                onClick={() => setSavedNoteEditorOpen(false)}
                                aria-label={t("cancel")}
                                title={t("cancel")}
                              >
                                <X size={14} />
                              </button>
                            </div>
                          </motion.form>
                        )}
                      </AnimatePresence>
                      <div className="saved-server-list">
                        {savedServers.length === 0 ? (
                          <span className="saved-empty">{t("noSavedServers")}</span>
                        ) : (
                          savedServers.map((server) => (
                            <div className="saved-server-item" key={server.id}>
                              <button type="button" onClick={() => selectSavedServer(server)}>
                                <span className="saved-server-name">{server.note || server.host}</span>
                                {server.note && <small className="saved-server-address">{server.host}</small>}
                                <small className="saved-server-meta">
                                  {server.serverMode === "sshManaged"
                                    ? t("savedSshMeta", { username: server.username, port: server.sshPort })
                                    : t("directShort", { port: server.iperfPort })}
                                </small>
                              </button>
                              <button
                                type="button"
                                className="delete-saved"
                                onClick={() => removeSavedServer(server.id)}
                                aria-label={t("deleteServer", { host: server.host })}
                                title={t("delete")}
                              >
                                <Trash2 size={13} />
                              </button>
                            </div>
                          ))
                        )}
                      </div>
                      </Popover.Content>
                    </Popover.Portal>
                  </div>
                </Popover.Root>
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
                <div className="connection-fixed-top-controls">
                  <div className="server-mode-label topology-mode-label">
                    <span className="field-label">{t("topology")}</span>
                    <span className="mode-help" tabIndex={0} aria-label={t("topologyHelp")}>
                      <CircleAlert size={14} aria-hidden="true" />
                      <span className="mode-tooltip" role="tooltip">
                        <strong>{t("localTest")}</strong>
                        <span>{t("localTestHelp")}</span>
                        <strong>{t("remoteTest")}</strong>
                        <span>{t("remoteTestHelp")}</span>
                      </span>
                    </span>
                  </div>
                  <div className="test-mode-tabs topology-tabs" aria-label={t("topology")}>
                    <button
                      type="button"
                      className={!remoteToRemote ? "selected" : ""}
                      disabled={busy}
                      onClick={() => update("testTopology", "localToRemote")}
                    >
                      {t("localTest")}
                    </button>
                    <button
                      type="button"
                      className={remoteToRemote ? "selected" : ""}
                      disabled={busy}
                      onClick={() => update("testTopology", "remoteToRemote")}
                    >
                      {t("remoteTest")}
                    </button>
                  </div>
                </div>

                <div className="connection-scroll-region">

                {remoteToRemote && (
                  <section className="endpoint-overview" aria-label={t("dualDevices")}>
                    <div className="endpoint-overview-row">
                      <button
                        type="button"
                        className={`endpoint-summary-card ${endpointEditor === "client" ? "is-active" : ""}`}
                        disabled={busy}
                        onClick={() => setEndpointEditor((current) => current === "client" ? null : "client")}
                        aria-label={t("editClient")}
                        aria-expanded={endpointEditor === "client"}
                      >
                        <span className="endpoint-summary-copy">
                          <span className="endpoint-summary-role">{t("initiator")}</span>
                          <strong>{clientForm.host.trim() || t("ipNotConfigured")}</strong>
                        </span>
                      </button>

                      <button
                        type="button"
                        className="endpoint-swap-button"
                        onClick={swapRemoteEndpoints}
                        disabled={!sshManaged || busy}
                        title={sshManaged ? t("swapEndpoints") : t("swapRequiresSsh")}
                        aria-label={t("swapEndpoints")}
                      >
                        <ArrowRightLeft size={17} aria-hidden="true" />
                      </button>

                      <button
                        type="button"
                        className={`endpoint-summary-card ${endpointEditor === "server" ? "is-active" : ""}`}
                        disabled={busy}
                        onClick={() => setEndpointEditor((current) => current === "server" ? null : "server")}
                        aria-label={t("editServer")}
                        aria-expanded={endpointEditor === "server"}
                      >
                        <span className="endpoint-summary-copy">
                          <span className="endpoint-summary-role">{t("server")}</span>
                          <strong>{form.host.trim() || t("ipNotConfigured")}</strong>
                        </span>
                      </button>
                    </div>
                  </section>
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

                <div className="connection-fixed-controls">
              <div className="test-mode-tabs" aria-label={t("testMode")}>
                <button
                  type="button"
                  className={standard ? "selected" : ""}
                  disabled={busy}
                  onClick={() => update("testMode", "standard")}
                >
                  <Gauge size={14} aria-hidden="true" />
                  {t("standardTest")}
                </button>
                <button
                  type="button"
                  className={!standard ? "selected" : ""}
                  disabled={busy}
                  onClick={() => update("testMode", "advanced")}
                >
                  <Settings2 size={14} aria-hidden="true" />
                  {t("advancedTest")}
                </button>
              </div>

              <AutoHeight>
                {standard ? (
                    <motion.div
                      key="standard"
                      className="standard-settings"
                      initial={{ opacity: 0, y: 5 }}
                      animate={{ opacity: 1, y: 0 }}
                    >
                    <div className="standard-profile">
                      <span><Network size={13} />TCP</span>
                      <span><Layers3 size={13} />{t("streams", { count: STANDARD_PARALLEL_STREAMS })}</span>
                      <span aria-label={t("bidirectionalDuration", { seconds: STANDARD_DURATION_SECONDS })}>
                        <Waves size={13} />
                        {t("standardBidirectionalDuration", { seconds: STANDARD_DURATION_SECONDS })}
                      </span>
                      <button
                        type="button"
                        className={`standard-rate-toggle ${form.rateLimitEnabled ? "is-enabled" : ""}`}
                        disabled={busy}
                        onClick={() => update("rateLimitEnabled", !form.rateLimitEnabled)}
                        aria-label={`${t("rateLimit")}: ${t(form.rateLimitEnabled ? "limited" : "unlimited")}`}
                      >
                        <Gauge size={13} aria-hidden="true" />
                        {t(form.rateLimitEnabled ? "limited" : "unlimited")}
                      </button>
                    </div>
                    {form.rateLimitEnabled && (
                        <motion.div
                          className="target-rate-reveal standard-target-rate"
                          initial={{ opacity: 0, y: -4 }}
                          animate={{ opacity: 1, y: 0 }}
                        >
                          <TargetRateInput
                            value={form.targetBitrateMbps}
                            disabled={busy}
                            onChange={(value) => update("targetBitrateMbps", value)}
                          />
                        </motion.div>
                    )}
                    </motion.div>
                  ) : (
                    <motion.div
                      key="advanced"
                      className="advanced-settings"
                      initial={{ opacity: 0, y: 5 }}
                      animate={{ opacity: 1, y: 0 }}
                    >
                    <div className="advanced-segments">
                      <div>
                        <span className="compact-label">{t("protocol")}</span>
                        <div className="mini-segmented">
                          {(["tcp", "udp"] as const).map((value) => (
                            <button
                              key={value}
                              type="button"
                              className={form.protocol === value ? "selected" : ""}
                              onClick={() => update("protocol", value)}
                            >
                              {value.toUpperCase()}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div>
                        <span className="compact-label">{t("direction")}</span>
                        <div className="mini-segmented icon-segmented">
                          <button
                            type="button"
                            className={form.direction === "upload" ? "selected upload" : ""}
                            onClick={() => update("direction", "upload")}
                            aria-label={t("upload")}
                            title={t("upload")}
                          >
                            <ArrowUpFromLine size={13} />
                          </button>
                          <button
                            type="button"
                            className={form.direction === "download" ? "selected download" : ""}
                            onClick={() => update("direction", "download")}
                            aria-label={t("download")}
                            title={t("download")}
                          >
                            <ArrowDownToLine size={13} />
                          </button>
                        </div>
                      </div>
                    </div>
                    <div className="field-grid advanced-fields">
                      <label>
                        <FieldLabel icon={<Layers3 size={13} />}>{t("parallelStreams")}</FieldLabel>
                        <input
                          className="glass-input"
                          type="number"
                          min="1"
                          max="32"
                          value={form.parallelStreams}
                          onChange={(event) => update("parallelStreams", event.target.value)}
                        />
                      </label>
                      <label>
                        <FieldLabel icon={<Clock3 size={13} />}>{t("duration")}</FieldLabel>
                        <div className="duration-input">
                          <input
                            className="glass-input"
                            type="number"
                            min="0"
                            max="120"
                            value={form.durationSeconds}
                            onChange={(event) => update("durationSeconds", event.target.value)}
                          />
                          <span>{form.durationSeconds === "0" ? t("continuous") : t("seconds")}</span>
                        </div>
                      </label>
                    </div>
                    <div className="advanced-rate-control">
                      <label className="rate-limit-toggle">
                        <span className="rate-limit-title">
                          <Gauge size={13} aria-hidden="true" />
                          {t("rateLimit")}
                        </span>
                        <input
                          type="checkbox"
                          checked={form.rateLimitEnabled}
                          disabled={busy}
                          onChange={(event) => update("rateLimitEnabled", event.target.checked)}
                          aria-label={t("rateLimit")}
                        />
                        <span className="compact-switch" aria-hidden="true"><i /></span>
                        <span className="rate-limit-state">
                          {t(form.rateLimitEnabled ? "limited" : "unlimited")}
                        </span>
                      </label>
                      {form.rateLimitEnabled && (
                          <motion.div
                            className="target-rate-reveal"
                            initial={{ opacity: 0, y: -4 }}
                            animate={{ opacity: 1, y: 0 }}
                          >
                            <TargetRateInput
                              value={form.targetBitrateMbps}
                              disabled={busy}
                              onChange={(value) => update("targetBitrateMbps", value)}
                            />
                          </motion.div>
                      )}
                    </div>
                    </motion.div>
                )}
              </AutoHeight>

              <div className="form-actions">
                <button type="submit" className="primary-action" disabled={!valid || busy}>
                  <Play size={16} fill="currentColor" aria-hidden="true" />
                  {standard ? t("startFullTest") : t("startTest")}
                </button>
                <button
                  type="button"
                  className="stop-action"
                  onClick={stop}
                  disabled={!busy}
                  aria-label={t("stopTest")}
                  title={t("stopTest")}
                >
                  <Square size={15} fill="currentColor" aria-hidden="true" />
                </button>
              </div>
            </div>
          </form>
        </GlassPanel>
        </ConnectionShell>

        {!compactLayout && (
          <div
            className="layout-resizer"
            role="separator"
            tabIndex={0}
            aria-label={t("resizePanels")}
            aria-orientation="vertical"
            aria-valuemin={Math.round(MIN_LAYOUT_SPLIT * 100)}
            aria-valuemax={Math.round(MAX_LAYOUT_SPLIT * 100)}
            aria-valuenow={Math.round(layoutSplit * 100)}
            title={t("resizePanelsHelp")}
            onDoubleClick={() => setLayoutSplit(DEFAULT_LAYOUT_SPLIT)}
            onPointerDown={startLayoutResize}
            onPointerMove={moveLayoutResize}
            onPointerUp={stopLayoutResize}
            onPointerCancel={stopLayoutResize}
            onKeyDown={(event) => {
              if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
              event.preventDefault();
              const direction = event.key === "ArrowLeft" ? -1 : 1;
              setLayoutSplit((current) =>
                Math.min(MAX_LAYOUT_SPLIT, Math.max(MIN_LAYOUT_SPLIT, current + direction * 0.02))
              );
            }}
          >
            <GripVertical size={15} aria-hidden="true" />
          </div>
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
