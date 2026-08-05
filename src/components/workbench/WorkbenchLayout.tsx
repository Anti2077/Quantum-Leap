import * as Dialog from "@radix-ui/react-dialog";
import GripVertical from "lucide-react/dist/esm/icons/grip-vertical.js";
import Settings2 from "lucide-react/dist/esm/icons/settings-2.js";
import Square from "lucide-react/dist/esm/icons/square.js";
import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type SetStateAction
} from "react";
import type { SpeedStateEvent } from "../../lib/types";

const LAYOUT_SPLIT_KEY = "pulse.layout-split";
export const DEFAULT_LAYOUT_SPLIT = 0.32;
export const MIN_LAYOUT_SPLIT = 0.25;
export const MAX_LAYOUT_SPLIT = 0.5;
export const LAYOUT_DIVIDER_WIDTH = 20;
const COMPACT_LAYOUT_QUERY = "(max-width: 860px)";

function savedLayoutSplit(): number {
  try {
    const storedValue = localStorage.getItem(LAYOUT_SPLIT_KEY);
    if (storedValue == null) return DEFAULT_LAYOUT_SPLIT;
    const value = Number(storedValue);
    return Number.isFinite(value)
      ? Math.min(MAX_LAYOUT_SPLIT, Math.max(MIN_LAYOUT_SPLIT, value))
      : DEFAULT_LAYOUT_SPLIT;
  } catch {
    return DEFAULT_LAYOUT_SPLIT;
  }
}

function usesCompactLayout() {
  return window.matchMedia(COMPACT_LAYOUT_QUERY).matches;
}

export function useWorkbenchLayout({
  endpointEditor,
  initialConnectionOpen
}: {
  endpointEditor: "client" | "server" | null;
  initialConnectionOpen: boolean;
}) {
  const [compactLayout, setCompactLayout] = useState(usesCompactLayout);
  const [layoutSplit, setLayoutSplit] = useState(() =>
    usesCompactLayout() ? DEFAULT_LAYOUT_SPLIT : savedLayoutSplit()
  );
  const [layoutResizing, setLayoutResizing] = useState(false);
  const [connectionOpen, setConnectionOpen] = useState(initialConnectionOpen);
  const appContentRef = useRef<HTMLElement>(null);
  const endpointEditorRef = useRef<HTMLElement>(null);

  const updateLayoutSplit = (clientX: number) => {
    if (compactLayout) return;
    const bounds = appContentRef.current?.getBoundingClientRect();
    if (!bounds) return;
    const availableWidth = Math.max(1, bounds.width - LAYOUT_DIVIDER_WIDTH);
    const next = (clientX - bounds.left - LAYOUT_DIVIDER_WIDTH / 2) / availableWidth;
    setLayoutSplit(Math.min(MAX_LAYOUT_SPLIT, Math.max(MIN_LAYOUT_SPLIT, next)));
  };

  const startLayoutResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (compactLayout || event.button !== 0) return;
    event.preventDefault();
    if (typeof event.currentTarget.setPointerCapture === "function") {
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    setLayoutResizing(true);
    updateLayoutSplit(event.clientX);
  };

  const moveLayoutResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!layoutResizing) return;
    event.preventDefault();
    updateLayoutSplit(event.clientX);
  };

  const stopLayoutResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!layoutResizing) return;
    if (
      typeof event.currentTarget.hasPointerCapture === "function" &&
      event.currentTarget.hasPointerCapture(event.pointerId)
    ) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setLayoutResizing(false);
  };

  useEffect(() => {
    const media = window.matchMedia(COMPACT_LAYOUT_QUERY);
    const updateLayoutMode = (event: MediaQueryListEvent) => {
      setCompactLayout(event.matches);
      setLayoutResizing(false);
      if (!event.matches) setConnectionOpen(false);
    };
    media.addEventListener("change", updateLayoutMode);
    return () => media.removeEventListener("change", updateLayoutMode);
  }, []);

  useEffect(() => {
    if (compactLayout) return;
    try {
      localStorage.setItem(LAYOUT_SPLIT_KEY, layoutSplit.toString());
    } catch {
      // The adjusted layout still applies for this session when storage is unavailable.
    }
  }, [compactLayout, layoutSplit]);

  useEffect(() => {
    if (!compactLayout || !connectionOpen || !endpointEditor) return;
    const frame = requestAnimationFrame(() => {
      endpointEditorRef.current?.scrollIntoView({ block: "nearest" });
    });
    return () => cancelAnimationFrame(frame);
  }, [compactLayout, connectionOpen, endpointEditor]);

  return {
    appContentRef,
    endpointEditorRef,
    compactLayout,
    layoutSplit,
    layoutResizing,
    connectionOpen,
    setConnectionOpen,
    setLayoutSplit,
    startLayoutResize,
    moveLayoutResize,
    stopLayoutResize
  };
}

