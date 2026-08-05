import { motion } from "framer-motion";
import ArrowDownToLine from "lucide-react/dist/esm/icons/arrow-down-to-line.js";
import ArrowUpFromLine from "lucide-react/dist/esm/icons/arrow-up-from-line.js";
import Clock3 from "lucide-react/dist/esm/icons/clock-3.js";
import Gauge from "lucide-react/dist/esm/icons/gauge.js";
import Layers3 from "lucide-react/dist/esm/icons/layers-3.js";
import Network from "lucide-react/dist/esm/icons/network.js";
import Play from "lucide-react/dist/esm/icons/play.js";
import Settings2 from "lucide-react/dist/esm/icons/settings-2.js";
import Square from "lucide-react/dist/esm/icons/square.js";
import Waves from "lucide-react/dist/esm/icons/waves.js";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useI18n } from "../../lib/i18n";
import {
  STANDARD_DURATION_SECONDS,
  STANDARD_PARALLEL_STREAMS,
  type ConnectionForm
} from "./form-model";

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
      <div ref={contentRef} className="test-settings-content">{children}</div>
    </motion.div>
  );
}

export function TestConfiguration({
  form,
  standard,
  busy,
  valid,
  onUpdate,
  onStop
}: {
  form: ConnectionForm;
  standard: boolean;
  busy: boolean;
  valid: boolean;
  onUpdate: <K extends keyof ConnectionForm>(key: K, value: ConnectionForm[K]) => void;
  onStop: () => void;
}) {
  const { t } = useI18n();

  return (
    <div className="connection-fixed-controls">
      <div className="test-mode-tabs" aria-label={t("testMode")}>
        <button
          type="button"
          className={standard ? "selected" : ""}
          disabled={busy}
          onClick={() => onUpdate("testMode", "standard")}
        >
          <Gauge size={14} aria-hidden="true" />
          {t("standardTest")}
        </button>
        <button
          type="button"
          className={!standard ? "selected" : ""}
          disabled={busy}
          onClick={() => onUpdate("testMode", "advanced")}
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
                onClick={() => onUpdate("rateLimitEnabled", !form.rateLimitEnabled)}
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
                  onChange={(value) => onUpdate("targetBitrateMbps", value)}
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
                      onClick={() => onUpdate("protocol", value)}
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
                    onClick={() => onUpdate("direction", "upload")}
                    aria-label={t("upload")}
                    title={t("upload")}
                  >
                    <ArrowUpFromLine size={13} />
                  </button>
                  <button
                    type="button"
                    className={form.direction === "download" ? "selected download" : ""}
                    onClick={() => onUpdate("direction", "download")}
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
                  onChange={(event) => onUpdate("parallelStreams", event.target.value)}
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
                    onChange={(event) => onUpdate("durationSeconds", event.target.value)}
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
                  onChange={(event) => onUpdate("rateLimitEnabled", event.target.checked)}
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
                    onChange={(value) => onUpdate("targetBitrateMbps", value)}
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
          onClick={onStop}
          disabled={!busy}
          aria-label={t("stopTest")}
          title={t("stopTest")}
        >
          <Square size={15} fill="currentColor" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
