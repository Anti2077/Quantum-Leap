import type {
  SpeedPromptEvent,
  SpeedSample,
  SpeedStateEvent,
  SpeedSummary,
  TransferDirection
} from "../../lib/types";
import { appendSample, type SamplePoint } from "./results-model";

export interface SpeedSessionState {
  samples: SamplePoint[];
  latest: SpeedSample | null;
  prompt: SpeedPromptEvent | null;
  status: SpeedStateEvent;
  lastGood: Partial<Record<TransferDirection, SpeedSample>>;
  summaries: Partial<Record<TransferDirection, SpeedSummary>>;
}

export type SpeedSessionAction =
  | { type: "sampleReceived"; sample: SpeedSample }
  | { type: "summaryReceived"; summary: SpeedSummary }
  | { type: "stateReceived"; status: SpeedStateEvent }
  | { type: "promptReceived"; prompt: SpeedPromptEvent }
  | { type: "reset" }
  | { type: "dismissPrompt" }
  | { type: "replaceStatus"; status: SpeedStateEvent }
  | { type: "updateStatus"; update: (status: SpeedStateEvent) => SpeedStateEvent };

export function speedSessionReducer(
  state: SpeedSessionState,
  action: SpeedSessionAction
): SpeedSessionState {
  switch (action.type) {
    case "sampleReceived": {
      const sample = action.sample;
      const usableRate = Number.isFinite(sample.bandwidthBps) && sample.bandwidthBps > 0;
      if (!usableRate) {
        const held =
          state.lastGood[sample.direction] ??
          state.lastGood[sample.direction === "upload" ? "download" : "upload"];
        return {
          ...state,
          latest: held ? { ...sample, bandwidthBps: held.bandwidthBps } : sample
        };
      }
      return {
        ...state,
        latest: sample,
        samples: appendSample(state.samples, sample),
        lastGood: { ...state.lastGood, [sample.direction]: sample }
      };
    }
    case "summaryReceived":
      return {
        ...state,
        summaries: { ...state.summaries, [action.summary.direction]: action.summary }
      };
    case "stateReceived":
    case "replaceStatus":
      return { ...state, status: action.status };
    case "updateStatus":
      return { ...state, status: action.update(state.status) };
    case "promptReceived":
      return {
        ...state,
        prompt: action.prompt,
        status: { phase: "confirming", message: action.prompt.title }
      };
    case "reset":
      return { ...state, samples: [], latest: null, prompt: null, lastGood: {}, summaries: {} };
    case "dismissPrompt":
      return { ...state, prompt: null };
  }
}
