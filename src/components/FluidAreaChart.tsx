import { AnimatePresence, motion } from "framer-motion";
import { useId, useMemo, useRef, useState, type PointerEvent } from "react";
import { formatBandwidth, formatLatency, type BandwidthUnit } from "../lib/format";
import type { TransferDirection } from "../lib/types";

interface ChartPoint {
  t: number;
  bps: number;
  latencyMs?: number | null;
  jitterMs?: number | null;
}

interface PlotPoint extends ChartPoint {
  x: number;
  y: number;
}

const width = 720;
const height = 210;
const baseline = 204;
const curvePoints = 60;
const curveTransition = { duration: 0.48, ease: [0.22, 1, 0.36, 1] } as const;

function interpolateMetric(left: number | null | undefined, right: number | null | undefined, mix: number) {
  if (left == null) return right ?? null;
  if (right == null) return left;
  return left + (right - left) * mix;
}

function smoothPath(points: PlotPoint[]) {
  if (points.length < 2) return `M 0 ${baseline} L ${width} ${baseline}`;
  let path = `M ${points[0].x} ${points[0].y}`;
  for (let index = 0; index < points.length - 1; index += 1) {
    const p0 = points[Math.max(0, index - 1)];
    const p1 = points[index];
    const p2 = points[index + 1];
    const p3 = points[Math.min(points.length - 1, index + 2)];
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    path += ` C ${c1x} ${c1y}, ${c2x} ${c2y}, ${p2.x} ${p2.y}`;
  }
  return path;
}

export function FluidAreaChart({
  data,
  direction,
  unit
}: {
  data: ChartPoint[];
  direction: TransferDirection;
  unit: BandwidthUnit;
}) {
  const id = useId().replace(/:/g, "");
  const container = useRef<HTMLDivElement>(null);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const upload = direction === "upload";
  const accent = upload ? "#62e6d1" : "#ff8066";
  const accentEnd = upload ? "#81aef7" : "#f6b84a";

  const points = useMemo<PlotPoint[]>(() => {
    const visible = data.slice(-60);
    if (visible.length === 0) return [];
    const maximum = Math.max(...visible.map((point) => point.bps), 1);
    return Array.from({ length: curvePoints }, (_, index) => {
      const position = (index / (curvePoints - 1)) * Math.max(0, visible.length - 1);
      const leftIndex = Math.floor(position);
      const rightIndex = Math.min(visible.length - 1, leftIndex + 1);
      const mix = position - leftIndex;
      const left = visible[leftIndex];
      const right = visible[rightIndex];
      const bps = left.bps + (right.bps - left.bps) * mix;
      return {
        t: left.t + (right.t - left.t) * mix,
        bps,
        latencyMs: interpolateMetric(left.latencyMs, right.latencyMs, mix),
        jitterMs: interpolateMetric(left.jitterMs, right.jitterMs, mix),
        x: (index / (curvePoints - 1)) * width,
        y: baseline - (bps / maximum) * 166
      };
    });
  }, [data]);

  const line = useMemo(() => smoothPath(points), [points]);
  const area = `${line} L ${points.at(-1)?.x ?? width} ${baseline} L ${points[0]?.x ?? 0} ${baseline} Z`;
  const activePoint = hoveredIndex == null ? points.at(-1) : points[hoveredIndex];

  const movePointer = (event: PointerEvent<HTMLDivElement>) => {
    if (!container.current || points.length === 0) return;
    const bounds = container.current.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width));
    setHoveredIndex(Math.round(ratio * (points.length - 1)));
  };

  return (
    <div
      ref={container}
      className="fluid-chart"
      onPointerMove={movePointer}
      onPointerLeave={() => setHoveredIndex(null)}
    >
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <linearGradient id={`fill-${id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={accent} stopOpacity="0.48" />
            <stop offset="56%" stopColor={accent} stopOpacity="0.12" />
            <stop offset="100%" stopColor={accent} stopOpacity="0" />
          </linearGradient>
          <linearGradient id={`line-${id}`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor={accent} />
            <stop offset="100%" stopColor={accentEnd} />
          </linearGradient>
          <filter id={`chart-glow-${id}`} x="-20%" y="-40%" width="140%" height="180%">
            <feGaussianBlur stdDeviation="3" />
          </filter>
        </defs>
        <path d={`M 0 ${baseline} L ${width} ${baseline}`} stroke="rgba(255,255,255,.055)" strokeWidth="1" />
        {points.length > 0 && (
          <>
            <motion.path
              fill={`url(#fill-${id})`}
              initial={false}
              animate={{ d: area, opacity: 1 }}
              transition={{ d: curveTransition, opacity: { duration: 0.2 } }}
            />
            <motion.path
              fill="none"
              stroke={`url(#line-${id})`}
              strokeWidth="3"
              strokeLinecap="round"
              initial={false}
              animate={{ d: line, opacity: 1 }}
              transition={{ d: curveTransition, opacity: { duration: 0.2 } }}
            />
            {activePoint && (
              <>
                <motion.line
                  x1={activePoint.x}
                  x2={activePoint.x}
                  y1="24"
                  y2={baseline}
                  stroke="rgba(255,255,255,.08)"
                  strokeWidth="1"
                  initial={false}
                  animate={{ x1: activePoint.x, x2: activePoint.x }}
                  transition={hoveredIndex == null ? curveTransition : { duration: 0.08 }}
                />
                <motion.circle
                  r="7"
                  fill={accent}
                  filter={`url(#chart-glow-${id})`}
                  initial={false}
                  animate={{ cx: activePoint.x, cy: activePoint.y, opacity: 0.3 }}
                  transition={hoveredIndex == null ? curveTransition : { duration: 0.08 }}
                />
                <motion.circle
                  r="3"
                  fill={accent}
                  stroke="rgba(255,255,255,.85)"
                  strokeWidth="1"
                  initial={false}
                  animate={{ cx: activePoint.x, cy: activePoint.y, opacity: 1 }}
                  transition={hoveredIndex == null ? curveTransition : { duration: 0.08 }}
                />
              </>
            )}
          </>
        )}
      </svg>
      <AnimatePresence>
        {hoveredIndex != null && activePoint && (
          <motion.div
            className="chart-tooltip"
            style={{ left: `${(activePoint.x / width) * 100}%` }}
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
          >
            <strong>{formatBandwidth(activePoint.bps, unit)}</strong>
            <span>{activePoint.t.toFixed(1)}s</span>
            {(activePoint.latencyMs != null || activePoint.jitterMs != null) && (
              <span className="chart-tooltip-quality">
                延迟 {formatLatency(activePoint.latencyMs)} · 抖动 {formatLatency(activePoint.jitterMs)}
              </span>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
