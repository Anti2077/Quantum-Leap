import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import * as AlertDialog from "@radix-ui/react-alert-dialog";
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
import Copy from "lucide-react/dist/esm/icons/copy.js";
import FileKey2 from "lucide-react/dist/esm/icons/file-key-2.js";
import Gauge from "lucide-react/dist/esm/icons/gauge.js";
import GripVertical from "lucide-react/dist/esm/icons/grip-vertical.js";
import KeyRound from "lucide-react/dist/esm/icons/key-round.js";
import Layers3 from "lucide-react/dist/esm/icons/layers-3.js";
import Network from "lucide-react/dist/esm/icons/network.js";
import PackageSearch from "lucide-react/dist/esm/icons/package-search.js";
import Play from "lucide-react/dist/esm/icons/play.js";
import Plus from "lucide-react/dist/esm/icons/plus.js";
import Radio from "lucide-react/dist/esm/icons/radio.js";
import Server from "lucide-react/dist/esm/icons/server.js";
import Settings2 from "lucide-react/dist/esm/icons/settings-2.js";
import ShieldAlert from "lucide-react/dist/esm/icons/shield-alert.js";
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
  formatBandwidth,
  formatBandwidthParts,
  formatBytes,
  formatLatency,
  type BandwidthUnit
} from "../lib/format";
import { useI18n, type TranslationKey } from "../lib/i18n";
import type {
  SavedServer,
  SpeedPromptEvent,
  SpeedSample,
  SpeedStateEvent,
  SpeedTestRequest,
  ServerMode,
  SshAuthMethod,
  TestMode,
  TestTopology,
  TransferDirection,
  TransportProtocol
} from "../lib/types";
import { EnergyLink } from "./EnergyLink";
import { ComparisonChart } from "./ComparisonChart";
import { DataStreamField } from "./DataStreamField";
import { FluidAreaChart } from "./FluidAreaChart";
import { GlassPanel } from "./GlassPanel";
import { MacGlyph } from "./MacGlyph";
import { NumberTicker } from "./NumberTicker";
import { AppSettings } from "./AppSettings";

interface ConnectionForm {
  testTopology: TestTopology;
  host: string;
  sshPort: string;
  iperfPort: string;
  remoteIperfPath: string;
  localBindIp: string;
  serverBindIp: string;
  serverMode: ServerMode;
  username: string;
  password: string;
  authMethod: SshAuthMethod;
  privateKeyPath: string;
  passphrase: string;
  testMode: TestMode;
  direction: TransferDirection;
  protocol: TransportProtocol;
  parallelStreams: string;
  durationSeconds: string;
}

interface RemoteClientForm {
  host: string;
  sshPort: string;
  remoteIperfPath: string;
  bindIp: string;
  username: string;
  password: string;
  authMethod: SshAuthMethod;
  privateKeyPath: string;
  passphrase: string;
}

interface SamplePoint {
  t: number;
  bps: number;
  bytes: number;
  retransmits: number;
  latencyMs: number | null;
  jitterMs: number | null;
  direction: TransferDirection;
}

const initialForm: ConnectionForm = {
  testTopology: "localToRemote",
  host: "",
  sshPort: "22",
  iperfPort: "5201",
  remoteIperfPath: "",
  localBindIp: "",
  serverBindIp: "",
  serverMode: "sshManaged",
  username: "",
  password: "",
  authMethod: "password",
  privateKeyPath: "~/.ssh/id_ed25519",
  passphrase: "",
  testMode: "standard",
  direction: "upload",
  protocol: "tcp",
  parallelStreams: "8",
  durationSeconds: "10"
};

const initialRemoteClientForm: RemoteClientForm = {
  host: "",
  sshPort: "22",
  remoteIperfPath: "",
  bindIp: "",
  username: "",
  password: "",
  authMethod: "password",
  privateKeyPath: "~/.ssh/id_ed25519",
  passphrase: ""
};

