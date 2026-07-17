import type { ReactNode } from "react";
import { cn } from "../utils/cn";

export function GlassPanel({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("glass-panel", className)}>{children}</div>;
}
