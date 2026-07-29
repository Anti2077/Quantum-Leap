import { describe, expect, it } from "vitest";
import type { SpeedSample } from "../../lib/types";
import { SAMPLE_HISTORY_LIMIT } from "./results-model";
import { speedSessionReducer, type SpeedSessionState } from "./session-reducer";

const initialState: SpeedSessionState = {
  samples: [],
  latest: null,
  prompt: null,
  status: { phase: "idle", message: "idle" },
  lastGood: {}
};

function sample(index: number, bandwidthBps = index + 1): SpeedSample {
  return {
    elapsed: index,
    bandwidthBps,
    bytes: index * 100,
    direction: "upload"
  };
}

describe("speed test session reducer", () => {
  it("caps sample history and retains the latest usable rate", () => {
    let state = initialState;
    for (let index = 0; index < SAMPLE_HISTORY_LIMIT + 5; index += 1) {
      state = speedSessionReducer(state, { type: "sampleReceived", sample: sample(index) });
    }
    state = speedSessionReducer(state, {
      type: "sampleReceived",
      sample: { ...sample(999), bandwidthBps: 0 }
    });

    expect(state.samples).toHaveLength(SAMPLE_HISTORY_LIMIT);
    expect(state.samples[0].t).toBe(5);
    expect(state.latest).toMatchObject({ elapsed: 999, bandwidthBps: SAMPLE_HISTORY_LIMIT + 5 });
  });

  it("moves prompts into confirming and resets transient result state", () => {
    const withPrompt = speedSessionReducer(initialState, {
      type: "promptReceived",
      prompt: { kind: "existingServer", title: "Confirm", message: "Reuse" }
    });
    const withSample = speedSessionReducer(withPrompt, { type: "sampleReceived", sample: sample(1) });
    const reset = speedSessionReducer(withSample, { type: "reset" });

    expect(withPrompt.status).toEqual({ phase: "confirming", message: "Confirm" });
    expect(reset).toMatchObject({ samples: [], latest: null, prompt: null, lastGood: {} });
    expect(reset.status).toEqual(withPrompt.status);
  });
});
