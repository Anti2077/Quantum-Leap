import { listen } from "@tauri-apps/api/event";
import { AnimatePresence, motion } from "framer-motion";
import Activity from "lucide-react/dist/esm/icons/activity.js";
import ArrowDownToLine from "lucide-react/dist/esm/icons/arrow-down-to-line.js";
import ArrowUpFromLine from "lucide-react/dist/esm/icons/arrow-up-from-line.js";
import BookMarked from "lucide-react/dist/esm/icons/book-marked.js";
import Clock3 from "lucide-react/dist/esm/icons/clock-3.js";
import Gauge from "lucide-react/dist/esm/icons/gauge.js";
import KeyRound from "lucide-react/dist/esm/icons/key-round.js";
import Layers3 from "lucide-react/dist/esm/icons/layers-3.js";
import Network from "lucide-react/dist/esm/icons/network.js";
import Play from "lucide-react/dist/esm/icons/play.js";
import Plus from "lucide-react/dist/esm/icons/plus.js";
import Radio from "lucide-react/dist/esm/icons/radio.js";
import Server from "lucide-react/dist/esm/icons/server.js";
import Settings2 from "lucide-react/dist/esm/icons/settings-2.js";
import ShieldAlert from "lucide-react/dist/esm/icons/shield-alert.js";
import Square from "lucide-react/dist/esm/icons/square.js";
import Trash2 from "lucide-react/dist/esm/icons/trash-2.js";
import UserRound from "lucide-react/dist/esm/icons/user-round.js";
import Waves from "lucide-react/dist/esm/icons/waves.js";
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
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
  username: string;
  password: string;
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
  username: "",
  password: "",
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
  if (mbps >= 1000) return { key: "elite", label: "人上人" };
  if (mbps >= 50) return { key: "npc", label: "NPC" };
  return { key: "slow", label: "拉完了" };
}

