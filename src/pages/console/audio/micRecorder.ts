/**
 * Browser microphone capture for the Atlas Voice Console.
 *
 * This module is the ONLY place that touches `getUserMedia` / `MediaRecorder`
 * / `AudioContext`. It captures a clip locally and hands back a plain Blob — it
 * never uploads anything, never knows about HAL/TRON, and never talks to the
 * Atlas Voice Gateway. Uploading is the gateway client's job; the console only
 * ever speaks to the gateway, never to an agent or Ollama directly.
 *
 * Every failure is translated into a typed `MicError` so the UI can render a
 * specific, honest message instead of a generic "something went wrong". It also
 * derives a live input level and a near-silence flag from the SAME stream so a
 * silent clip or a muted/wrong device is caught BEFORE anything is uploaded.
 * No raw audio is ever retained for diagnostics — only a numeric level.
 */

/** Why a capture attempt failed. Drives the console error banner. */
export type MicErrorKind =
  | "unsupported"
  | "permission-denied"
  | "no-device"
  | "device-error"
  | "empty"
  | "silent"
  | "device-muted"
  | "failure";

/** Live/degraded state of the captured audio track. */
export type MicTrackState = "live" | "muted" | "ended" | "unknown";

/** A captured recording ready to be uploaded. */
export interface RecordedClip {
  blob: Blob;
  mimeType: string;
  durationMs: number;
  /** Safe, human-readable input device name (never a raw device id). */
  deviceLabel: string;
  /** Peak RMS (0..1) observed while recording — used to screen silent clips. */
  peakLevel: number;
  /** Track state captured at the instant recording stopped. */
  trackState: MicTrackState;
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
 * Peak RMS below which a clip is treated as silent. The gateway's own silence
 * screen uses a comparable threshold on the decoded WAV; catching it here saves
 * a pointless upload and gives the operator an immediate, specific message.
 */
const MIC_SILENCE_PEAK_RMS = 0.012;

/** How often the input level is sampled from the analyser, in milliseconds. */
const LEVEL_SAMPLE_INTERVAL_MS = 90;

/** Longest device label we ever surface in diagnostics. */
const MAX_DEVICE_LABEL = 64;

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

/** Resolve the browser AudioContext constructor, tolerating the legacy prefix. */
const getAudioContextCtor = (): typeof AudioContext | undefined => {
  if (typeof window === "undefined") return undefined;
  const legacy = (window as Window & { webkitAudioContext?: typeof AudioContext })
    .webkitAudioContext;
  return window.AudioContext ?? legacy;
};

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

/** Build a safe, bounded display label for the active input device. */
const describeDevice = (stream: MediaStream): string => {
  const track = stream.getAudioTracks()[0];
  const label = track && typeof track.label === "string" ? track.label.trim() : "";
  const safe = label.replace(/\s+/g, " ").slice(0, MAX_DEVICE_LABEL);
  return safe || "Default input device";
};

/**
 * One-shot microphone recorder.
 *
 * Usage: `await recorder.start()` → user speaks → `await recorder.stop()`.
 * Tracks, the analyser and the AudioContext are always released on stop/cancel
 * so the OS microphone indicator clears and no audio resource is leaked. Call
 * `cancel()` to discard without producing a clip.
 */
export class MicRecorder {
  private stream: MediaStream | null = null;

  private recorder: MediaRecorder | null = null;

  private chunks: Blob[] = [];

  private mimeType = "";

  private startedAt = 0;

  private audioContext: AudioContext | null = null;

  private analyser: AnalyserNode | null = null;

  private levelBuffer: Float32Array | null = null;

  private levelTimer: number | null = null;

  private levelAvailable = false;

  private currentLevel = 0;

  private peakLevel = 0;

  private deviceLabel = "Default input device";

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
    this.deviceLabel = describeDevice(stream);
    this.peakLevel = 0;
    this.currentLevel = 0;

    // Attach the level analyser BEFORE recording so silence is measured from
    // the very first frame. When the analyser cannot run we simply skip the
    // silence screen rather than block a real recording on an unknown value.
    await this.attachAnalyser(stream);

    const preferred = pickRecordingMimeType();

    let recorder: MediaRecorder;
    try {
      recorder = preferred
        ? new MediaRecorder(stream, { mimeType: preferred })
        : new MediaRecorder(stream);
    } catch {
      this.release();
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
      this.release();
      throw new MicError("failure");
    }

    this.recorder = recorder;
    this.startedAt = Date.now();
  }