const terminalPhases: SpeedStateEvent["phase"][] = ["completed", "cancelled", "failed"];
const STANDARD_DURATION_SECONDS = 10;
const STANDARD_PARALLEL_STREAMS = 8;
const SAMPLE_HISTORY_LIMIT = 280;
const BANDWIDTH_UNIT_KEY = "pulse.bandwidth-unit";
const LAYOUT_SPLIT_KEY = "pulse.layout-split";
const DEFAULT_LAYOUT_SPLIT = 0.32;
const MIN_LAYOUT_SPLIT = 0.25;
const MAX_LAYOUT_SPLIT = 0.5;
const LAYOUT_DIVIDER_WIDTH = 20;
const COMPACT_LAYOUT_QUERY = "(max-width: 860px)";
const CONNECTION_FORM_ID = "connection-settings-form";
type DesignPreviewTheme = "air" | "frost" | "crystal";

function isValidIpLiteral(value: string): boolean {
  const address = value.trim();
  if (!address) return true;
  const ipv4 = address.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    return ipv4
      .slice(1)
      .every((octet) => (octet === "0" || !octet.startsWith("0")) && Number(octet) <= 255);
  }
  if (!address.includes(":") || address.includes("%") || /[\s/]/.test(address)) return false;
  try {
    return new URL(`http://[${address}]/`).hostname.length > 0;
  } catch {
    return false;
  }
}

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

function summarize(samples: SamplePoint[], direction?: TransferDirection) {
  const selected = direction ? samples.filter((sample) => sample.direction === direction) : samples;
  const latency = selected.map((sample) => sample.latencyMs).filter((value): value is number => value != null);
  const jitter = selected.map((sample) => sample.jitterMs).filter((value): value is number => value != null);
  return {
    average: selected.length
      ? selected.reduce((total, sample) => total + sample.bps, 0) / selected.length
      : 0,
    peak: Math.max(...selected.map((sample) => sample.bps), 0),
    bytes: selected.reduce((total, sample) => total + sample.bytes, 0),
    retransmits: selected.reduce((total, sample) => total + sample.retransmits, 0),
    latency: latency.length ? latency.reduce((total, value) => total + value, 0) / latency.length : null,
    jitter: jitter.length ? jitter.reduce((total, value) => total + value, 0) / jitter.length : null
  };
}

