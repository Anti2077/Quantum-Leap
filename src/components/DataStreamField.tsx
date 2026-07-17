import { memo } from "react";
import type { TransferDirection } from "../lib/types";
import { ParticleCanvas } from "./ParticleCanvas";

function DataStreamFieldComponent({
  active,
  direction,
  intensity
}: {
  active: boolean;
  direction: TransferDirection;
  intensity: number;
}) {
  return (
    <div className={`data-stream-field ${active ? "is-active" : ""}`} aria-hidden="true">
      <ParticleCanvas active={active} direction={direction} intensity={intensity} />
    </div>
  );
}

export const DataStreamField = memo(DataStreamFieldComponent);
