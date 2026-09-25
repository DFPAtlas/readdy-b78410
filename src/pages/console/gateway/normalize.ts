import type { AgentId } from "@/pages/console/types";
import type {
  AgentStatusPayload,
  ChatResponsePayload,
  ChatResponseStatus,
  GatewayEvent,
  GatewayEventType,
  VoiceResponsePayload,
  VoiceResponseStatus,
} from "@/pages/console/gateway/contracts";

/**
 * The single normalization layer at the Atlas Voice Gateway boundary.
 *
 * The gateway speaks its own dialect and the console speaks another:
 *
 *   - Agents are `atlas-hal` / `atlas-tron` on the wire, but `hal` / `tron`
 *     in the console.
 *   - Every WebSocket event carries its values inside a nested `payload`
 *     object (`response_delta.payload.delta`, `transcript_final.payload.transcript`
 *     ...), while the console consumes one flat, typed {@link GatewayEvent}.
 *
 * This module — and ONLY this module — reconciles the two, for both HTTP
 * bodies and WebSocket events. No component and no hook should ever read a raw
 * gateway payload or compare a raw agent id.
 */

/* ------------------------------------------------------------ agent ids */

const AGENT_ID_MAP: Record<string, AgentId> = {
  hal: "hal",
  "atlas-hal": "hal",
  tron: "tron",
  "atlas-tron": "tron",
};

/** Map a gateway agent identifier to a console agent id, or `null`. */
export const normalizeAgentId = (value: unknown): AgentId | null => {
  if (typeof value !== "string") return null;
  return AGENT_ID_MAP[value.trim().toLowerCase()] ?? null;
};

/* --------------------------------------------------------------- guards */

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const asString = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;

const asNumber = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

/**
 * True when a payload carries an agent field that is present but unrecognised.
 *
 * This is a real contract violation and is surfaced as an explicit error — it
 * is NEVER silently mapped to HAL or TRON. A field that is simply absent or
 * empty is not flagged here; callers treat that as a missing (malformed) field.
 */
export const hasUnknownAgentId = (value: unknown): boolean => {
  if (!isRecord(value)) return false;
  const raw = value.selectedAgent ?? value.agent;
  if (raw === undefined || raw === null || raw === "") return false;
  return normalizeAgentId(raw) === null;
};

/* --------------------------------------------------------- agent status */

/**
 * The gateway sends its agent snapshot with an `id` (e.g. `atlas-hal`) and a
 * coarse `status` string. The console wants a short id plus optional health
 * flags. Nothing is invented: absent fields stay absent so the UI can render
 * "Unknown" instead of a fabricated value.
 */
export const normalizeAgentStatusPayload = (value: unknown): AgentStatusPayload | null => {
  if (!isRecord(value)) return null;

  const agent = normalizeAgentId(value.id) ?? normalizeAgentId(value.agent);
  if (!agent) return null;

  const payload: AgentStatusPayload = { agent };

  const rawStatus = asString(value.status);
  if (typeof value.online === "boolean") {
    payload.online = value.online;
  } else if (rawStatus) {
    // "online" / "busy" are reachable; "offline" / "connecting" are not.
    payload.online = rawStatus !== "offline" && rawStatus !== "connecting";
  }

  if (typeof value.busy === "boolean") {
    payload.busy = value.busy;
  } else if (rawStatus) {
    payload.busy = rawStatus === "busy";
  }

  const model = asString(value.model);
  if (model !== undefined && model.trim() !== "") payload.model = model;

  const latency = asNumber(value.latency);
  if (latency !== undefined) payload.latency = latency;

  // GPU / RAM / voice / RAG / n8n readiness are intentionally left undefined
  // when the gateway does not report them, so the mapper renders "Unknown".
  return payload;
};

/* ---------------------------------------------------------- WS events */

/**
 * Flatten one raw gateway event into the console's flat, typed event shape.
 *
 * Returns `null` for anything that is not a recognisable event so the caller
 * can ignore junk without throwing.
 */
