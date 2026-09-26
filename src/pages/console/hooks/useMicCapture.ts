import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  MicError,
  MicRecorder,
  isCaptureSupported,
  type MicTrackState,
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

/**
 * Frontend-safe microphone diagnostics for the Developer Diagnostics panel.
 * Contains NO raw audio — only numeric/level metadata.
 */
export interface MicCaptureDiagnostics {
  deviceLabel: string;
  durationMs: number;
  clipSizeBytes: number | null;
  trackState: MicTrackState;
  peakLevel: number;
  levelAvailable: boolean;
}

export const EMPTY_MIC_DIAGNOSTICS: MicCaptureDiagnostics = {
  deviceLabel: "—",
  durationMs: 0,
  clipSizeBytes: null,
  trackState: "unknown",
  peakLevel: 0,
  levelAvailable: false,
};

export interface MicCaptureApi {
  /** Whether this browser can capture audio at all. */
  supported: boolean;
  status: MicCaptureStatus;
  /** Live input level (0..1) while recording — drives the meter. */
  level: number;
  /** Live microphone diagnostics (device, duration, size, track state). */
  diagnostics: MicCaptureDiagnostics;
  start: () => Promise<MicCaptureResult>;
  stop: () => Promise<MicCaptureResult>;
  cancel: () => void;
}

/** How often the meter/diagnostics are pushed into React state, in ms. */
const UI_SAMPLE_INTERVAL_MS = 90;

/**
 * React wrapper around {@link MicRecorder}.
 *
 * Keeps the recorder out of component state (it is mutable and not renderable),
 * exposes a small async API plus a live level + diagnostics feed, and guarantees
 * the microphone, analyser and AudioContext are released on unmount so
 * navigating away never leaves the OS mic indicator stuck on.
 */
export function useMicCapture(): MicCaptureApi {
  const recorderRef = useRef<MicRecorder | null>(null);
  const [status, setStatus] = useState<MicCaptureStatus>("idle");
  const [level, setLevel] = useState(0);
  const [diagnostics, setDiagnostics] = useState<MicCaptureDiagnostics>(EMPTY_MIC_DIAGNOSTICS);
  const frameRef = useRef<number | null>(null);
  const lastSampleRef = useRef(0);
  const startedAtRef = useRef(0);
  const supported = useMemo(() => isCaptureSupported(), []);

  const stopLoop = useCallback(() => {
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
  }, []);

  const tick = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder) {
      stopLoop();
      return;
    }
    const now = performance.now();
    if (now - lastSampleRef.current >= UI_SAMPLE_INTERVAL_MS) {
      lastSampleRef.current = now;
      setLevel(recorder.sampleLevel());
      setDiagnostics((prev) => ({
        ...prev,
        deviceLabel: recorder.getDeviceLabel(),
        durationMs: startedAtRef.current ? Date.now() - startedAtRef.current : prev.durationMs,
        trackState: recorder.getTrackState(),
        peakLevel: recorder.getPeakLevel(),
        levelAvailable: recorder.isLevelAvailable(),
      }));
    }
    frameRef.current = requestAnimationFrame(tick);
  }, [stopLoop]);

  const startLoop = useCallback(() => {
    stopLoop();
    lastSampleRef.current = 0;
    frameRef.current = requestAnimationFrame(tick);
  }, [stopLoop, tick]);

  useEffect(
    () => () => {
      recorderRef.current?.cancel();
      recorderRef.current = null;
      stopLoop();
    },
    [stopLoop],
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
    startedAtRef.current = Date.now();
    setLevel(0);
    setDiagnostics({
      deviceLabel: recorder.getDeviceLabel(),
      durationMs: 0,
      clipSizeBytes: null,
      trackState: recorder.getTrackState(),
      peakLevel: 0,
      levelAvailable: recorder.isLevelAvailable(),
    });
    startLoop();
    return { ok: true };
  }, [startLoop, supported]);

  const stop = useCallback(async (): Promise<MicCaptureResult> => {
    const recorder = recorderRef.current;
    recorderRef.current = null;
    setStatus("idle");
    stopLoop();
    setLevel(0);
    if (!recorder) return { ok: false, error: new MicError("failure", "No active recording.") };
    try {
      const clip = await recorder.stop();
      setDiagnostics((prev) => ({
        ...prev,
        deviceLabel: clip.deviceLabel || prev.deviceLabel,
        durationMs: clip.durationMs,
        clipSizeBytes: clip.blob.size,
        trackState: clip.trackState,
        peakLevel: clip.peakLevel,
      }));
      return { ok: true, clip };
    } catch (error) {
      return { ok: false, error: error instanceof MicError ? error : new MicError("failure") };
    }
  }, [stopLoop]);

  const cancel = useCallback(() => {
    recorderRef.current?.cancel();
    recorderRef.current = null;
    stopLoop();
    setStatus("idle");
    setLevel(0);
    setDiagnostics(EMPTY_MIC_DIAGNOSTICS);
  }, [stopLoop]);

  return useMemo(
    () => ({ supported, status, level, diagnostics, start, stop, cancel }),
    [supported, status, level, diagnostics, start, stop, cancel],
  );
}