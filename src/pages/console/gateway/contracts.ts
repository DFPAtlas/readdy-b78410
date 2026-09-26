import type { AgentId, RoutingMode } from "@/pages/console/types";

/**
 * Frontend contract for the "Atlas Voice Gateway".
 *
 * The console talks ONLY to the gateway (never directly to HAL / TRON). These
 * types describe the shapes the frontend expects. They are a *frontend*
 * contract: the gateway that implements them is supplied later.
 */

/* ------------------------------------------------------------------ modes */

export type GatewayMode = "live" | "demo" | "offline";

/** The operator's requested mode. OFFline is a derived state, not a choice. */
export type GatewayPreference = "live" | "demo";

export const GATEWAY_MODE_LABELS: Record<GatewayMode, string> = {
  live: "Live",
  demo: "Demo",
  offline: "Offline",
};

export const GATEWAY_MODE_HINTS: Record<GatewayMode, string> = {
  live: "Routing through the Atlas Voice Gateway",
  demo: "Local simulation only · no network calls",
  offline: "Gateway unavailable · live send disabled",
};

/* ------------------------------------------------------------- connection */

export type GatewayConnectionState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "degraded"
  | "error";

export const GATEWAY_CONNECTION_LABELS: Record<GatewayConnectionState, string> = {
  disconnected: "Disconnected",
  connecting: "Connecting",
  connected: "Connected",
  reconnecting: "Reconnecting...",
  degraded: "Degraded",
  error: "Offline",
};

export type GatewaySocketState = "closed" | "opening" | "open" | "closing";

/* --------------------------------------------------------------- HTTP API */

/** POST /api/chat — one complete text interaction. */
export interface ChatRequestPayload {
  sessionId: string;
  message: string;
  routingMode: RoutingMode;
  preferredAgent: AgentId | null;
}

export type ChatResponseStatus = "complete" | "partial" | "interrupted" | "error";

export interface ChatResponsePayload {
  requestId: string;
  sessionId: string;
  selectedAgent: AgentId;
  response: string;
  model: string;
  latency: number;
  status: ChatResponseStatus;
}

/* ------------------------------------------------------------- voice API */

/** Lifecycle result reported by `POST /api/voice`. */
export type VoiceResponseStatus = "complete" | "no_speech_detected" | "partial" | "error";

/**
 * Successful body of `POST /api/voice` (multipart upload).
 *
 * The gateway transcribes the clip, routes the transcript through the SAME
 * pipeline as `/api/chat`, and returns the transcript plus the routed reply in
 * one round-trip. Speech fields are present because the gateway also
 * synthesizes the reply — the console does not play them yet, so they are
 * carried but unused.
 */
export interface VoiceResponsePayload {
  requestId: string | null;
  sessionId: string;
  selectedAgent: AgentId | null;
  transcript: string;
  language: string | null;
  duration: number | null;
  processingTime: number | null;
  response: string;
  model: string;
  latency: number;
  status: VoiceResponseStatus;
  sttModel: string | null;
  speechStatus: string | null;
  audioRef: string | null;
  audioContentType: string | null;
  speechDurationMs: number | null;
  selectedVoiceId: string | null;
}

/* --------------------------------------------------------- speech playback */

/**
 * Playback acknowledgement states accepted by the gateway's
 * `POST /api/speech/{requestId}/playback`.
 *
 * The gateway never fabricates `speech_started` on its own — it only knows the
 * audio is *ready*. `started`/`ended` confirm real playback; `stopped` is the
 * confirmed cancellation mechanism that also drops the audio resource.
 */
export type SpeechPlaybackState = "started" | "ended" | "stopped";

/** Body of `POST /api/speech/{requestId}/playback`. */
export interface PlaybackReportPayload {
  state: SpeechPlaybackState;
  sessionId?: string;
  /** Gateway agent id (`atlas-hal` / `atlas-tron`). */
  agent?: string;
}

/* --------------------------------------------------------- WebSocket API */

export type GatewayEventType =
  | "connected"
  | "agent_status"
  | "routing_started"
  | "agent_selected"
  | "audio_received"
  | "transcription_started"
  | "transcription_failed"
  | "transcript_partial"
  | "transcript_final"
  | "agent_thinking"
  | "response_started"
  | "response_delta"
  | "response_complete"
  | "speech_synthesis_started"
  | "speech_ready"
  | "speech_started"
  | "speech_ended"
  | "speech_cancelled"
  | "speech_failed"
  | "handoff"
  | "activity"
  | "error"
  | "heartbeat";