export function ConnectionShell({
  compact,
  open,
  busy,
  status,
  summaryLabel,
  summaryValue,
  configureLabel,
  stopLabel,
  onOpenChange,
  onStop,
  onNestedEscape,
  children
}: {
  compact: boolean;
  open: boolean;
  busy: boolean;
  status: SpeedStateEvent["phase"];
  summaryLabel: string;
  summaryValue: string;
  configureLabel: string;
  stopLabel: string;
  onOpenChange: (open: boolean) => void;
  onStop: () => void;
  onNestedEscape: () => boolean;
  children: ReactNode;
}) {
  if (!compact) return <aside className="connection-column">{children}</aside>;

  return (
    <div className="command-bar" aria-label={configureLabel}>
      <div className="command-endpoint">
        <span className={`command-status phase-${status}`} aria-hidden="true" />
        <div>
          <span>{summaryLabel}</span>
          <strong>{summaryValue}</strong>
        </div>
      </div>
      <div className="command-actions">
        <button
          type="button"
          className="command-stop"
          onClick={onStop}
          disabled={!busy}
          aria-label={stopLabel}
          title={stopLabel}
        >
          <Square size={14} fill="currentColor" aria-hidden="true" />
        </button>
        <Dialog.Root open={open} onOpenChange={onOpenChange}>
          <Dialog.Trigger asChild>
            <button type="button" className="configure-trigger">
              <Settings2 size={15} aria-hidden="true" />
              {configureLabel}
            </button>
          </Dialog.Trigger>
          <Dialog.Portal>
            <Dialog.Overlay className="connection-drawer-overlay" />
            <Dialog.Content
              className="connection-drawer"
              onEscapeKeyDown={(event) => {
                if (!onNestedEscape()) return;
                event.preventDefault();
              }}
            >
              {children}
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      </div>
    </div>
  );
}

export function LayoutResizer({
  value,
  label,
  help,
  setValue,
  onPointerDown,
  onPointerMove,
  onPointerUp
}: {
  value: number;
  label: string;
  help: string;
  setValue: Dispatch<SetStateAction<number>>;
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => void;
}) {
  return (
    <div
      className="layout-resizer"
      role="separator"
      tabIndex={0}
      aria-label={label}
      aria-orientation="vertical"
      aria-valuemin={Math.round(MIN_LAYOUT_SPLIT * 100)}
      aria-valuemax={Math.round(MAX_LAYOUT_SPLIT * 100)}
      aria-valuenow={Math.round(value * 100)}
      title={help}
      onDoubleClick={() => setValue(DEFAULT_LAYOUT_SPLIT)}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={(event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault();
        const direction = event.key === "ArrowLeft" ? -1 : 1;
        setValue((current) =>
          Math.min(MAX_LAYOUT_SPLIT, Math.max(MIN_LAYOUT_SPLIT, current + direction * 0.02))
        );
      }}
    >
      <GripVertical size={15} aria-hidden="true" />
    </div>
  );
}
