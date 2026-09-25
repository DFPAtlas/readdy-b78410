/**
 * Browser microphone capture for the Atlas Voice Console.
 *
 * This module is the ONLY place that touches `getUserMedia` / `MediaRecorder`.
 * It captures a clip locally and hands back a plain Blob — it never uploads
 * anything, never knows about HAL/TRON, and never talks to the Atlas Voice
 * Gateway. Uploading is the gateway client's job; the console only ever speaks
 * to the gateway, never to an agent or Ollama directly.
 *
 * Every failure is translated into a typed `MicError` so the UI can render a
 * specific, honest message instead of a generic "something went wrong".
 */

/** Why a capture attempt failed. Drives the console error banner. */
export type MicErrorKind =
  | "unsupported"
  | "permission-denied"
  | "no-device"
  | "device-error"
  | "empty"
  | "failure";

/** A captured recording ready to be uploaded. */
export interface RecordedClip {
  blob: Blob;
  mimeType: string;
  durationMs: number;
}

/** Typed, stack-trace-free capture failure raised by this module. */
export class MicError extends Error {
  readonly kind: MicErrorKind;

  readonly detail: string;

  constructor(kind: MicErrorKind, detail = "") {
    super(detail || kind);
    this.name = "MicError";
    this.kind = kind;
    this.detail = detail;
  }
}

/**
 * Minimum useful capture length. Anything shorter is treated as an empty/tapped
 * recording rather than sent to the gateway (the backend rejects < 300 ms too).
 */
export const MIC_MIN_DURATION_MS = 350;

/**
 * Candidate container/codecs in preference order. WebM/Opus is what most
 * browsers produce and what the gateway decodes; Safari falls back to MP4.
 */
const MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/ogg",
  "audio/mp4",
  "audio/mpeg",
];

/** File extension to attach to the multipart part for a given mime type. */
export const extensionForMimeType = (mimeType: string): string => {
  const value = (mimeType || "").toLowerCase();
  if (value.includes("webm")) return "webm";
  if (value.includes("ogg") || value.includes("opus")) return "ogg";
  if (value.includes("mp4") || value.includes("m4a")) return "m4a";
  if (value.includes("mpeg") || value.includes("mp3")) return "mp3";
  if (value.includes("wav")) return "wav";
  return "webm";
};

/** True when this browser can capture microphone audio at all. */
export const isCaptureSupported = (): boolean =>
  typeof window !== "undefined" &&
  typeof window.MediaRecorder !== "undefined" &&
  typeof navigator !== "undefined" &&
  typeof navigator.mediaDevices?.getUserMedia === "function";

/**
 * Pick a recording mime type the browser actually supports.
 *
 * Returns an empty string when no explicit type is supported — in that case the
 * browser's own default container is used, which is still valid to upload.
 */
export const pickRecordingMimeType = (): string => {
  if (typeof window === "undefined" || typeof window.MediaRecorder === "undefined") return "";
  for (const candidate of MIME_CANDIDATES) {
    try {
      if (MediaRecorder.isTypeSupported(candidate)) return candidate;
    } catch {
      /* isTypeSupported can throw on odd builds — ignore and try the next */
    }
  }
  return "";
};

/** Map a `getUserMedia` rejection to a typed capture error. */
const mapPermissionError = (error: unknown): MicErrorKind => {
  const name = (error as { name?: string } | null)?.name ?? "";
  if (name === "NotAllowedError" || name === "PermissionDeniedError" || name === "SecurityError") {
    return "permission-denied";
  }
  if (
    name === "NotFoundError" ||
    name === "DevicesNotFoundError" ||
    name === "OverconstrainedError"
  ) {
    return "no-device";
  }
  if (name === "NotReadableError" || name === "TrackStartError") return "device-error";
  return "failure";
};

/**
 * One-shot microphone recorder.
 *
 * Usage: `await recorder.start()` → user speaks → `await recorder.stop()`.
 * Tracks are always released on stop/cancel so the OS microphone indicator
 * clears. Call `cancel()` to discard without producing a clip.
 */
export class MicRecorder {
  private stream: MediaStream | null = null;

  private recorder: MediaRecorder | null = null;

  private chunks: Blob[] = [];

  private mimeType = "";

  private startedAt = 0;

  /** Whether a capture is currently in progress. */
  get active(): boolean {
    return this.recorder !== null;
  }

  /** Begin capturing. Throws a typed `MicError` on any failure. */
  async start(): Promise<void> {
    if (!isCaptureSupported()) throw new MicError("unsupported");
    if (this.recorder) return;

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    } catch (error) {
      throw new MicError(mapPermissionError(error));
    }

    this.stream = stream;
    const preferred = pickRecordingMimeType();

    let recorder: MediaRecorder;
    try {
      recorder = preferred
        ? new MediaRecorder(stream, { mimeType: preferred })
        : new MediaRecorder(stream);
    } catch {
      this.releaseStream();
      throw new MicError("unsupported");
    }

    this.chunks = [];
    this.mimeType = recorder.mimeType || preferred || "audio/webm";
    recorder.ondataavailable = (event: BlobEvent) => {
      if (event.data && event.data.size > 0) this.chunks.push(event.data);
    };

    try {
      recorder.start();
    } catch {
      this.releaseStream();
      throw new MicError("failure");
    }

    this.recorder = recorder;
    this.startedAt = Date.now();
  }

  /**
   * Finish capturing and return the clip. Throws `MicError("empty")` when the
   * recording is silent/too short so no nonsense is ever uploaded.
   */
  async stop(): Promise<RecordedClip> {
    const recorder = this.recorder;
    if (!recorder) throw new MicError("failure", "No active recording.");

    const durationMs = Math.max(0, Date.now() - this.startedAt);

    const blob = await new Promise<Blob>((resolve) => {
      const finalise = () => {
        resolve(new Blob(this.chunks, { type: this.mimeType || "audio/webm" }));
      };
      recorder.onstop = finalise;
      try {
        recorder.stop();
      } catch {
        finalise();
      }
    });

    this.recorder = null;
    const mimeType = blob.type || this.mimeType;
    this.releaseStream();

    if (blob.size === 0 || durationMs < MIC_MIN_DURATION_MS) {
      throw new MicError("empty", "The recording was too short to transcribe.");
    }

    return { blob, mimeType, durationMs };
  }

  /** Abort the current capture, discarding any audio and releasing the mic. */
  cancel(): void {
    const recorder = this.recorder;
    this.recorder = null;
    if (recorder) {
      try {
        recorder.ondataavailable = null;
        recorder.onstop = null;
        if (recorder.state !== "inactive") recorder.stop();
      } catch {
        /* recorder already torn down */
      }
    }
    this.chunks = [];
    this.releaseStream();
  }

  /** Stop every underlying media track so the mic indicator is released. */
  private releaseStream(): void {
    if (!this.stream) return;
    this.stream.getTracks().forEach((track) => {
      try {
        track.stop();
      } catch {
        /* track already ended */
      }
    });
    this.stream = null;
  }
}