  /**
   * Finish capturing and return the clip. Throws `MicError("empty")` for a
   * too-short recording, `MicError("silent")` when the input never produced
   * audible sound, or `MicError("device-muted")` when the track was muted and
   * no analyser was available — so nothing useless is ever uploaded.
   */
  async stop(): Promise<RecordedClip> {
    const recorder = this.recorder;
    if (!recorder) throw new MicError("failure", "No active recording.");

    const durationMs = Math.max(0, Date.now() - this.startedAt);
    const trackState = this.getTrackState();
    const peakLevel = this.peakLevel;
    const levelAvailable = this.levelAvailable;
    const deviceLabel = this.deviceLabel;

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
    this.release();

    if (blob.size === 0 || durationMs < MIC_MIN_DURATION_MS) {
      throw new MicError("empty", "The recording was too short to transcribe.");
    }

    if (levelAvailable && peakLevel < MIC_SILENCE_PEAK_RMS) {
      throw new MicError("silent", "The microphone captured no audible sound.");
    }

    if (!levelAvailable && trackState === "muted") {
      throw new MicError("device-muted", "The selected microphone is muted.");
    }

    return { blob, mimeType, durationMs, deviceLabel, peakLevel, trackState };
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
    this.release();
  }

  /* ------------------------------------------------------------ diagnostics */

  /** Current smoothed input level (0..1). Zero when the analyser is absent. */
  sampleLevel(): number {
    return this.levelAvailable ? this.currentLevel : 0;
  }

  /** Peak input level observed since the recording began. */
  getPeakLevel(): number {
    return this.peakLevel;
  }

  /** Safe display name of the active input device. */
  getDeviceLabel(): string {
    return this.deviceLabel;
  }

  /** Whether the browser is capable of capturing and the analyser is live. */
  isLevelAvailable(): boolean {
    return this.levelAvailable;
  }

  /** Live / muted / ended state of the underlying audio track. */
  getTrackState(): MicTrackState {
    const track = this.stream?.getAudioTracks()[0];
    if (!track) return "unknown";
    if (track.readyState === "ended") return "ended";
    if (track.muted) return "muted";
    if (track.readyState === "live") return "live";
    return "unknown";
  }

  /* ---------------------------------------------------------------- internals */

  /** Build the WebAudio graph used purely to measure the input level. */
  private async attachAnalyser(stream: MediaStream): Promise<void> {
    this.levelAvailable = false;
    try {
      const Ctor = getAudioContextCtor();
      if (!Ctor) return;

      const ctx = new Ctor();
      if (ctx.state === "suspended") {
        try {
          await ctx.resume();
        } catch {
          /* resume can reject without a gesture — fall through to the state check */
        }
      }
      // If the context still is not running its samples are all zero, which
      // would look like silence. Treat the analyser as unavailable instead.
      if (ctx.state !== "running") {
        try {
          void ctx.close();
        } catch {
          /* ignore */
        }
        return;
      }

      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.6;
      source.connect(analyser);

      this.audioContext = ctx;
      this.analyser = analyser;
      this.levelBuffer = new Float32Array(analyser.fftSize);
      this.levelAvailable = true;
      this.startLevelSampling();
    } catch {
      this.levelAvailable = false;
    }
  }

  /** Begin sampling the analyser so peak/silence is measured even if tabs hide. */
  private startLevelSampling(): void {
    this.stopLevelSampling();
    this.levelTimer = window.setInterval(() => {
      const rms = this.computeRms();
      this.currentLevel = rms;
      if (rms > this.peakLevel) this.peakLevel = rms;
    }, LEVEL_SAMPLE_INTERVAL_MS);
  }

  private stopLevelSampling(): void {
    if (this.levelTimer !== null) {
      window.clearInterval(this.levelTimer);
      this.levelTimer = null;
    }
  }

  /** Root-mean-square of the most recent analyser frame, in the 0..1 range. */
  private computeRms(): number {
    const analyser = this.analyser;
    const buffer = this.levelBuffer;
    if (!analyser || !buffer) return 0;
    analyser.getFloatTimeDomainData(buffer);
    let sum = 0;
    for (let index = 0; index < buffer.length; index += 1) {
      const sample = buffer[index];
      sum += sample * sample;
    }
    return Math.sqrt(sum / buffer.length);
  }

  /** Tear down every audio resource: analyser, context and media tracks. */
  private release(): void {
    this.stopLevelSampling();
    if (this.analyser) {
      try {
        this.analyser.disconnect();
      } catch {
        /* already disconnected */
      }
      this.analyser = null;
    }
    this.levelBuffer = null;
    const ctx = this.audioContext;
    this.audioContext = null;
    if (ctx) {
      try {
        void ctx.close();
      } catch {
        /* context already closed */
      }
    }
    this.levelAvailable = false;
    this.currentLevel = 0;
    this.releaseTracks();
  }

  /** Stop every underlying media track so the mic indicator is released. */
  private releaseTracks(): void {
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