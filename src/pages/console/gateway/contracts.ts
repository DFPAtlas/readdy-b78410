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

export type ChatResponseStatus = "complete" | "partial" | "error";

export interface ChatResponsePayload {
  requestId: string;
  sessionId: string;
  selectedAgent: AgentId;
  response: string;
  model: string;
  latency: number;
  status: ChatResponseStatus;
}

/* --------------------------------------------------------- WebSocket API */

export type GatewayEventType =
  | "connected"
  | "agent_status"
  | "routing_started"
  | "agent_selected"
  | "transcript_partial"
  | "transcript_final"
  | "agent_thinking"
  | "response_started"
  | "response_delta"
  | "response_complete"
  | "speech_started"
  | "speech_ended"
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
  | "socket-disconnect"
  | "request-cancelled"
  | "agent-unavailable"
  | "routing-failure";

export const GATEWAY_ERROR_LABELS: Record<GatewayErrorKind, string> = {
  "not-configured": "Voice Gateway not configured",
  unreachable: "Voice Gateway unreachable",
  timeout: "Gateway request timed out",
  "malformed-response": "Malformed gateway response",
  "socket-disconnect": "Live event stream disconnected",
  "request-cancelled": "Request cancelled",
  "agent-unavailable": "Agent unavailable",
  "routing-failure": "Routing failed",
};

export const GATEWAY_ERROR_HINTS: Record<GatewayErrorKind, string> = {
  "not-configured":
    "Set VITE_ATLAS_VOICE_GATEWAY_URL to enable live mode. Demo mode stays available.",
  unreachable:
    "The console could not reach the Atlas Voice Gateway. Check the host and try again.",
  timeout: "No response arrived inside the expected window.",
  "malformed-response": "The gateway returned a payload the console could not read.",
  "socket-disconnect": "The live event stream dropped. The conversation is preserved.",
  "request-cancelled": "The in-flight request was cancelled locally.",
  "agent-unavailable": "The selected agent could not take the request.",
  "routing-failure": "The router could not decide which agent should answer.",
};

export interface GatewayErrorInfo {
  kind: GatewayErrorKind;
  message: string;
}