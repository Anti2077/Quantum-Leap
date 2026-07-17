import { memo, type CSSProperties } from "react";
import type { TransferDirection } from "../lib/types";

const lanes = [
  { y: "9%", duration: "2.9s", delay: "-1.8s", code: "F2 09 A7 4C" },
  { y: "23%", duration: "3.7s", delay: "-0.6s", code: "08 B4 1D 77" },
  { y: "39%", duration: "2.6s", delay: "-2.2s", code: "C1 32 EF 06" },
  { y: "56%", duration: "4.1s", delay: "-1.3s", code: "7A 10 D9 B8" },
  { y: "72%", duration: "3.2s", delay: "-2.7s", code: "03 E8 6F A2" },
  { y: "88%", duration: "3.5s", delay: "-0.9s", code: "D5 44 0C 91" }
];

function DataStreamFieldComponent({
  active,
  direction
}: {
  active: boolean;
  direction: TransferDirection;
}) {
  return (
    <div
      className={`data-stream-field direction-${direction} ${active ? "is-active" : ""}`}
      aria-hidden="true"
    >
      <div className="data-grid" />
      <div className="data-scan-gate" />
      <div className="data-horizon" />
      {lanes.map((lane, index) => (
        <span
          className="data-lane"
          key={lane.y}
          style={{
            "--lane-y": lane.y,
            "--lane-duration": lane.duration,
            "--lane-delay": lane.delay
          } as CSSProperties}
        >
          <span className="packet-train">
            <i className="packet packet-long" />
            <i className="packet" />
            <code>{lane.code}</code>
            <i className="packet packet-short" />
            <b>{String(index + 1).padStart(2, "0")}</b>
          </span>
        </span>
      ))}
      <span className="data-lock lock-left" />
      <span className="data-lock lock-right" />
    </div>
  );
}

export const DataStreamField = memo(DataStreamFieldComponent);
