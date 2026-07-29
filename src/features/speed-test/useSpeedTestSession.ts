import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useReducer, type Dispatch, type SetStateAction } from "react";
import type { SpeedPromptEvent, SpeedSample, SpeedStateEvent } from "../../lib/types";
import {
  speedSessionReducer,
  type SpeedSessionAction,
  type SpeedSessionState
} from "./session-reducer";

export interface SpeedTestSessionController extends SpeedSessionState {
  dispatch: Dispatch<SpeedSessionAction>;
  setStatus: Dispatch<SetStateAction<SpeedStateEvent>>;
  reset: () => void;
  dismissPrompt: () => void;
}

export function useSpeedTestSession(initialState: () => SpeedSessionState): SpeedTestSessionController {
  const [state, dispatch] = useReducer(speedSessionReducer, undefined, initialState);

  useEffect(() => {
    let mounted = true;
    const unlisteners: Array<() => void> = [];
    const register = <T,>(eventName: string, action: (payload: T) => SpeedSessionAction) => {
      void listen<T>(eventName, (event) => {
        if (mounted) dispatch(action(event.payload));
      })
        .then((unlisten) => {
          if (mounted) unlisteners.push(unlisten);
          else unlisten();
        })
        .catch(() => undefined);
    };

    register<SpeedSample>("speed://sample", (sample) => ({ type: "sampleReceived", sample }));
    register<SpeedStateEvent>("speed://state", (status) => ({ type: "stateReceived", status }));
    register<SpeedPromptEvent>("speed://prompt", (prompt) => ({ type: "promptReceived", prompt }));

    return () => {
      mounted = false;
      unlisteners.forEach((dispose) => dispose());
    };
  }, []);

  const setStatus = useCallback<Dispatch<SetStateAction<SpeedStateEvent>>>((next) => {
    if (typeof next === "function") {
      dispatch({ type: "updateStatus", update: next });
    } else {
      dispatch({ type: "replaceStatus", status: next });
    }
  }, []);
  const reset = useCallback(() => dispatch({ type: "reset" }), []);
  const dismissPrompt = useCallback(() => dispatch({ type: "dismissPrompt" }), []);

  return { ...state, dispatch, setStatus, reset, dismissPrompt };
}