function downloadRating(bitsPerSecond: number) {
  const mbps = bitsPerSecond / 1e6;
  if (mbps > 2500) return { key: "legend", labelKey: "ratingLegend" as const };
  if (mbps >= 2000) return { key: "prime", labelKey: "ratingPrime" as const };
  if (mbps >= 800) return { key: "elite", labelKey: "ratingElite" as const };
  if (mbps >= 50) return { key: "npc", labelKey: "ratingNpc" as const };
  return { key: "slow", labelKey: "ratingSlow" as const };
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
          host: "edge.apple-lab.net",
          username: "root",
          password: "preview-password"
        }
      : initialForm
  );
  const [clientForm, setClientForm] = useState<RemoteClientForm>(() =>
    designPreviewTheme
      ? {
          ...initialRemoteClientForm,
          host: "192.168.10.4",
          username: "anti",
          password: "preview-password",
          remoteIperfPath: "/opt/bin/iperf3"
        }
      : initialRemoteClientForm
  );
  const [clientSavedId, setClientSavedId] = useState("");
  const [serverSavedId, setServerSavedId] = useState("");
  const [endpointEditor, setEndpointEditor] = useState<"client" | "server" | null>(null);
  const [clientAdvancedOpen, setClientAdvancedOpen] = useState(false);
  const [serverAdvancedOpen, setServerAdvancedOpen] = useState(false);
  const [samples, setSamples] = useState<SamplePoint[]>(() =>
    designPreviewTheme ? designPreviewSamples() : []
  );
  const [latest, setLatest] = useState<SpeedSample | null>(null);
  const [prompt, setPrompt] = useState<SpeedPromptEvent | null>(() =>
    promptPreview === "existingServer"
      ? {
          kind: "existingServer",
          title: t("promptExistingTitle"),
          message: t("promptExistingMessage"),
          detail: "aliserver.anti2077.xyz:5201"
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
                detail: t("serverAddressDetail", { host: "192.168.11.128", port: 5201 })
              }
          : null
  );
  const [savedServers, setSavedServers] = useState<SavedServer[]>(() =>
    designPreviewTheme
      ? [
          { id: "preview-1", note: t("previewCloud"), host: "aliserver.anti2027.cn", sshPort: 22, iperfPort: 5201, remoteIperfPath: "", bindIp: "", serverMode: "sshManaged", username: "root", password: "preview", authMethod: "password", privateKeyPath: "" },
          { id: "preview-2", note: t("previewRouter"), host: "192.168.11.1", sshPort: 22, iperfPort: 5201, remoteIperfPath: "", bindIp: "", serverMode: "existing", username: "", password: "", authMethod: "password", privateKeyPath: "" },
          { id: "preview-3", note: t("previewDevMachine"), host: "192.168.10.4", sshPort: 22, iperfPort: 5201, remoteIperfPath: "/opt/bin/iperf3", bindIp: "192.168.10.4", serverMode: "sshManaged", username: "anti", password: "preview", authMethod: "password", privateKeyPath: "" }
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
  const [status, setStatus] = useState<SpeedStateEvent>(() =>
    designPreviewTheme
      ? resultPreview
        ? { phase: "completed", message: t("previewComplete") }
        : { phase: "running", message: t("previewRunning") }
      : { phase: "idle", message: t("waitingForServer") }
  );
  const requestRef = useRef<SpeedTestRequest | null>(null);
  const appContentRef = useRef<HTMLElement>(null);
  const endpointEditorRef = useRef<HTMLElement>(null);
  const clientAdvancedRef = useRef<HTMLDivElement>(null);
  const serverAdvancedRef = useRef<HTMLDivElement>(null);
  const lastGoodSampleRef = useRef<Partial<Record<TransferDirection, SpeedSample>>>({});
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

  useEffect(() => {
    let mounted = true;
    const unlisteners: Array<() => void> = [];

    void listen<SpeedSample>("speed://sample", (event) => {
      if (!mounted) return;
      const sample = event.payload;
      const usableRate = Number.isFinite(sample.bandwidthBps) && sample.bandwidthBps > 0;
      if (!usableRate) {
        const held =
          lastGoodSampleRef.current[sample.direction] ??
          lastGoodSampleRef.current[sample.direction === "upload" ? "download" : "upload"];
        setLatest(held ? { ...sample, bandwidthBps: held.bandwidthBps } : sample);
        return;
      }

      lastGoodSampleRef.current[sample.direction] = sample;
      setLatest(sample);
      setSamples((current) => [
        ...current.slice(-(SAMPLE_HISTORY_LIMIT - 1)),
        {
          t: sample.elapsed,
          bps: sample.bandwidthBps,
          bytes: sample.bytes,
          retransmits: sample.retransmits ?? 0,
          latencyMs: sample.latencyMs ?? null,
          jitterMs: sample.jitterMs ?? null,
          direction: sample.direction
        }
      ]);
    })
      .then((unlisten) => {
        if (mounted) unlisteners.push(unlisten);
        else unlisten();
      })
      .catch(() => undefined);

    void listen<SpeedStateEvent>("speed://state", (event) => {
      if (mounted) setStatus(event.payload);
    })
      .then((unlisten) => {
        if (mounted) unlisteners.push(unlisten);
        else unlisten();
      })
      .catch(() => undefined);

    void listen<SpeedPromptEvent>("speed://prompt", (event) => {
      if (!mounted) return;
      setPromptDetailCopied(false);
      setPrompt(event.payload);
      setStatus({ phase: "confirming", message: event.payload.title });
    })
      .then((unlisten) => {
        if (mounted) unlisteners.push(unlisten);
        else unlisten();
      })
      .catch(() => undefined);

    return () => {
      mounted = false;
      unlisteners.forEach((dispose) => dispose());
    };
  }, []);

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
    if ((compactLayout && !connectionOpen) || (!clientAdvancedOpen && !serverAdvancedOpen)) return;
    const frame = requestAnimationFrame(() => {
      const target = clientAdvancedOpen ? clientAdvancedRef.current : serverAdvancedRef.current;
      target?.scrollIntoView({ block: "nearest" });
    });
    return () => cancelAnimationFrame(frame);
  }, [clientAdvancedOpen, compactLayout, connectionOpen, serverAdvancedOpen]);

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
  const standard = form.testMode === "standard";
  const remoteToRemote = form.testTopology === "remoteToRemote";
  const sshManaged = form.serverMode === "sshManaged";
  const completedStandard = standard && status.phase === "completed";
  const requestedDuration = form.durationSeconds.trim() === "" ? Number.NaN : Number(form.durationSeconds);
  const duration = standard
    ? STANDARD_DURATION_SECONDS
    : Number.isFinite(requestedDuration)
      ? requestedDuration
      : 10;
  const continuous = !standard && duration === 0;
  const parallelStreams = standard ? STANDARD_PARALLEL_STREAMS : Number(form.parallelStreams) || 1;
  const protocol: TransportProtocol = standard ? "tcp" : form.protocol;
  const remoteIperfPath = form.remoteIperfPath.trim();
  const remoteIperfPathInvalid = sshManaged && remoteIperfPath.length > 0 && !remoteIperfPath.startsWith("/");
  const clientRemoteIperfPath = clientForm.remoteIperfPath.trim();
  const clientRemoteIperfPathInvalid =
    remoteToRemote && clientRemoteIperfPath.length > 0 && !clientRemoteIperfPath.startsWith("/");
  const localBindIp = form.localBindIp.trim();
  const serverBindIp = form.serverBindIp.trim();
  const clientBindIp = clientForm.bindIp.trim();
  const localBindIpInvalid = !remoteToRemote && !isValidIpLiteral(localBindIp);
  const serverBindIpInvalid = sshManaged && !isValidIpLiteral(serverBindIp);
  const clientBindIpInvalid = remoteToRemote && !isValidIpLiteral(clientBindIp);
  const clientValid =
    !remoteToRemote ||
    (clientForm.host.trim().length > 0 &&
      Number(clientForm.sshPort) > 0 &&
      clientForm.username.trim().length > 0 &&
      !clientRemoteIperfPathInvalid &&
      !clientBindIpInvalid &&
      (clientForm.authMethod === "privateKey"
        ? clientForm.privateKeyPath.trim().length > 0
        : clientForm.password.length > 0));
  const activeDirection = previewDirection ?? (standard ? (latest?.direction ?? "upload") : form.direction);
  const activeSamples = useMemo(
    () => samples.filter((sample) => sample.direction === activeDirection),
    [activeDirection, samples]
  );
  const uploadStats = useMemo(() => summarize(samples, "upload"), [samples]);
  const downloadStats = useMemo(() => summarize(samples, "download"), [samples]);
  const overallStats = useMemo(() => summarize(samples), [samples]);
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
  const valid =
    form.host.trim().length > 0 &&
    Number(form.iperfPort) > 0 &&
    !remoteIperfPathInvalid &&
    !localBindIpInvalid &&
    !serverBindIpInvalid &&
    clientValid &&
    (!sshManaged || (
      form.username.trim().length > 0 &&
      (form.authMethod === "privateKey"
        ? form.privateKeyPath.trim().length > 0
        : form.password.length > 0) &&
      Number(form.sshPort) > 0
    )) &&
    (standard ||
      ((duration === 0 || (duration >= 3 && duration <= 120)) &&
        parallelStreams >= 1 &&
        parallelStreams <= 32));
  const canSaveCurrentServer =
    form.host.trim().length > 0 &&
    !remoteIperfPathInvalid &&
    !serverBindIpInvalid &&
    (!sshManaged || (
      form.username.trim().length > 0 &&
      (form.authMethod === "privateKey"
        ? form.privateKeyPath.trim().length > 0
        : form.password.length > 0)
    ));

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
      setClientForm({
        host: server.host,
        sshPort: server.sshPort.toString(),
        remoteIperfPath: server.remoteIperfPath || "",
        bindIp: server.bindIp || "",
        username: server.username,
        password,
        authMethod: server.authMethod,
        privateKeyPath: server.privateKeyPath || initialRemoteClientForm.privateKeyPath,
        passphrase: server.authMethod === "privateKey" ? password : ""
      });
      setStatus({ phase: "idle", message: t("clientSelected", { name: server.note || server.host }) });
    } catch (error) {
      setStatus({ phase: "failed", message: errorMessage(error, t("savedActionError")) });
    } finally {
      setSavedBusy(false);
    }
  };

  const swapRemoteEndpoints = () => {
    if (!remoteToRemote || !sshManaged || busy) return;
    const previousServer = {
      host: form.host,
      sshPort: form.sshPort,
      remoteIperfPath: form.remoteIperfPath,
      bindIp: form.serverBindIp,
      username: form.username,
      password: form.password,
      authMethod: form.authMethod,
      privateKeyPath: form.privateKeyPath,
      passphrase: form.passphrase
    };
    setForm((current) => ({
      ...current,
      host: clientForm.host,
      sshPort: clientForm.sshPort,
      remoteIperfPath: clientForm.remoteIperfPath,
      serverBindIp: clientForm.bindIp,
      username: clientForm.username,
      password: clientForm.password,
      authMethod: clientForm.authMethod,
      privateKeyPath: clientForm.privateKeyPath,
      passphrase: clientForm.passphrase
    }));
    setClientForm(previousServer);
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
      setForm((current) => ({
        ...current,
        host: server.host,
        sshPort: server.sshPort.toString(),
        iperfPort: server.iperfPort.toString(),
        remoteIperfPath: server.remoteIperfPath || "",
        serverBindIp: server.bindIp || "",
        serverMode: server.serverMode,
        username: server.username,
        password,
        authMethod: server.authMethod,
        privateKeyPath: server.privateKeyPath || initialForm.privateKeyPath,
        passphrase: server.authMethod === "privateKey" ? password : ""
      }));
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
    const existing = savedServers.find(
      (server) =>
        server.host === form.host.trim() &&
        server.sshPort === Number(form.sshPort) &&
        server.username === form.username.trim() &&
        server.serverMode === form.serverMode
    );
    setSavedNoteDraft(existing?.note ?? "");
    setSavedNoteEditorOpen(true);
  };

  const saveCurrentServer = async () => {
    const savedSecret = form.authMethod === "privateKey" ? form.passphrase : form.password;
    if (!canSaveCurrentServer || savedBusy) return;
    const existing = savedServers.find(
      (server) =>
        server.host === form.host.trim() &&
        server.sshPort === Number(form.sshPort) &&
        server.username === form.username.trim() &&
        server.serverMode === form.serverMode
    );
    setSavedBusy(true);
    try {
      const saved = await saveServer({
        id: existing?.id,
        note: savedNoteDraft.trim(),
        host: form.host.trim(),
        sshPort: Number(form.sshPort),
        iperfPort: Number(form.iperfPort),
        remoteIperfPath,
        bindIp: sshManaged ? serverBindIp : "",
        serverMode: form.serverMode,
        username: form.username.trim(),
        password: savedSecret,
        authMethod: form.authMethod,
        privateKeyPath: form.privateKeyPath.trim()
      }, language);
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

    const request: SpeedTestRequest = {
      language,
      host: form.host.trim(),
      sshPort: Number(form.sshPort),
      iperfPort: Number(form.iperfPort),
      remoteIperfPath,
      localBindIp: remoteToRemote ? "" : localBindIp,
      serverBindIp: sshManaged ? serverBindIp : "",
      serverMode: form.serverMode,
      username: form.username.trim(),
      password: form.password,
      authMethod: form.authMethod,
      privateKeyPath: form.privateKeyPath.trim(),
      passphrase: form.passphrase,
      testMode: form.testMode,
      direction: form.direction,
      protocol,
      parallelStreams,
      durationSeconds: duration,
      reuseExistingServer: false,
      allowHostKeyMismatch: false,
      testTopology: form.testTopology,
      remoteClient: remoteToRemote
        ? {
            host: clientForm.host.trim(),
            sshPort: Number(clientForm.sshPort),
            remoteIperfPath: clientRemoteIperfPath,
            bindIp: clientBindIp,
            username: clientForm.username.trim(),
            password: clientForm.password,
            authMethod: clientForm.authMethod,
            privateKeyPath: clientForm.privateKeyPath.trim(),
            passphrase: clientForm.passphrase,
            allowHostKeyMismatch: false
          }
        : null
    };

    setSamples([]);
    setLatest(null);
    lastGoodSampleRef.current = {};
    setPrompt(null);
    setConnectionOpen(false);
    await launch(request);
  };

  const confirmPrompt = async () => {
    const request = requestRef.current;
    if (!request || !prompt) return;
    const nextRequest = {
      ...request,
      reuseExistingServer: request.reuseExistingServer || prompt.kind === "existingServer",
      allowHostKeyMismatch: request.allowHostKeyMismatch || prompt.kind === "hostKeyMismatch",
      remoteClient:
        request.remoteClient && prompt.kind === "clientHostKeyMismatch"
          ? { ...request.remoteClient, allowHostKeyMismatch: true }
          : request.remoteClient
    };
    setPrompt(null);
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
    setPrompt(null);
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
                        {clientAdvancedOpen && (
                          <div ref={clientAdvancedRef} className="advanced-disclosure-fields">
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
                        )}
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
                    {serverAdvancedOpen && (
                      <div ref={serverAdvancedRef} className="advanced-disclosure-fields">
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
                    )}
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
                      {serverAdvancedOpen && (
                        <div ref={serverAdvancedRef} className="advanced-disclosure-fields">
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
                      )}
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

              <AnimatePresence mode="wait" initial={false}>
                {standard ? (
                  <motion.div
                    key="standard"
                    className="standard-profile"
                    initial={{ opacity: 0, y: 5 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -5 }}
                  >
                    <span><Network size={13} />TCP</span>
                    <span><Layers3 size={13} />{t("streams", { count: STANDARD_PARALLEL_STREAMS })}</span>
                    <span><Waves size={13} />{t("bidirectionalDuration", { seconds: STANDARD_DURATION_SECONDS })}</span>
                  </motion.div>
                ) : (
                  <motion.div
                    key="advanced"
                    className="advanced-settings"
                    initial={{ opacity: 0, y: 5 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -5 }}
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
                  </motion.div>
                )}
              </AnimatePresence>

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

        <section className="speed-column">
          <GlassPanel
            className={`speed-stage direction-${activeDirection} ${running ? "is-running" : ""} ${completedStandard ? "is-complete" : ""}`}
          >
            <div className="stage-heading">
              <div>
                <span className="eyebrow">
                  {standard
                    ? t("standardProfile", { count: STANDARD_PARALLEL_STREAMS })
                    : t("advancedProfile", { protocol: protocol.toUpperCase(), count: parallelStreams })}
                </span>
                <h2>
                  {completedStandard
                    ? t("combinedResults")
                    : activeDirection === "upload"
                      ? t("uploadSpeed")
                      : t("downloadSpeed")}
                </h2>
              </div>
              <div className="stage-heading-controls">
                <div className="bandwidth-unit-switch" aria-label={t("bandwidthUnit")}>
                  {(["Mbps", "Gbps"] as const).map((unit) => (
                    <button
                      type="button"
                      key={unit}
                      className={bandwidthUnit === unit ? "selected" : ""}
                      onClick={() => setBandwidthUnit(unit)}
                      aria-pressed={bandwidthUnit === unit}
                    >
                      {unit}
                    </button>
                  ))}
                </div>
                <div className={`live-indicator ${running ? "active" : ""}`}>
                  <span />
                  {running ? (continuous ? t("live") : `${Math.round(progress)}%`) : completedStandard ? t("result") : t("standby")}
                </div>
              </div>
            </div>

            <div className="network-stage">
              <MacGlyph
                active={running || status.phase === "stopping"}
                label={remoteToRemote ? clientForm.host.trim() || t("deviceA") : t("thisMac")}
                subtitle={remoteToRemote ? t("remoteClient") : t("localClient")}
              />
              <EnergyLink
                direction={activeDirection}
                active={running}
                engaged={busy}
                intensity={motionIntensity}
              />
              <DataStreamField
                active={running || status.phase === "stopping"}
                direction={activeDirection}
                intensity={motionIntensity}
              />
              <div className="remote-node">
                <div className="remote-header">
                  <div className="server-identity">
                    <span className="server-icon"><Server size={16} aria-hidden="true" /></span>
                    <div>
                      <strong>{form.host.trim() || t("notConnected")}</strong>
                      <span>Port {form.iperfPort}</span>
                    </div>
                  </div>
                  {completedStandard ? (
                    <motion.span
                      className={`speed-rating rating-${rating.key}`}
                      initial={{ opacity: 0, scale: 0.86 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ type: "spring", stiffness: 260, damping: 20 }}
                    >
                      {t("downloadRating")} · <strong>{t(rating.labelKey)}</strong>
                    </motion.span>
                  ) : (
                    <span className="sample-count">{t("sampleCount", { count: samples.length })}</span>
                  )}
                </div>
                <NumberTicker value={rate.value} suffix={rate.unit} />
                {completedStandard ? (
                  <ComparisonChart
                    upload={samples.filter((sample) => sample.direction === "upload")}
                    download={samples.filter((sample) => sample.direction === "download")}
                    unit={bandwidthUnit}
                  />
                ) : (
                  <FluidAreaChart data={activeSamples} direction={activeDirection} unit={bandwidthUnit} />
                )}
                <div className={`test-progress ${continuous && running ? "is-continuous" : ""}`} aria-hidden="true">
                  <motion.span animate={{ width: `${progress}%` }} transition={{ duration: 0.52, ease: "linear" }} />
                </div>
              </div>
            </div>
          </GlassPanel>

          <div className="metrics-strip">
            {standard ? (
              <>
                <div className="metric-cell accent-upload">
                  <span>{t("uploadAverage")}</span>
                  <strong>{formatBandwidth(uploadStats.average, bandwidthUnit)}</strong>
                </div>
                <div className="metric-cell accent-download">
                  <span>{t("downloadAverage")}</span>
                  <strong>{formatBandwidth(downloadStats.average, bandwidthUnit)}</strong>
                </div>
                <div className="metric-cell">
                  <span>{t("loadedLatency")}</span>
                  <strong>{formatLatency(overallStats.latency)}</strong>
                </div>
                <div className={`metric-cell ${retransmitWarning ? "quality-warning" : ""}`}>
                  <span className="metric-label-with-icon">
                    {retransmitWarning && <ShieldAlert size={12} aria-hidden="true" />}
                    {t("tcpRetransmits")}
                  </span>
                  <strong>{formatNumber(overallStats.retransmits)}</strong>
                </div>
                <div className="metric-cell">
                  <span>{t("totalTransfer")}</span>
                  <strong>{formatBytes(totalBytes)}</strong>
                </div>
              </>
            ) : (
              <>
                <div className="metric-cell">
                  <span>{t("averageSpeed")}</span>
                  <strong>{formatBandwidth(activeStats.average, bandwidthUnit)}</strong>
                </div>
                <div className="metric-cell">
                  <span>{t("peak")}</span>
                  <strong>{formatBandwidth(activeStats.peak, bandwidthUnit)}</strong>
                </div>
                <div className="metric-cell">
                  <span>{t("loadedLatency")}</span>
                  <strong>{formatLatency(activeStats.latency)}</strong>
                </div>
                <div className="metric-cell">
                  <span>{protocol === "udp" ? t("udpJitter") : t("rttVariation")}</span>
                  <strong>{formatLatency(activeStats.jitter)}</strong>
                </div>
                <div className={`metric-cell ${retransmitWarning ? "quality-warning" : ""}`}>
                  <span>{protocol === "tcp" ? t("transferRetransmits") : t("transferred")}</span>
                  <strong>
                    {protocol === "tcp"
                      ? `${formatBytes(activeStats.bytes)} / ${activeStats.retransmits}`
                      : formatBytes(activeStats.bytes)}
                  </strong>
                </div>
              </>
            )}
          </div>

          <div
            className={`status-line phase-${status.phase} ${retransmitWarning ? "has-network-warning" : ""}`}
            role="status"
            aria-live="polite"
            title={displayedStatusMessage}
          >
            <span className="status-pulse" />
            <AnimatePresence mode="wait" initial={false}>
              <motion.p
                key={`${status.phase}-${displayedStatusMessage}`}
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -5 }}
                transition={{ duration: 0.2 }}
              >
                {displayedStatusMessage}
              </motion.p>
            </AnimatePresence>
            <span>
              {terminalPhases.includes(status.phase) || status.phase === "idle" || status.phase === "confirming"
                ? t(phaseLabelKeys[status.phase])
                : continuous
                  ? t("live")
                  : `${Math.round(progress)}%`}
            </span>
          </div>
        </section>
      </main>

      <AlertDialog.Root open={prompt != null}>
        {prompt && (
          <AlertDialog.Portal>
            <AlertDialog.Overlay className="confirm-backdrop" />
            <AlertDialog.Content className={`confirm-dialog prompt-${prompt.kind}`}>
              <div className="confirm-icon">
                {prompt.kind === "hostKeyMismatch" || prompt.kind === "clientHostKeyMismatch" ? (
                  <ShieldAlert size={21} />
                ) : prompt.kind === "iperf3Missing" || prompt.kind === "clientIperf3Missing" ? (
                  <PackageSearch size={21} />
                ) : prompt.kind === "serverUnavailable" ? (
                  <CircleAlert size={21} />
                ) : (
                  <Server size={21} />
                )}
              </div>
              <AlertDialog.Title asChild>
                <h3>{prompt.title}</h3>
              </AlertDialog.Title>
              <AlertDialog.Description>{prompt.message}</AlertDialog.Description>
              {prompt.detail && <code>{prompt.detail}</code>}
              <div className="confirm-actions">
                {prompt.kind !== "serverUnavailable" && (
                  <AlertDialog.Cancel asChild>
                    <button type="button" onClick={rejectPrompt}>
                      {prompt.kind === "iperf3Missing" || prompt.kind === "clientIperf3Missing"
                        ? t("later")
                        : t("cancel")}
                    </button>
                  </AlertDialog.Cancel>
                )}
                {(prompt.kind === "iperf3Missing" || prompt.kind === "clientIperf3Missing") && prompt.detail && (
                  <button type="button" onClick={copyPromptDetail}>
                    {promptDetailCopied ? <Check size={13} /> : <Copy size={13} />}
                    {promptDetailCopied ? t("copied") : t("copyCommand")}
                  </button>
                )}
                {prompt.kind === "serverUnavailable" ? (
                  <AlertDialog.Cancel asChild>
                    <button type="button" className="confirm-primary" onClick={rejectPrompt} autoFocus>
                      {t("close")}
                    </button>
                  </AlertDialog.Cancel>
                ) : (
                  <AlertDialog.Action asChild>
                    <button type="button" className="confirm-primary" onClick={confirmPrompt} autoFocus>
                      {prompt.kind === "hostKeyMismatch" || prompt.kind === "clientHostKeyMismatch"
                        ? t("trustContinue")
                        : prompt.kind === "iperf3Missing" || prompt.kind === "clientIperf3Missing"
                          ? t("installedRetry")
                          : t("reuseContinue")}
                    </button>
                  </AlertDialog.Action>
                )}
              </div>
            </AlertDialog.Content>
          </AlertDialog.Portal>
        )}
      </AlertDialog.Root>
    </div>
  );
}
