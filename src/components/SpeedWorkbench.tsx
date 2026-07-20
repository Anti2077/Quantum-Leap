import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { AnimatePresence, motion } from "framer-motion";
import Activity from "lucide-react/dist/esm/icons/activity.js";
import ArrowDownToLine from "lucide-react/dist/esm/icons/arrow-down-to-line.js";
import ArrowUpFromLine from "lucide-react/dist/esm/icons/arrow-up-from-line.js";
import CircleAlert from "lucide-react/dist/esm/icons/circle-alert.js";
import BookMarked from "lucide-react/dist/esm/icons/book-marked.js";
import Clock3 from "lucide-react/dist/esm/icons/clock-3.js";
import Check from "lucide-react/dist/esm/icons/check.js";
import Copy from "lucide-react/dist/esm/icons/copy.js";
import FileKey2 from "lucide-react/dist/esm/icons/file-key-2.js";
import Gauge from "lucide-react/dist/esm/icons/gauge.js";
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
  type FormEvent,
  type MouseEvent as ReactMouseEvent,
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
import type {
  SavedServer,
  SpeedPromptEvent,
  SpeedSample,
  SpeedStateEvent,
  SpeedTestRequest,
  ServerMode,
  SshAuthMethod,
  TestMode,
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

interface ConnectionForm {
  host: string;
  sshPort: string;
  iperfPort: string;
  remoteIperfPath: string;
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
  host: "",
  sshPort: "22",
  iperfPort: "5201",
  remoteIperfPath: "",
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

const terminalPhases: SpeedStateEvent["phase"][] = ["completed", "cancelled", "failed"];
const STANDARD_DURATION_SECONDS = 10;
const STANDARD_PARALLEL_STREAMS = 8;
const SAMPLE_HISTORY_LIMIT = 280;
const BANDWIDTH_UNIT_KEY = "pulse.bandwidth-unit";
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

const phaseLabels: Record<SpeedStateEvent["phase"], string> = {
  idle: "Ready",
  starting: "Connecting",
  confirming: "Confirm",
  running: "Testing",
  stopping: "Stopping",
  completed: "Complete",
  cancelled: "Stopped",
  failed: "Error"
};

function FieldLabel({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <span className="field-label">
      {icon}
      {children}
    </span>
  );
}

function errorMessage(error: unknown) {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  return "无法启动测速，请检查连接参数";
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
  if (mbps > 2500) return { key: "legend", label: "你牛大了" };
  if (mbps >= 2000) return { key: "prime", label: "夯" };
  if (mbps >= 800) return { key: "elite", label: "人上人" };
  if (mbps >= 50) return { key: "npc", label: "NPC" };
  return { key: "slow", label: "拉完了" };
}

export function SpeedWorkbench() {
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
  const [samples, setSamples] = useState<SamplePoint[]>(() =>
    designPreviewTheme ? designPreviewSamples() : []
  );
  const [latest, setLatest] = useState<SpeedSample | null>(null);
  const [prompt, setPrompt] = useState<SpeedPromptEvent | null>(() =>
    promptPreview === "existingServer"
      ? {
          kind: "existingServer",
          title: "检测到已有测速服务",
          message: "目标端口已有服务监听。继续将直接复用它，完成后不会终止该服务。",
          detail: "aliserver.anti2077.xyz:5201"
        }
      : promptPreview === "hostKeyMismatch"
        ? {
            kind: "hostKeyMismatch",
            title: "服务器身份已变化",
            message: "当前 SSH 主机密钥与已知记录不一致，请确认服务器身份后再继续。",
            detail: "SHA256:preview-host-key-fingerprint"
          }
        : promptPreview === "iperf3Missing"
          ? {
              kind: "iperf3Missing",
              title: "远端未安装 iperf3",
              message: "已检测到 APT。请登录服务器执行下面的命令，安装完成后重新检测。",
              detail: "sudo apt-get update && sudo apt-get install -y iperf3"
            }
          : promptPreview === "serverUnavailable"
            ? {
                kind: "serverUnavailable",
                title: "测速服务不可用",
                message: "未检测到服务运行，请排查地址和端口。",
                detail: "服务器地址：192.168.11.128\n测速端口：5201"
              }
          : null
  );
  const [savedServers, setSavedServers] = useState<SavedServer[]>(() =>
    designPreviewTheme
      ? [
          { id: "preview-1", note: "阿里云 · 上海", host: "aliserver.anti2027.cn", sshPort: 22, iperfPort: 5201, remoteIperfPath: "", serverMode: "sshManaged", username: "root", password: "preview", authMethod: "password", privateKeyPath: "" },
          { id: "preview-2", note: "家里软路由", host: "192.168.11.1", sshPort: 22, iperfPort: 5201, remoteIperfPath: "", serverMode: "existing", username: "", password: "", authMethod: "password", privateKeyPath: "" },
          { id: "preview-3", note: "开发机", host: "192.168.10.4", sshPort: 22, iperfPort: 5201, remoteIperfPath: "/opt/bin/iperf3", serverMode: "sshManaged", username: "anti", password: "preview", authMethod: "password", privateKeyPath: "" }
        ]
      : []
  );
  const [savedMenuOpen, setSavedMenuOpen] = useState(false);
  const [savedNoteEditorOpen, setSavedNoteEditorOpen] = useState(false);
  const [savedNoteDraft, setSavedNoteDraft] = useState("");
  const [savedBusy, setSavedBusy] = useState(false);
  const [promptDetailCopied, setPromptDetailCopied] = useState(false);
  const [bandwidthUnit, setBandwidthUnit] = useState<BandwidthUnit>(savedBandwidthUnit);
  const [status, setStatus] = useState<SpeedStateEvent>(() =>
    designPreviewTheme
      ? resultPreview
        ? { phase: "completed", message: "测速完成，远端服务器已关闭" }
        : { phase: "running", message: "雪白玻璃主题预览" }
      : { phase: "idle", message: "等待连接服务器" }
  );
  const requestRef = useRef<SpeedTestRequest | null>(null);
  const savedControlRef = useRef<HTMLDivElement>(null);
  const lastGoodSampleRef = useRef<Partial<Record<TransferDirection, SpeedSample>>>({});

  const startWindowDrag = (event: ReactMouseEvent<HTMLElement>) => {
    if (event.button !== 0 || (event.target as Element).closest("button, input, select, textarea, a")) return;
    event.preventDefault();
    void getCurrentWindow().startDragging().catch(() => undefined);
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
    void listSavedServers()
      .then(setSavedServers)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(BANDWIDTH_UNIT_KEY, bandwidthUnit);
    } catch {
      // The selected unit still applies for this session when storage is unavailable.
    }
  }, [bandwidthUnit]);

  useEffect(() => {
    if (savedMenuOpen) return;
    setSavedNoteEditorOpen(false);
    setSavedNoteDraft("");
  }, [savedMenuOpen]);

  useEffect(() => {
    if (!savedMenuOpen && !prompt) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (savedMenuOpen && !savedControlRef.current?.contains(event.target as Node)) {
        setSavedMenuOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (prompt) {
        setPrompt(null);
        requestRef.current = null;
        setStatus({
          phase: prompt.kind === "serverUnavailable" ? "failed" : "cancelled",
          message:
            prompt.kind === "serverUnavailable"
              ? prompt.message
              : prompt.kind === "iperf3Missing"
                ? "测速未开始：远端缺少 iperf3"
                : "已取消本次连接"
        });
      } else {
        setSavedMenuOpen(false);
      }
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [prompt, savedMenuOpen]);

  const busy = previewDirection != null || ["starting", "running", "stopping"].includes(status.phase);
  const running = previewDirection != null || status.phase === "running";
  const standard = form.testMode === "standard";
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
    ? `检测到 ${displayedRetransmits.toLocaleString("zh-CN")} 次 TCP 重传，建议检查 USB 网卡、线材或交换端口`
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
    (!sshManaged || (
      form.username.trim().length > 0 &&
      (form.authMethod === "privateKey"
        ? form.privateKeyPath.trim().length > 0
        : form.password.length > 0)
    ));

  const update = <K extends keyof ConnectionForm>(key: K, value: ConnectionForm[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const selectSavedServer = async (server: SavedServer) => {
    if (savedBusy) return;
    setSavedBusy(true);
    try {
      const password = server.serverMode === "sshManaged"
        ? server.password || (await getSavedServerPassword(server.id))
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
        serverMode: server.serverMode,
        username: server.username,
        password,
        authMethod: server.authMethod,
        privateKeyPath: server.privateKeyPath || initialForm.privateKeyPath,
        passphrase: server.authMethod === "privateKey" ? password : ""
      }));
      setSavedMenuOpen(false);
      setStatus({ phase: "idle", message: `已载入 ${server.host}` });
    } catch (error) {
      setStatus({ phase: "failed", message: errorMessage(error) });
    } finally {
      setSavedBusy(false);
    }
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
        serverMode: form.serverMode,
        username: form.username.trim(),
        password: savedSecret,
        authMethod: form.authMethod,
        privateKeyPath: form.privateKeyPath.trim()
      });
      setSavedServers((current) => [saved, ...current.filter((server) => server.id !== saved.id)]);
      setSavedNoteEditorOpen(false);
      setSavedNoteDraft("");
      setStatus({ phase: "idle", message: `已保存 ${saved.note || saved.host} 到常用服务器` });
    } catch (error) {
      setStatus({ phase: "failed", message: errorMessage(error) });
    } finally {
      setSavedBusy(false);
    }
  };

  const removeSavedServer = async (id: string) => {
    if (savedBusy) return;
    setSavedBusy(true);
    try {
      await deleteSavedServer(id);
      setSavedServers((current) => current.filter((server) => server.id !== id));
    } catch (error) {
      setStatus({ phase: "failed", message: errorMessage(error) });
    } finally {
      setSavedBusy(false);
    }
  };

  const launch = async (request: SpeedTestRequest) => {
    requestRef.current = request;
    setStatus({
      phase: "starting",
      message: request.serverMode === "sshManaged" ? "正在建立 SSH 安全通道" : "正在连接已有测速服务"
    });
    try {
      await startSpeedTest(request);
    } catch (error) {
      setStatus({ phase: "failed", message: errorMessage(error) });
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!valid || busy) return;

    const request: SpeedTestRequest = {
      host: form.host.trim(),
      sshPort: Number(form.sshPort),
      iperfPort: Number(form.iperfPort),
      remoteIperfPath,
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
      allowHostKeyMismatch: false
    };

    setSamples([]);
    setLatest(null);
    lastGoodSampleRef.current = {};
    setPrompt(null);
    await launch(request);
  };

  const confirmPrompt = async () => {
    const request = requestRef.current;
    if (!request || !prompt) return;
    const nextRequest = {
      ...request,
      reuseExistingServer: request.reuseExistingServer || prompt.kind === "existingServer",
      allowHostKeyMismatch: request.allowHostKeyMismatch || prompt.kind === "hostKeyMismatch"
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
      setStatus({ phase: "failed", message: "复制失败，请手动选择安装命令" });
    }
  };

  const rejectPrompt = () => {
    const missingIperf3 = prompt?.kind === "iperf3Missing";
    const serverUnavailable = prompt?.kind === "serverUnavailable";
    setPrompt(null);
    requestRef.current = null;
    setStatus({
      phase: serverUnavailable ? "failed" : "cancelled",
      message: serverUnavailable
        ? prompt?.message ?? "测速服务不可用"
        : missingIperf3
          ? "测速未开始：远端缺少 iperf3"
          : "已取消本次连接"
    });
  };

  const stop = async () => {
    if (!busy) return;
    try {
      await stopSpeedTest();
    } catch (error) {
      setStatus({ phase: "failed", message: errorMessage(error) });
    }
  };

  return (
    <div className="app-frame">
      <div className="ambient-plane ambient-plane-top" />
      <div className="ambient-plane ambient-plane-bottom" />

      <header className="titlebar" data-tauri-drag-region onMouseDown={startWindowDrag}>
        <div className="brand-mark" data-tauri-drag-region>
          <Activity size={15} aria-hidden="true" />
          <span>Quantum Leap</span>
          <small>跃迁</small>
        </div>
        <div className={`titlebar-state phase-${status.phase}`} data-tauri-drag-region>
          <span />
          {phaseLabels[status.phase]}
        </div>
      </header>

      <main className="app-content">
        <aside className="connection-column">
          <GlassPanel className="connection-panel">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">{sshManaged ? "SSH endpoint" : "IPERF3 endpoint"}</span>
                <h1>连接服务器</h1>
              </div>
              <div className="saved-server-control" ref={savedControlRef}>
                <button
                  type="button"
                  className={savedMenuOpen ? "saved-server-trigger active" : "saved-server-trigger"}
                  onClick={() => setSavedMenuOpen((open) => !open)}
                  disabled={busy}
                  title="常用服务器"
                >
                  <BookMarked size={15} aria-hidden="true" />
                  常用
                </button>
                <AnimatePresence>
                  {savedMenuOpen && (
                    <motion.div
                      className="saved-server-menu"
                      initial={{ opacity: 0, y: -6, scale: 0.98 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: -5, scale: 0.98 }}
                    >
                      <div className="saved-menu-heading">
                        <strong>常用服务器</strong>
                        <button
                          type="button"
                          onClick={openSavedNoteEditor}
                          disabled={!canSaveCurrentServer || savedBusy}
                          aria-label="添加当前服务器"
                          title="添加当前服务器"
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
                                placeholder="备注（可选）"
                                aria-label="服务器备注"
                              />
                              <button
                                type="submit"
                                disabled={savedBusy}
                                aria-label="确认保存"
                                title="确认保存"
                              >
                                <Check size={14} />
                              </button>
                              <button
                                type="button"
                                onClick={() => setSavedNoteEditorOpen(false)}
                                aria-label="取消"
                                title="取消"
                              >
                                <X size={14} />
                              </button>
                            </div>
                          </motion.form>
                        )}
                      </AnimatePresence>
                      <div className="saved-server-list">
                        {savedServers.length === 0 ? (
                          <span className="saved-empty">暂无常用服务器</span>
                        ) : (
                          savedServers.map((server) => (
                            <div className="saved-server-item" key={server.id}>
                              <button type="button" onClick={() => selectSavedServer(server)}>
                                <span className="saved-server-name">{server.note || server.host}</span>
                                {server.note && <small className="saved-server-address">{server.host}</small>}
                                <small className="saved-server-meta">
                                  {server.serverMode === "sshManaged"
                                    ? `${server.username} · SSH ${server.sshPort}`
                                    : `直连 · 端口 ${server.iperfPort}`}
                                </small>
                              </button>
                              <button
                                type="button"
                                className="delete-saved"
                                onClick={() => removeSavedServer(server.id)}
                                aria-label={`删除 ${server.host}`}
                                title="删除"
                              >
                                <Trash2 size={13} />
                              </button>
                            </div>
                          ))
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>

              <form onSubmit={submit} className="connection-form">
                <div className="connection-scroll-region">
                <div className="server-mode-picker">
                  <div className="server-mode-label">
                    <FieldLabel icon={<Server size={13} />}>服务模式</FieldLabel>
                    <span className="mode-help" tabIndex={0} aria-label="服务模式说明">
                      <Info size={14} aria-hidden="true" />
                      <span className="mode-tooltip" role="tooltip">
                        <strong>SSH 自动管理</strong>
                        <span>连接服务器，启动 iperf3 -s，测试完成后自动关闭本次服务。</span>
                        <strong>直连已有服务</strong>
                        <span>适用于 Docker、权限受限或 systemctl 持久化运行的服务，只需填写测速端口。</span>
                      </span>
                    </span>
                  </div>
                  <div className="test-mode-tabs server-mode-tabs" aria-label="服务模式">
                    <button
                      type="button"
                      className={sshManaged ? "selected" : ""}
                      disabled={busy}
                      onClick={() => update("serverMode", "sshManaged")}
                    >
                      SSH 自动管理
                    </button>
                    <button
                      type="button"
                      className={!sshManaged ? "selected" : ""}
                      disabled={busy}
                      onClick={() => update("serverMode", "existing")}
                    >
                      直连已有服务
                    </button>
                  </div>
                </div>

              <label>
                <FieldLabel icon={<Radio size={13} />}>服务器地址</FieldLabel>
                <input
                  autoFocus
                  className="glass-input"
                  value={form.host}
                  disabled={busy}
                  onChange={(event) => update("host", event.target.value)}
                  placeholder="192.168.1.20"
                  spellCheck={false}
                  autoComplete="off"
                />
              </label>

              {sshManaged ? (
                <>
                  <div className="field-grid">
                    <label>
                      <FieldLabel icon={<Server size={13} />}>SSH 端口</FieldLabel>
                      <input
                        className="glass-input"
                        type="number"
                        min="1"
                        max="65535"
                        value={form.sshPort}
                        disabled={busy}
                        onChange={(event) => update("sshPort", event.target.value)}
                      />
                    </label>
                    <label>
                      <FieldLabel icon={<Activity size={13} />}>测速端口</FieldLabel>
                      <input
                        className="glass-input"
                        type="number"
                        min="1"
                        max="65535"
                        value={form.iperfPort}
                        disabled={busy}
                        onChange={(event) => update("iperfPort", event.target.value)}
                      />
                    </label>
                  </div>
                  <label>
                    <FieldLabel icon={<UserRound size={13} />}>用户名</FieldLabel>
                    <input
                      className="glass-input"
                      value={form.username}
                      disabled={busy}
                      onChange={(event) => update("username", event.target.value)}
                      placeholder="ubuntu"
                      autoComplete="username"
                    />
                  </label>
                  <div className="test-mode-tabs auth-method-tabs" aria-label="SSH 认证方式">
                    <button
                      type="button"
                      className={form.authMethod === "password" ? "selected" : ""}
                      disabled={busy}
                      onClick={() => update("authMethod", "password")}
                    >
                      <KeyRound size={14} aria-hidden="true" />
                      密码登录
                    </button>
                    <button
                      type="button"
                      className={form.authMethod === "privateKey" ? "selected" : ""}
                      disabled={busy}
                      onClick={() => update("authMethod", "privateKey")}
                    >
                      <FileKey2 size={14} aria-hidden="true" />
                      SSH 密钥
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
                          <FieldLabel icon={<FileKey2 size={13} />}>SSH 私钥路径</FieldLabel>
                          <input
                            className="glass-input"
                            value={form.privateKeyPath}
                            disabled={busy}
                            onChange={(event) => update("privateKeyPath", event.target.value)}
                            placeholder="~/.ssh/id_ed25519"
                            spellCheck={false}
                            autoComplete="off"
                          />
                        </label>
                        <label>
                          <FieldLabel icon={<KeyRound size={13} />}>私钥口令（可选）</FieldLabel>
                          <input
                            className="glass-input"
                            type="password"
                            value={form.passphrase}
                            disabled={busy}
                            onChange={(event) => update("passphrase", event.target.value)}
                            placeholder="未加密私钥可留空"
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
                        <FieldLabel icon={<KeyRound size={13} />}>SSH 密码</FieldLabel>
                        <input
                          className="glass-input"
                          type="password"
                          value={form.password}
                          disabled={busy}
                          onChange={(event) => update("password", event.target.value)}
                          placeholder="输入密码"
                          autoComplete="current-password"
                        />
                      </motion.label>
                    )}
                  </AnimatePresence>
                  <label className="remote-iperf-path-field">
                    <FieldLabel icon={<Settings2 size={13} />}>远端 iperf3 路径（可选）</FieldLabel>
                    <input
                      className="glass-input"
                      value={form.remoteIperfPath}
                      disabled={busy}
                      onChange={(event) => update("remoteIperfPath", event.target.value)}
                      placeholder="自动检测，例如 /opt/bin/iperf3"
                      spellCheck={false}
                      autoComplete="off"
                      aria-invalid={remoteIperfPathInvalid}
                      aria-describedby="remote-iperf-path-help"
                    />
                    <span
                      id="remote-iperf-path-help"
                      className={`field-helper ${remoteIperfPathInvalid ? "is-error" : ""}`}
                    >
                      {remoteIperfPathInvalid
                        ? "请填写绝对路径，例如 /opt/bin/iperf3"
                        : "留空会自动搜索 PATH、QNAP /opt/bin 和常见 Entware 目录"}
                    </span>
                  </label>
                </>
              ) : (
                <label>
                  <FieldLabel icon={<Activity size={13} />}>测速端口</FieldLabel>
                  <input
                    className="glass-input"
                    type="number"
                    min="1"
                    max="65535"
                    value={form.iperfPort}
                    disabled={busy}
                    onChange={(event) => update("iperfPort", event.target.value)}
                  />
                </label>
              )}

                </div>

                <div className="connection-fixed-controls">
              <div className="test-mode-tabs" aria-label="测速模式">
                <button
                  type="button"
                  className={standard ? "selected" : ""}
                  disabled={busy}
                  onClick={() => update("testMode", "standard")}
                >
                  <Gauge size={14} aria-hidden="true" />
                  标准测试
                </button>
                <button
                  type="button"
                  className={!standard ? "selected" : ""}
                  disabled={busy}
                  onClick={() => update("testMode", "advanced")}
                >
                  <Settings2 size={14} aria-hidden="true" />
                  高级测试
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
                    <span><Layers3 size={13} />{STANDARD_PARALLEL_STREAMS} 并发</span>
                    <span><Waves size={13} />上下行各 {STANDARD_DURATION_SECONDS} 秒</span>
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
                        <span className="compact-label">协议</span>
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
                        <span className="compact-label">方向</span>
                        <div className="mini-segmented icon-segmented">
                          <button
                            type="button"
                            className={form.direction === "upload" ? "selected upload" : ""}
                            onClick={() => update("direction", "upload")}
                            aria-label="上传"
                            title="上传"
                          >
                            <ArrowUpFromLine size={13} />
                          </button>
                          <button
                            type="button"
                            className={form.direction === "download" ? "selected download" : ""}
                            onClick={() => update("direction", "download")}
                            aria-label="下载"
                            title="下载"
                          >
                            <ArrowDownToLine size={13} />
                          </button>
                        </div>
                      </div>
                    </div>
                    <div className="field-grid advanced-fields">
                      <label>
                        <FieldLabel icon={<Layers3 size={13} />}>并发线程</FieldLabel>
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
                        <FieldLabel icon={<Clock3 size={13} />}>持续时间</FieldLabel>
                        <div className="duration-input">
                          <input
                            className="glass-input"
                            type="number"
                            min="0"
                            max="120"
                            value={form.durationSeconds}
                            onChange={(event) => update("durationSeconds", event.target.value)}
                          />
                          <span>{form.durationSeconds === "0" ? "持续" : "秒"}</span>
                        </div>
                      </label>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              <div className="form-actions">
                <button type="submit" className="primary-action" disabled={!valid || busy}>
                  <Play size={16} fill="currentColor" aria-hidden="true" />
                  {standard ? "开始完整测试" : "开始测速"}
                </button>
                <button
                  type="button"
                  className="stop-action"
                  onClick={stop}
                  disabled={!busy}
                  aria-label="中断测速"
                  title="中断测速"
                >
                  <Square size={15} fill="currentColor" aria-hidden="true" />
                </button>
              </div>
                </div>
            </form>
          </GlassPanel>
        </aside>

        <section className="speed-column">
          <GlassPanel
            className={`speed-stage direction-${activeDirection} ${running ? "is-running" : ""} ${completedStandard ? "is-complete" : ""}`}
          >
            <div className="stage-heading">
              <div>
                <span className="eyebrow">
                  {standard
                    ? `Standard · TCP · ${STANDARD_PARALLEL_STREAMS} streams`
                    : `Advanced · ${protocol.toUpperCase()} · ${parallelStreams} streams`}
                </span>
                <h2>
                  {completedStandard
                    ? "综合测速结果"
                    : activeDirection === "upload"
                      ? "上行速率"
                      : "下行速率"}
                </h2>
              </div>
              <div className="stage-heading-controls">
                <div className="bandwidth-unit-switch" aria-label="速率单位">
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
                  {running ? (continuous ? "LIVE" : `${Math.round(progress)}%`) : completedStandard ? "Result" : "Standby"}
                </div>
              </div>
            </div>

            <div className="network-stage">
              <MacGlyph active={busy} />
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
                      <strong>{form.host.trim() || "未连接"}</strong>
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
                      下载评价 · <strong>{rating.label}</strong>
                    </motion.span>
                  ) : (
                    <span className="sample-count">{samples.length} samples</span>
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
                  <span>上传平均</span>
                  <strong>{formatBandwidth(uploadStats.average, bandwidthUnit)}</strong>
                </div>
                <div className="metric-cell accent-download">
                  <span>下载平均</span>
                  <strong>{formatBandwidth(downloadStats.average, bandwidthUnit)}</strong>
                </div>
                <div className="metric-cell">
                  <span>负载延迟</span>
                  <strong>{formatLatency(overallStats.latency)}</strong>
                </div>
                <div className={`metric-cell ${retransmitWarning ? "quality-warning" : ""}`}>
                  <span className="metric-label-with-icon">
                    {retransmitWarning && <ShieldAlert size={12} aria-hidden="true" />}
                    TCP 重传
                  </span>
                  <strong>{overallStats.retransmits.toLocaleString("zh-CN")}</strong>
                </div>
                <div className="metric-cell">
                  <span>总传输</span>
                  <strong>{formatBytes(totalBytes)}</strong>
                </div>
              </>
            ) : (
              <>
                <div className="metric-cell">
                  <span>平均速率</span>
                  <strong>{formatBandwidth(activeStats.average, bandwidthUnit)}</strong>
                </div>
                <div className="metric-cell">
                  <span>峰值</span>
                  <strong>{formatBandwidth(activeStats.peak, bandwidthUnit)}</strong>
                </div>
                <div className="metric-cell">
                  <span>负载延迟</span>
                  <strong>{formatLatency(activeStats.latency)}</strong>
                </div>
                <div className="metric-cell">
                  <span>{protocol === "udp" ? "UDP 抖动" : "RTT 波动"}</span>
                  <strong>{formatLatency(activeStats.jitter)}</strong>
                </div>
                <div className={`metric-cell ${retransmitWarning ? "quality-warning" : ""}`}>
                  <span>{protocol === "tcp" ? "传输 / 重传" : "已传输"}</span>
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
                ? phaseLabels[status.phase]
                : continuous
                  ? "LIVE"
                  : `${Math.round(progress)}%`}
            </span>
          </div>
        </section>
      </main>

      <AnimatePresence>
        {prompt && (
          <motion.div
            className="confirm-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div
              className={`confirm-dialog prompt-${prompt.kind}`}
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="confirm-title"
              initial={{ opacity: 0, y: 16, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.98 }}
              transition={{ type: "spring", stiffness: 300, damping: 28 }}
            >
              <div className="confirm-icon">
                {prompt.kind === "hostKeyMismatch" ? (
                  <ShieldAlert size={21} />
                ) : prompt.kind === "iperf3Missing" ? (
                  <PackageSearch size={21} />
                ) : prompt.kind === "serverUnavailable" ? (
                  <CircleAlert size={21} />
                ) : (
                  <Server size={21} />
                )}
              </div>
              <h3 id="confirm-title">{prompt.title}</h3>
              <p>{prompt.message}</p>
              {prompt.detail && <code>{prompt.detail}</code>}
              <div className="confirm-actions">
                {prompt.kind !== "serverUnavailable" && (
                  <button type="button" onClick={rejectPrompt}>
                    {prompt.kind === "iperf3Missing" ? "稍后处理" : "取消"}
                  </button>
                )}
                {prompt.kind === "iperf3Missing" && prompt.detail && (
                  <button type="button" onClick={copyPromptDetail}>
                    {promptDetailCopied ? <Check size={13} /> : <Copy size={13} />}
                    {promptDetailCopied ? "已复制" : "复制命令"}
                  </button>
                )}
                {prompt.kind === "serverUnavailable" ? (
                  <button type="button" className="confirm-primary" onClick={rejectPrompt} autoFocus>
                    关闭
                  </button>
                ) : (
                  <button type="button" className="confirm-primary" onClick={confirmPrompt} autoFocus>
                    {prompt.kind === "hostKeyMismatch"
                      ? "信任并继续"
                      : prompt.kind === "iperf3Missing"
                        ? "已安装，重新检测"
                        : "复用并继续"}
                  </button>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
