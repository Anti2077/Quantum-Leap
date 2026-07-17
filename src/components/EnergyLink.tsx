import { motion, useReducedMotion } from "framer-motion";
import { memo, useId, type CSSProperties } from "react";
import type { TransferDirection } from "../lib/types";

interface EnergyLinkProps {
  direction: TransferDirection;
  active: boolean;
  engaged: boolean;
  intensity?: number;
}

const route = "M 2 31 C 31 31, 33 63, 57 63 S 80 31, 98 31";
const reverseRoute = "M 98 31 C 80 31, 81 63, 57 63 C 33 63, 31 31, 2 31";
const pulseDelays = [0, -0.38, -0.76, -1.14];

function EnergyLinkComponent({
  direction,
  active,
  engaged,
  intensity = 0.5
}: EnergyLinkProps) {
  const forward = direction === "upload";
  const reduceMotion = useReducedMotion();
  const id = useId().replace(/:/g, "");
  const gradientId = `energy-${id}`;
  const glowId = `energy-glow-${id}`;
  const plugGlowId = `plug-glow-${id}`;
  const reverseRouteId = `reverse-route-${id}`;
  const energyLevel = Math.min(1.6, Math.max(0.35, intensity));

  return (
    <div
      className={`energy-link direction-${direction} ${engaged ? "is-engaged" : ""} ${active ? "is-active" : ""}`}
      style={{ "--energy-level": energyLevel } as CSSProperties}
      aria-hidden="true"
    >
      <svg viewBox="0 0 100 92" preserveAspectRatio="none">
        <defs>
          <linearGradient id={gradientId} x1={forward ? "0" : "1"} x2={forward ? "1" : "0"}>
            <stop offset="0%" stopColor={forward ? "#4cd9c3" : "#ff735b"} stopOpacity="0.24" />
            <stop offset="48%" stopColor={forward ? "#d9fff7" : "#fff0e8"} stopOpacity="0.98" />
            <stop offset="100%" stopColor={forward ? "#7caef8" : "#ffc55d"} stopOpacity="0.3" />
          </linearGradient>
          <filter id={glowId} x="-50%" y="-100%" width="200%" height="300%">
            <feGaussianBlur stdDeviation="2.2" />
          </filter>
          <filter id={plugGlowId} x="-180%" y="-180%" width="460%" height="460%">
            <feGaussianBlur stdDeviation="1.5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <path id={reverseRouteId} d={reverseRoute} />
        </defs>

        <path className="energy-rail" d={route} />
        <motion.path
          className="energy-cable"
          d={reverseRoute}
          pathLength="1"
          initial={false}
          animate={{ pathLength: engaged ? 1 : 0, opacity: engaged ? 1 : 0.28 }}
          transition={{ pathLength: { duration: 0.72, ease: [0.22, 1, 0.36, 1] }, opacity: { duration: 0.25 } }}
        />
        <path
          className="energy-flow-dash"
          d={route}
          pathLength="1"
          stroke={`url(#${gradientId})`}
        />
        <path
          className="energy-flow-glow"
          d={route}
          pathLength="1"
          stroke={`url(#${gradientId})`}
          filter={`url(#${glowId})`}
        />

        {pulseDelays.map((delay, index) => (
          <path
            key={delay}
            className={`energy-pulse energy-pulse-${index + 1}`}
            d={route}
            pathLength="1"
            stroke={forward ? "#e5fff9" : "#fff1ea"}
            style={{ "--packet-delay": `${delay}s` } as CSSProperties}
          />
        ))}

        <g className="energy-endpoint endpoint-local">
          <circle cx="2" cy="31" r="4.8" />
          <circle cx="2" cy="31" r="1.6" />
        </g>
        <g className="energy-endpoint endpoint-remote">
          <circle cx="98" cy="31" r="4.8" />
          <circle cx="98" cy="31" r="1.6" />
        </g>

        {engaged && !reduceMotion ? (
          <motion.g
            className="plug-flight"
            initial={{ opacity: 0 }}
            animate={{ opacity: [0, 1, 1] }}
            transition={{ duration: 0.18, times: [0, 0.35, 1] }}
          >
            <g className="energy-plug" filter={`url(#${plugGlowId})`}>
              <path d="M -10 0 H -5" />
              <rect x="-5.4" y="-4.3" width="6.3" height="8.6" rx="1.8" />
              <path d="M 0.7 -2.2 H 3.8 M 0.7 2.2 H 3.8" />
              <animateMotion dur="720ms" fill="freeze" rotate="auto">
                <mpath href={`#${reverseRouteId}`} />
              </animateMotion>
            </g>
          </motion.g>
        ) : engaged ? (
          <g className="energy-plug is-docked" transform="translate(2 31) rotate(180)" filter={`url(#${plugGlowId})`}>
            <path d="M -10 0 H -5" />
            <rect x="-5.4" y="-4.3" width="6.3" height="8.6" rx="1.8" />
            <path d="M 0.7 -2.2 H 3.8 M 0.7 2.2 H 3.8" />
          </g>
        ) : null}
      </svg>

      <span className={`energy-direction ${forward ? "forward" : "reverse"}`}>
        <i />
        {forward ? "↑" : "↓"}
      </span>
    </div>
  );
}

export const EnergyLink = memo(
  EnergyLinkComponent,
  (previous, next) =>
    previous.active === next.active &&
    previous.engaged === next.engaged &&
    previous.direction === next.direction &&
    Math.floor((previous.intensity ?? 0.5) * 4) === Math.floor((next.intensity ?? 0.5) * 4)
);
