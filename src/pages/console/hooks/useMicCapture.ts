import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  MicError,
  MicRecorder,
  isCaptureSupported,
  type RecordedClip,
} from "@/pages/console/audio/micRecorder";

/** Coarse microphone lifecycle state for the UI. */
export type MicCaptureStatus = "idle" | "requesting" | "recording";

/** Result of a start/stop attempt — never throws, always reports. */
export interface MicCaptureResult {
  ok: boolean;
  clip?: RecordedClip;
  error?: MicError;
}

export interface MicCaptureApi {
  /** Whether this browser can capture audio at all. */
  supported: boolean;
  status: MicCaptureStatus;
  start: () => Promise<MicCaptureResult>;
  stop: () => Promise<MicCaptureResult>;
  cancel: () => void;
}

/**
 * React wrapper around {@link MicRecorder}.
 *
 * Keeps the recorder out of component state (it is mutable and not renderable),
 * exposes a small async API, and guarantees the microphone is released on
 * unmount so navigating away never leaves the OS mic indicator stuck on.
 */
export function useMicCapture(): MicCaptureApi {
  const recorderRef = useRef<MicRecorder | null>(null);
  const [status, setStatus] = useState<MicCaptureStatus>("idle");
  const supported = useMemo(() => isCaptureSupported(), []);

  useEffect(
    () => () => {
      recorderRef.current?.cancel();
      recorderRef.current = null;
    },
    [],
  );

  const start = useCallback(async (): Promise<MicCaptureResult> => {
    if (!supported) return { ok: false, error: new MicError("unsupported") };
    if (recorderRef.current) return { ok: true };

    const recorder = new MicRecorder();
    setStatus("requesting");
    try {
      await recorder.start();
    } catch (error) {
      setStatus("idle");
      return { ok: false, error: error instanceof MicError ? error : new MicError("failure") };
    }
    recorderRef.current = recorder;
    setStatus("recording");
    return { ok: true };
  }, [supported]);

  const stop = useCallback(async (): Promise<MicCaptureResult> => {
    const recorder = recorderRef.current;
    recorderRef.current = null;
    setStatus("idle");
    if (!recorder) return { ok: false, error: new MicError("failure", "No active recording.") };
    try {
      const clip = await recorder.stop();
      return { ok: true, clip };
    } catch (error) {
      return { ok: false, error: error instanceof MicError ? error : new MicError("failure") };
    }
  }, []);

  const cancel = useCallback(() => {
    recorderRef.current?.cancel();
    recorderRef.current = null;
    setStatus("idle");
  }, []);

  return useMemo(
    () => ({ supported, status, start, stop, cancel }),
    [supported, status, start, stop, cancel],
  );
}