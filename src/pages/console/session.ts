import type { RoutingMode, VoiceSession, VoiceState } from "@/pages/console/types";

const pad = (value: number) => value.toString().padStart(2, "0");

/** Wall-clock stamp used across the transcript, messages and activity feed. */
export const clockStamp = (date: Date = new Date()) =>
  `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;

/** Every duration used by the local simulation, in milliseconds. */
export const VOICE_TIMINGS = {
  transcribe: 1100,
  route: 700,
  thinkVoice: 900,
  thinkText: 700,
  handoffSpeak: 1900,
  handoffHandover: 900,
  synth: 1200,
  speak: 3400,
  continuousPause: 900,
  continuousListen: 2600,
  tapListen: 1700,
  minListen: 700,
} as const;

/** Fresh voice session record. Display-only until a backend takes it over. */
export const createSession = (sessionId: string, mode: RoutingMode): VoiceSession => ({
  sessionId,
  mode,
  targetAgent: mode === "auto" ? null : mode,
  state: "idle",
  partialTranscript: "",
  finalTranscript: "",
  selectedAgent: null,
  startedAt: null,
  responseStartedAt: null,
  canInterrupt: false,
  error: null,
});

/** The label shown next to the microphone for every voice state. */
export const VOICE_STATE_LABELS: Record<VoiceState, string> = {
  idle: "Ready",
  recording: "Recording...",
  uploading: "Uploading audio...",
  listening: "Listening...",
  transcribing: "Transcribing...",
  routing: "Selecting agent...",
  thinking: "Thinking...",
  "hal-speaking": "HAL is speaking",
  "tron-speaking": "TRON is speaking",
  error: "Voice service unavailable",
};

/** Compact mm:ss duration label for the session header. */
export const formatDuration = (ms: number): string => {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${pad(minutes)}:${pad(seconds)}`;
};