export function SpeedWorkbench() {
  const animationPreviewDirection = import.meta.env.DEV
    ? new URLSearchParams(window.location.search).get("animationPreview")
    : null;
  const previewDirection: TransferDirection | null =
    animationPreviewDirection === "upload" || animationPreviewDirection === "download"
      ? animationPreviewDirection
      : null;
  const [form, setForm] = useState(initialForm);
  const [samples, setSamples] = useState<SamplePoint[]>([]);
  const [latest, setLatest] = useState<SpeedSample | null>(null);
  const [prompt, setPrompt] = useState<SpeedPromptEvent | null>(null);
  const [savedServers, setSavedServers] = useState<SavedServer[]>([]);
  const [savedMenuOpen, setSavedMenuOpen] = useState(false);
  const [savedBusy, setSavedBusy] = useState(false);
  const [bandwidthUnit, setBandwidthUnit] = useState<BandwidthUnit>(savedBandwidthUnit);
  const [status, setStatus] = useState<SpeedStateEvent>({ phase: "idle", message: "等待连接服务器" });
  const requestRef = useRef<SpeedTestRequest | null>(null);
  const savedControlRef = useRef<HTMLDivElement>(null);
  const lastGoodSampleRef = useRef<Partial<Record<TransferDirection, SpeedSample>>>({});

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
        setStatus({ phase: "cancelled", message: "已取消本次连接" });
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
  const displayedBps = previewDirection
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
  const progress = continuous
    ? 0
    : status.phase === "completed"
      ? 100
      : Math.min(
          100,
          Math.max(0, ((completedDuration + elapsed) / (duration * (standard ? 2 : 1))) * 100)
        );
  const valid =
    form.host.trim().length > 0 &&
    form.username.trim().length > 0 &&
    form.password.length > 0 &&
    Number(form.sshPort) > 0 &&
    Number(form.iperfPort) > 0 &&
    (standard ||
      ((duration === 0 || (duration >= 3 && duration <= 120)) &&
        parallelStreams >= 1 &&
        parallelStreams <= 32));

  const update = <K extends keyof ConnectionForm>(key: K, value: ConnectionForm[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const selectSavedServer = async (server: SavedServer) => {
    if (savedBusy) return;
    setSavedBusy(true);
    try {
      const password = server.password || (await getSavedServerPassword(server.id));
      setSavedServers((current) =>
        current.map((saved) => (saved.id === server.id ? { ...saved, password } : saved))
      );
      setForm((current) => ({
        ...current,
        host: server.host,
        sshPort: server.sshPort.toString(),
        iperfPort: server.iperfPort.toString(),
        username: server.username,
        password
      }));
      setSavedMenuOpen(false);
      setStatus({ phase: "idle", message: `已载入 ${server.host}` });
    } catch (error) {
      setStatus({ phase: "failed", message: errorMessage(error) });
    } finally {
      setSavedBusy(false);
    }
  };

  const saveCurrentServer = async () => {
    if (!form.host.trim() || !form.username.trim() || !form.password || savedBusy) return;
    const existing = savedServers.find(
      (server) =>
        server.host === form.host.trim() &&
        server.sshPort === Number(form.sshPort) &&
        server.username === form.username.trim()
    );
    setSavedBusy(true);
    try {
      const saved = await saveServer({
        id: existing?.id,
        host: form.host.trim(),
        sshPort: Number(form.sshPort),
        iperfPort: Number(form.iperfPort),
        username: form.username.trim(),
        password: form.password
      });
      setSavedServers((current) => [saved, ...current.filter((server) => server.id !== saved.id)]);
      setStatus({ phase: "idle", message: `已保存 ${saved.host} 到常用服务器` });
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
    setStatus({ phase: "starting", message: "正在建立 SSH 安全通道" });
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
      username: form.username.trim(),
      password: form.password,
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

  const rejectPrompt = () => {
    setPrompt(null);
    requestRef.current = null;
    setStatus({ phase: "cancelled", message: "已取消本次连接" });
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

      <header className="titlebar" data-tauri-drag-region>
        <div className="brand-mark" data-tauri-drag-region>
          <Activity size={15} aria-hidden="true" />
          <span>Pulse</span>
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
                <span className="eyebrow">SSH endpoint</span>
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
                          onClick={saveCurrentServer}
                          disabled={!form.host.trim() || !form.username.trim() || !form.password || savedBusy}
                          aria-label="保存当前服务器"
                          title="保存当前服务器"
                        >
                          <Plus size={14} />
                        </button>
                      </div>
                      <div className="saved-server-list">
                        {savedServers.length === 0 ? (
                          <span className="saved-empty">暂无常用服务器</span>
                        ) : (
                          savedServers.map((server) => (
                            <div className="saved-server-item" key={server.id}>
                              <button type="button" onClick={() => selectSavedServer(server)}>
                                <span>{server.host}</span>
                                <small>{server.username} · SSH {server.sshPort}</small>
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

              <label>
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
              </label>

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
                  <span>平均延迟</span>
                  <strong>{formatLatency(overallStats.latency)}</strong>
                </div>
                <div className="metric-cell">
                  <span>平均抖动</span>
                  <strong>{formatLatency(overallStats.jitter)}</strong>
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
                  <span>平均延迟</span>
                  <strong>{formatLatency(activeStats.latency)}</strong>
                </div>
                <div className="metric-cell">
                  <span>平均抖动</span>
                  <strong>{formatLatency(activeStats.jitter)}</strong>
                </div>
                <div className="metric-cell">
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
            className={`status-line phase-${status.phase}`}
            role="status"
            aria-live="polite"
            title={status.message}
          >
            <span className="status-pulse" />
            <AnimatePresence mode="wait" initial={false}>
              <motion.p
                key={`${status.phase}-${status.message}`}
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -5 }}
                transition={{ duration: 0.2 }}
              >
                {status.message}
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
                {prompt.kind === "hostKeyMismatch" ? <ShieldAlert size={21} /> : <Server size={21} />}
              </div>
              <h3 id="confirm-title">{prompt.title}</h3>
              <p>{prompt.message}</p>
              {prompt.detail && <code>{prompt.detail}</code>}
              <div className="confirm-actions">
                <button type="button" onClick={rejectPrompt}>取消</button>
                <button type="button" className="confirm-primary" onClick={confirmPrompt} autoFocus>
                  {prompt.kind === "hostKeyMismatch" ? "信任并继续" : "复用并继续"}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
