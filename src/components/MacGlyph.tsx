import Laptop from "lucide-react/dist/esm/icons/laptop.js";
import { memo } from "react";

function MacGlyphComponent({
  active,
  label = "此 Mac",
  subtitle = "Local client"
}: {
  active: boolean;
  label?: string;
  subtitle?: string;
}) {
  return (
    <div className={`local-node ${active ? "is-active" : ""}`}>
      <div className="mac-shell">
        <div className="mac-glyph">
          <div className="mac-glyph-highlight" />
          <div className="mac-core" aria-hidden="true" />
          <Laptop aria-hidden="true" strokeWidth={1.4} />
          <span className="mac-status-light" />
        </div>
        <span className="mac-port" aria-hidden="true" />
        <span className="mac-coupling-flash" aria-hidden="true" />
      </div>
      <div className="node-label">
        <strong>{label}</strong>
        <span>{subtitle}</span>
      </div>
    </div>
  );
}

export const MacGlyph = memo(MacGlyphComponent);
