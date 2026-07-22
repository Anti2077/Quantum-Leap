import { AnimatePresence, motion } from "framer-motion";
import { useId, useMemo, useRef, useState, type PointerEvent } from "react";
import { formatBandwidth, type BandwidthUnit } from "../lib/format";
import { useI18n } from "../lib/i18n";

interface ChartPoint {
  t: number;
  bps: number;
}

interface PlotPoint extends ChartPoint {
  x: number;
  y: number;
}

const width = 720;
const height = 190;
const top = 24;
const baseline = 180;

function average(data: ChartPoint[]) {
  return data.length ? data.reduce((total, point) => total + point.bps, 0) / data.length : 0;
}

function plot(data: ChartPoint[], maximum: number): PlotPoint[] {
  return data.map((point, index) => ({
    ...point,
    x: data.length === 1 ? width : (index / (data.length - 1)) * width,
    y: baseline - (point.bps / maximum) * (baseline - top)
  }));
}

function smoothPath(points: PlotPoint[]) {
  if (points.length < 2) return "";
  let path = `M ${points[0].x} ${points[0].y}`;
  for (let index = 0; index < points.length - 1; index += 1) {
    const p0 = points[Math.max(0, index - 1)];
    const p1 = points[index];
    const p2 = points[index + 1];
    const p3 = points[Math.min(points.length - 1, index + 2)];
    path += ` C ${p1.x + (p2.x - p0.x) / 6} ${p1.y + (p2.y - p0.y) / 6}, ${p2.x - (p3.x - p1.x) / 6} ${p2.y - (p3.y - p1.y) / 6}, ${p2.x} ${p2.y}`;
  }
  return path;
}

function maximumPoint(points: PlotPoint[]) {
  return points.reduce<PlotPoint | null>(
    (maximum, point) => (!maximum || point.bps > maximum.bps ? point : maximum),
    null
  );
}

