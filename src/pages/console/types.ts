/**
 * Frontend model + console-specific UI state types.
 *
 * The data shapes (Agent, ChatMessage, ActivityEvent, ConnectionNode...) are
 * defined next to the placeholder data in `src/mocks/console.ts` and re-exported
 * here so every component imports from one place.
 */
export type {
  AgentId,
  AgentStatus,
  HealthState,
  IndicatorTone,
  AgentMetric,
  AgentService,
  Agent,
  MessageSenderType,
  MessageStatus,
  MessageTool,
  ChatMessage,
  ActivityStatus,
  ActivityAgent,
  ActivityEvent,
  ConnectionState,
  ConnectionNode,
} from "@/mocks/console";

/** Which agent a request should go to. AUTO lets the router decide. */
export type RoutingMode = "hal" | "auto" | "tron";

/** Single frontend voice state that drives the microphone area. */
export type VoiceState =
  | "idle"
  | "listening"
  | "transcribing"
  | "routing"
  | "thinking"
  | "hal-speaking"
  | "tron-speaking"
  | "error";

/** Voice failures the UI knows how to render. Frontend-only for now. */
export type VoiceError =
  | "microphone-unavailable"
  | "transcription-failed"
  | "synthesis-failed"
  | "agent-unavailable"
  | "response-timeout"
  | "connection-lost";

export const VOICE_ERROR_LABELS: Record<VoiceError, string> = {
  "microphone-unavailable": "Microphone unavailable",
  "transcription-failed": "Transcription failed",
  "synthesis-failed": "Voice synthesis failed",
  "agent-unavailable": "Agent unavailable",
  "response-timeout": "Response timeout",
  "connection-lost": "Connection lost",
};

export const VOICE_ERROR_HINTS: Record<VoiceError, string> = {
  "microphone-unavailable": "The capture device did not respond. Check the voice gateway link.",
  "transcription-failed": "Speech-to-text returned no usable transcript for this turn.",
  "synthesis-failed": "Voice output could not be generated. The text reply is still available.",
  "agent-unavailable": "The selected agent is not reachable right now.",
  "response-timeout": "No response arrived inside the expected window.",
  "connection-lost": "The console lost its link to the voice gateway.",
};

/**
 * Reusable frontend voice session record. Shaped so a backend can replace the
 * values without any UI change.
 */
export interface VoiceSession {
  sessionId: string;
  mode: RoutingMode;
  targetAgent: "hal" | "tron" | null;
  state: VoiceState;
  partialTranscript: string;
  finalTranscript: string;
  selectedAgent: "hal" | "tron" | null;
  startedAt: number | null;
  responseStartedAt: number | null;
  canInterrupt: boolean;
  error: VoiceError | null;
}

/** Transcript line kinds — partial reads lighter than a confirmed final line. */
export type TranscriptKind = "status" | "partial" | "final" | "agent" | "error";

export interface TranscriptLine {
  id: string;
  kind: TranscriptKind;
  text: string;
  timestamp: string;
}

/** Simulated failover banner shown when an agent cannot take the request. */
export interface FailoverState {
  kind: "agent-unavailable" | "all-offline";
  message: string;
  unavailable: ("hal" | "tron")[];
  suggested: "hal" | "tron" | null;
}

export type ConversationFilter = "all" | "hal" | "tron" | "system";