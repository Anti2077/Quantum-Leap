import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Event } from "@tauri-apps/api/event";
import type { SpeedSample } from "../../lib/types";
import { useSpeedTestSession } from "./useSpeedTestSession";

const listeners = new Map<string, (event: Event<unknown>) => void>();
const disposers = new Map<string, ReturnType<typeof vi.fn>>();

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (eventName: string, handler: (event: Event<unknown>) => void) => {
    const dispose = vi.fn();
    listeners.set(eventName, handler);
    disposers.set(eventName, dispose);
    return dispose;
  })
}));

describe("useSpeedTestSession", () => {
  beforeEach(() => {
    listeners.clear();
    disposers.clear();
  });

  it("applies backend events and releases every listener on unmount", async () => {
    const { result, unmount } = renderHook(() =>
      useSpeedTestSession(() => ({
        samples: [],
        latest: null,
        prompt: null,
        status: { phase: "idle", message: "idle" },
        lastGood: {}
      }))
    );
    await waitFor(() => expect(listeners.size).toBe(3));

    const sample: SpeedSample = {
      elapsed: 0.5,
      bandwidthBps: 1_000_000,
      bytes: 62_500,
      direction: "download"
    };
    act(() => listeners.get("speed://sample")?.({ payload: sample } as Event<unknown>));
    act(() =>
      listeners.get("speed://state")?.({
        payload: { phase: "running", message: "running" }
      } as Event<unknown>)
    );

    expect(result.current.latest).toEqual(sample);
    expect(result.current.samples).toHaveLength(1);
    expect(result.current.status.phase).toBe("running");

    unmount();
    expect(Array.from(disposers.values()).every((dispose) => dispose.mock.calls.length === 1)).toBe(true);
  });
});