export function ComparisonChart({
  upload,
  download,
  unit
}: {
  upload: ChartPoint[];
  download: ChartPoint[];
  unit: BandwidthUnit;
}) {
  const { t } = useI18n();
  const id = useId().replace(/:/g, "");
  const container = useRef<HTMLDivElement>(null);
  const [hoverRatio, setHoverRatio] = useState<number | null>(null);
  const maximum = Math.max(...upload.map((point) => point.bps), ...download.map((point) => point.bps), 1);
  const uploadAverage = average(upload);
  const downloadAverage = average(download);
  const uploadPoints = useMemo(() => plot(upload, maximum), [maximum, upload]);
  const downloadPoints = useMemo(() => plot(download, maximum), [download, maximum]);
  const uploadMaximum = maximumPoint(uploadPoints);
  const downloadMaximum = maximumPoint(downloadPoints);
  const uploadAverageY = baseline - (uploadAverage / maximum) * (baseline - top);
  const downloadAverageY = baseline - (downloadAverage / maximum) * (baseline - top);
  const hoveredUpload =
    hoverRatio == null || uploadPoints.length === 0
      ? null
      : uploadPoints[Math.round(hoverRatio * (uploadPoints.length - 1))];
  const hoveredDownload =
    hoverRatio == null || downloadPoints.length === 0
      ? null
      : downloadPoints[Math.round(hoverRatio * (downloadPoints.length - 1))];
  const hoveredTime = Math.max(hoveredUpload?.t ?? 0, hoveredDownload?.t ?? 0);

  const movePointer = (event: PointerEvent<HTMLDivElement>) => {
    if (!container.current || (uploadPoints.length === 0 && downloadPoints.length === 0)) return;
    const bounds = container.current.getBoundingClientRect();
    setHoverRatio(Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width)));
  };

  return (
    <div
      ref={container}
      className="comparison-chart"
      onPointerMove={movePointer}
      onPointerLeave={() => setHoverRatio(null)}
    >
      <div className="comparison-legend">
        <span className="upload"><i />{t("upload")}</span>
        <span className="download"><i />{t("download")}</span>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <filter id={`result-glow-${id}`} x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="5" />
          </filter>
        </defs>
        <line x1="0" x2={width} y1={baseline} y2={baseline} stroke="rgba(255,255,255,.06)" />
        <motion.line
          x1="0"
          x2={width}
          y1={uploadAverageY}
          y2={uploadAverageY}
          stroke="var(--chart-upload, #62e6d1)"
          strokeOpacity="0.42"
          strokeDasharray="9 9"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
        />
        <motion.line
          x1="0"
          x2={width}
          y1={downloadAverageY}
          y2={downloadAverageY}
          stroke="var(--chart-download, #ff8066)"
          strokeOpacity="0.42"
          strokeDasharray="9 9"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
        />
        <motion.path
          d={smoothPath(uploadPoints)}
          fill="none"
          stroke="var(--chart-upload, #62e6d1)"
          strokeWidth="3"
          strokeLinecap="round"
          initial={{ pathLength: 0, opacity: 0 }}
          animate={{ pathLength: 1, opacity: 0.94 }}
          transition={{ duration: 0.9, ease: "easeOut" }}
        />
        <motion.path
          d={smoothPath(downloadPoints)}
          fill="none"
          stroke="var(--chart-download, #ff8066)"
          strokeWidth="3"
          strokeLinecap="round"
          initial={{ pathLength: 0, opacity: 0 }}
          animate={{ pathLength: 1, opacity: 0.94 }}
          transition={{ duration: 0.9, delay: 0.12, ease: "easeOut" }}
        />
        {[
          { point: uploadMaximum, color: "var(--chart-upload, #62e6d1)" },
          { point: downloadMaximum, color: "var(--chart-download, #ff8066)" }
        ].map(
          ({ point, color }) => point && (
            <g key={color}>
              <circle cx={point.x} cy={point.y} r="9" fill={color} opacity="0.3" filter={`url(#result-glow-${id})`} />
              <circle cx={point.x} cy={point.y} r="4" fill={color} stroke="white" strokeOpacity="0.8" strokeWidth="1.2" />
            </g>
          )
        )}
        {hoverRatio != null && (
          <>
            <line
              x1={hoverRatio * width}
              x2={hoverRatio * width}
              y1={top}
              y2={baseline}
              className="comparison-hover-line"
            />
            {[hoveredUpload, hoveredDownload].map(
              (point, index) => point && (
                <g key={index}>
                  <circle
                    cx={point.x}
                    cy={point.y}
                    r="7"
                    fill={index === 0 ? "var(--chart-upload, #62e6d1)" : "var(--chart-download, #ff8066)"}
                    opacity="0.18"
                  />
                  <circle
                    cx={point.x}
                    cy={point.y}
                    r="3.4"
                    fill={index === 0 ? "var(--chart-upload, #62e6d1)" : "var(--chart-download, #ff8066)"}
                    stroke="white"
                    strokeWidth="1.2"
                  />
                </g>
              )
            )}
          </>
        )}
      </svg>
      <span className="average-label upload" style={{ top: `${(uploadAverageY / height) * 100}%` }}>
        AVG {formatBandwidth(uploadAverage, unit)}
      </span>
      <span className="average-label download" style={{ top: `${(downloadAverageY / height) * 100}%` }}>
        AVG {formatBandwidth(downloadAverage, unit)}
      </span>
      {uploadMaximum && (
        <span
          className="maximum-label upload"
          style={{
            left: `${uploadMaximum.x / width > 0.72 ? 78 : Math.max(18, (uploadMaximum.x / width) * 100)}%`,
            top: `${(uploadMaximum.y / height) * 100}%`,
            transform: uploadMaximum.x / width > 0.72 ? "translate(-100%, -135%)" : undefined
          }}
        >
          MAX {formatBandwidth(uploadMaximum.bps, unit)}
        </span>
      )}
      {downloadMaximum && (
        <span
          className="maximum-label download"
          style={{
            left: `${downloadMaximum.x / width > 0.72 ? 78 : Math.max(18, (downloadMaximum.x / width) * 100)}%`,
            top: `${(downloadMaximum.y / height) * 100}%`,
            transform: downloadMaximum.x / width > 0.72 ? "translate(-100%, 28%)" : undefined
          }}
        >
          MAX {formatBandwidth(downloadMaximum.bps, unit)}
        </span>
      )}
      <AnimatePresence>
        {hoverRatio != null && (hoveredUpload || hoveredDownload) && (
          <motion.div
            className="chart-tooltip comparison-tooltip"
            style={{ left: `${Math.min(88, Math.max(12, hoverRatio * 100))}%` }}
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
          >
            {hoveredUpload && (
              <strong className="comparison-tooltip-upload">
                {t("chartUpload", { value: formatBandwidth(hoveredUpload.bps, unit) })}
              </strong>
            )}
            {hoveredDownload && (
              <strong className="comparison-tooltip-download">
                {t("chartDownload", { value: formatBandwidth(hoveredDownload.bps, unit) })}
              </strong>
            )}
            <span>{hoveredTime.toFixed(1)}s</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