export const normalizeGatewayEvent = (value: unknown): GatewayEvent | null => {
  if (!isRecord(value)) return null;

  const type = asString(value.type);
  if (!type) return null;

  const payload = isRecord(value.payload) ? value.payload : {};
  const event: GatewayEvent = { type: type as GatewayEventType };

  const requestId = asString(value.requestId);
  if (requestId) event.requestId = requestId;

  const sessionId = asString(value.sessionId);
  if (sessionId) event.sessionId = sessionId;

  const timestamp = asString(value.timestamp);
  if (timestamp) event.timestamp = timestamp;

  const agent =
    normalizeAgentId(value.agent) ??
    normalizeAgentId(payload.agent) ??
    normalizeAgentId(payload.id);
  if (agent) event.agent = agent;

  // Values nested in `payload`, mapped onto the console's flat field names.
  const text = asString(payload.transcript) ?? asString(payload.response) ?? asString(value.text);
  if (text !== undefined) event.text = text;

  const delta = asString(payload.delta) ?? asString(value.delta);
  if (delta !== undefined) event.delta = delta;

  const message = asString(payload.message) ?? asString(value.message);
  if (message !== undefined) event.message = message;

  const code = asString(payload.code) ?? asString(value.code);
  if (code !== undefined) event.code = code;

  const label = asString(payload.label);
  if (label !== undefined) event.label = label;

  const detail = asString(payload.detail);
  if (detail !== undefined) event.detail = detail;

  const status = asString(payload.status) ?? asString(value.status);
  if (status !== undefined) event.status = status;

  const model = asString(payload.model);
  if (model !== undefined) event.model = model;

  const latency = asNumber(payload.latency);
  if (latency !== undefined) event.latency = latency;

  const intent = asString(payload.intent);
  if (intent !== undefined) event.intent = intent;

  if (type === "agent_status") {
    const single = normalizeAgentStatusPayload({
      ...payload,
      id: payload.id ?? value.agent ?? payload.agent,
    });
    if (single) event.agentStatus = single;

    const list = Array.isArray(value.agentStatuses)
      ? value.agentStatuses
      : Array.isArray(payload.agents)
        ? payload.agents
        : null;
    if (list) {
      const statuses = list
        .map(normalizeAgentStatusPayload)
        .filter((item): item is AgentStatusPayload => item !== null);
      if (statuses.length > 0) event.agentStatuses = statuses;
    }
  }

  const from = normalizeAgentId(payload.from);
  const to = normalizeAgentId(payload.to);
  if (from && to) {
    event.handoff = { from, to };
  } else if (isRecord(value.handoff)) {
    const handoffFrom = normalizeAgentId(value.handoff.from);
    const handoffTo = normalizeAgentId(value.handoff.to);
    if (handoffFrom && handoffTo) event.handoff = { from: handoffFrom, to: handoffTo };
  }

  return event;
};

/* --------------------------------------------------------- HTTP bodies */

const CHAT_STATUS_MAP: Record<string, ChatResponseStatus> = {
  complete: "complete",
  partial: "partial",
  interrupted: "interrupted",
  error: "error",
};

/** Normalize a successful `POST /api/chat` body, or `null` if malformed. */
export const normalizeChatResponse = (
  value: unknown,
  fallbackSessionId: string,
): ChatResponsePayload | null => {
  if (!isRecord(value)) return null;

  const selectedAgent = normalizeAgentId(value.selectedAgent);
  if (!selectedAgent) return null;

  const response = asString(value.response);
  if (response === undefined) return null;

  const rawStatus = asString(value.status) ?? "complete";
  const status: ChatResponseStatus = CHAT_STATUS_MAP[rawStatus] ?? "complete";

  return {
    requestId: asString(value.requestId) ?? `req-${Date.now()}`,
    sessionId: asString(value.sessionId) ?? fallbackSessionId,
    selectedAgent,
    response,
    model: asString(value.model) ?? "Unknown",
    latency: asNumber(value.latency) ?? 0,
    status,
  };
};

const VOICE_STATUS_MAP: Record<string, VoiceResponseStatus> = {
  complete: "complete",
  no_speech_detected: "no_speech_detected",
  partial: "partial",
  error: "error",
};

/** Normalize a `POST /api/voice` body, or `null` if malformed. */
export const normalizeVoiceResponse = (
  value: unknown,
  fallbackSessionId: string,
): VoiceResponsePayload | null => {
  if (!isRecord(value)) return null;

  const transcript = asString(value.transcript);
  if (transcript === undefined) return null;

  const rawStatus = asString(value.status) ?? "complete";
  const status: VoiceResponseStatus = VOICE_STATUS_MAP[rawStatus] ?? "complete";

  return {
    requestId: asString(value.requestId) ?? null,
    sessionId: asString(value.sessionId) ?? fallbackSessionId,
    selectedAgent: normalizeAgentId(value.selectedAgent),
    transcript,
    language: asString(value.language) ?? null,
    duration: asNumber(value.duration) ?? null,
    processingTime: asNumber(value.processingTime) ?? null,
    response: asString(value.response) ?? "",
    model: asString(value.model) ?? "Unknown",
    latency: asNumber(value.latency) ?? 0,
    status,
    sttModel: asString(value.sttModel) ?? null,
    speechStatus: asString(value.speechStatus) ?? null,
    audioRef: asString(value.audioRef) ?? null,
    audioContentType: asString(value.audioContentType) ?? null,
    speechDurationMs: asNumber(value.speechDurationMs) ?? null,
    selectedVoiceId: asString(value.selectedVoiceId) ?? null,
  };
};