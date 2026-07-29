import { AnimatePresence, motion } from "framer-motion";
import Server from "lucide-react/dist/esm/icons/server.js";
import ShieldAlert from "lucide-react/dist/esm/icons/shield-alert.js";
import { ComparisonChart } from "../../components/ComparisonChart";
import { DataStreamField } from "../../components/DataStreamField";
import { EnergyLink } from "../../components/EnergyLink";
import { FluidAreaChart } from "../../components/FluidAreaChart";
import { GlassPanel } from "../../components/GlassPanel";
import { LocalDeviceGlyph } from "../../components/LocalDeviceGlyph";
import { NumberTicker } from "../../components/NumberTicker";
import { formatBandwidth, formatBytes, formatLatency, type BandwidthUnit } from "../../lib/format";
import type { TranslationKey } from "../../lib/i18n";
import type { SpeedStateEvent, TransferDirection, TransportProtocol } from "../../lib/types";
import type { SamplePoint, SampleSummary } from "./results-model";
import { STANDARD_PARALLEL_STREAMS } from "./form-model";

interface ResultsPanelProps {
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
  formatNumber: (value: number) => string;
  standard: boolean;
  remoteToRemote: boolean;
  running: boolean;
  busy: boolean;
  continuous: boolean;
  completedStandard: boolean;
  activeDirection: TransferDirection;
  protocol: TransportProtocol;
  parallelStreams: number;
  clientHost: string;
  serverHost: string;
  serverPort: string;
  samples: SamplePoint[];
  activeSamples: SamplePoint[];
  bandwidthUnit: BandwidthUnit;
  onBandwidthUnitChange: (unit: BandwidthUnit) => void;
  status: SpeedStateEvent;
  motionIntensity: number;
  progress: number;
  rate: { value: string; unit: string };
  rating: { key: string; labelKey: TranslationKey };
  uploadStats: SampleSummary;
  downloadStats: SampleSummary;
  overallStats: SampleSummary;
  activeStats: SampleSummary;
  totalBytes: number;
  retransmitWarning: boolean;
  displayedStatusMessage: string;
}

const terminalPhases: SpeedStateEvent["phase"][] = ["completed", "cancelled", "failed"];
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

export function ResultsPanel(props: ResultsPanelProps) {
  const {
    t,
    formatNumber,
    standard,
    remoteToRemote,
    running,
    busy,
    continuous,
    completedStandard,
    activeDirection,
    protocol,
    parallelStreams,
    clientHost,
    serverHost,
    serverPort,
    samples,
    activeSamples,
    bandwidthUnit,
    onBandwidthUnitChange,
    status,
    motionIntensity,
    progress,
    rate,
    rating,
    uploadStats,
    downloadStats,
    overallStats,
    activeStats,
    totalBytes,
    retransmitWarning,
    displayedStatusMessage
  } = props;

  return (
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
                  onClick={() => onBandwidthUnitChange(unit)}
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
          <LocalDeviceGlyph
            active={running || status.phase === "stopping"}
            label={remoteToRemote ? clientHost || t("deviceA") : t("thisDevice")}
            subtitle={remoteToRemote ? t("remoteClient") : t("localClient")}
          />
          <EnergyLink direction={activeDirection} active={running} engaged={busy} intensity={motionIntensity} />
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
                  <strong>{serverHost || t("notConnected")}</strong>
                  <span>Port {serverPort}</span>
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
            <div className="metric-cell accent-upload"><span>{t("uploadAverage")}</span><strong>{formatBandwidth(uploadStats.average, bandwidthUnit)}</strong></div>
            <div className="metric-cell accent-download"><span>{t("downloadAverage")}</span><strong>{formatBandwidth(downloadStats.average, bandwidthUnit)}</strong></div>
            <div className="metric-cell"><span>{t("loadedLatency")}</span><strong>{formatLatency(overallStats.latency)}</strong></div>
            <div className={`metric-cell ${retransmitWarning ? "quality-warning" : ""}`}>
              <span className="metric-label-with-icon">{retransmitWarning && <ShieldAlert size={12} aria-hidden="true" />}{t("tcpRetransmits")}</span>
              <strong>{formatNumber(overallStats.retransmits)}</strong>
            </div>
            <div className="metric-cell"><span>{t("totalTransfer")}</span><strong>{formatBytes(totalBytes)}</strong></div>
          </>
        ) : (
          <>
            <div className="metric-cell"><span>{t("averageSpeed")}</span><strong>{formatBandwidth(activeStats.average, bandwidthUnit)}</strong></div>
            <div className="metric-cell"><span>{t("peak")}</span><strong>{formatBandwidth(activeStats.peak, bandwidthUnit)}</strong></div>
            <div className="metric-cell"><span>{t("loadedLatency")}</span><strong>{formatLatency(activeStats.latency)}</strong></div>
            <div className="metric-cell"><span>{protocol === "udp" ? t("udpJitter") : t("rttVariation")}</span><strong>{formatLatency(activeStats.jitter)}</strong></div>
            <div className={`metric-cell ${retransmitWarning ? "quality-warning" : ""}`}>
              <span>{protocol === "tcp" ? t("transferRetransmits") : t("transferred")}</span>
              <strong>{protocol === "tcp" ? `${formatBytes(activeStats.bytes)} / ${activeStats.retransmits}` : formatBytes(activeStats.bytes)}</strong>
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
  );
}
