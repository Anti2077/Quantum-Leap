import { motion, useReducedMotion } from "framer-motion";
import { memo, useId, type CSSProperties } from "react";
import type { TransferDirection } from "../lib/types";

interface EnergyLinkProps {
  direction: TransferDirection;
  active: boolean;
  engaged: boolean;
  intensity?: number;
}

const route = "M 0 31 C 30 31, 33 63, 57 63 S 83 31, 102 31";
const reverseRoute = "M 102 31 C 83 31, 81 63, 57 63 C 33 63, 30 31, 0 31";

function EnergyLinkComponent({
  direction,
  active,
  engaged,
  intensity = 0.5
}: EnergyLinkProps) {
  const forward = direction === "upload";
  const reduceMotion = useReducedMotion();
  const id = useId().replace(/:/g, "");
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
          <filter id={plugGlowId} x="-180%" y="-180%" width="460%" height="460%">
            <feGaussianBlur stdDeviation="1.5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <path id={reverseRouteId} d={reverseRoute} />
        </defs>

        <path className="energy-rail" d={route} pathLength="1" />
        <motion.path
          className="energy-cable"
          d={reverseRoute}
          pathLength="1"
          initial={false}
          animate={{ pathLength: engaged ? 1 : 0, opacity: engaged ? 1 : 0.28 }}
          transition={{ pathLength: { duration: 0.72, ease: [0.22, 1, 0.36, 1] }, opacity: { duration: 0.25 } }}
        />
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