/** Latest health values for a single agent. Missing fields render as Unknown. */
export interface AgentStatusPayload {
  agent: AgentId;
  online?: boolean;
  busy?: boolean;
  model?: string;
  gpuUsage?: number;
  ramUsage?: number;
  voiceReady?: boolean;
  ragReady?: boolean;
  n8nReady?: boolean;
  latency?: number;
}

/**
 * A single inbound gateway event. One loose shape covers every category so the
 * frontend router can handle new event types without new plumbing.
 */
export interface GatewayEvent {
  type: GatewayEventType;
  requestId?: string;
  sessionId?: string;
  agent?: AgentId;
  text?: string;
  delta?: string;
  message?: string;
  /** Machine-readable failure code (e.g. `no_speech_detected`, `stt_busy`). */
  code?: string;
  label?: string;
  detail?: string;
  status?: string;
  model?: string;
  latency?: number;
  intent?: string;
  handoff?: { from: AgentId; to: AgentId };
  agentStatus?: AgentStatusPayload;
  agentStatuses?: AgentStatusPayload[];
  timestamp?: string;
}

/* ----------------------------------------------------------------- errors */

export type GatewayErrorKind =
  | "not-configured"
  | "unreachable"
  | "timeout"
  | "malformed-response"
  | "unknown-agent"
  | "socket-disconnect"
  | "request-cancelled"
  | "agent-unavailable"
  | "routing-failure"
  | "unsupported-audio"
  | "audio-too-large"
  | "audio-too-short"
  | "audio-conversion"
  | "stt-failure"
  | "stt-unavailable"
  | "no-speech"
  | "agent-busy"
  | "speech-expired"
  | "voice-failure";

export const GATEWAY_ERROR_LABELS: Record<GatewayErrorKind, string> = {
  "not-configured": "Voice Gateway not configured",
  unreachable: "Voice Gateway unreachable",
  timeout: "Gateway request timed out",
  "malformed-response": "Malformed gateway response",
  "unknown-agent": "Unrecognised agent id from gateway",
  "socket-disconnect": "Live event stream disconnected",
  "request-cancelled": "Request cancelled",
  "agent-unavailable": "Agent unavailable",
  "routing-failure": "Routing failed",
  "unsupported-audio": "Unsupported audio",
  "audio-too-large": "Recording too large",
  "audio-too-short": "Recording too short",
  "audio-conversion": "Audio conversion failed",
  "stt-failure": "Speech recognition failed",
  "stt-unavailable": "Speech recognition unavailable",
  "no-speech": "No speech detected",
  "agent-busy": "Agents busy",
  "speech-expired": "Voice clip unavailable",
  "voice-failure": "Voice processing failed",
};

export const GATEWAY_ERROR_HINTS: Record<GatewayErrorKind, string> = {
  "not-configured":
    "Set VITE_PUBLIC_ATLAS_VOICE_GATEWAY_URL to enable live mode. Demo mode stays available.",
  unreachable:
    "The console could not reach the Atlas Voice Gateway. Check the host and try again.",
  timeout: "No response arrived inside the expected window.",
  "malformed-response": "The gateway returned a payload the console could not read.",
  "unknown-agent":
    "The gateway returned an agent id the console does not recognise, so no reply was shown. Expected atlas-hal or atlas-tron.",
  "socket-disconnect": "The live event stream dropped. The conversation is preserved.",
  "request-cancelled": "The in-flight request was cancelled locally.",
  "agent-unavailable": "The selected agent could not take the request.",
  "routing-failure": "The router could not decide which agent should answer.",
  "unsupported-audio": "This browser produced an audio format the gateway cannot decode. Try another browser.",
  "audio-too-large": "The clip exceeded the gateway's size or duration limit. Keep recordings shorter.",
  "audio-too-short": "The clip was too short to transcribe. Hold the mic while you speak.",
  "audio-conversion": "The gateway could not decode the uploaded audio into the format speech recognition needs.",
  "stt-failure": "The gateway's speech-to-text step failed while processing this clip.",
  "stt-unavailable": "Speech recognition is not available on the gateway right now.",
  "no-speech": "Nothing was recognised in the clip, so no agent was asked to respond.",
  "agent-busy": "The gateway is handling as many requests as it allows. Try again shortly.",
  "speech-expired":
    "The synthesized clip was no longer available when the console tried to play it. The text reply is intact.",
  "voice-failure": "The gateway could not process the voice request. No reply was fabricated.",
};

export interface GatewayErrorInfo {
  kind: GatewayErrorKind;
  /** Safe, human-readable message — the gateway's own message when supplied. */
  message: string;
  /** The gateway's machine-readable error code, when one was returned. */
  code?: string;
}