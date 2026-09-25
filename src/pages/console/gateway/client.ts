import { toHttpUrl, toSocketUrl, gatewayConfig } from "@/pages/console/gateway/config";
import {
  GATEWAY_ERROR_HINTS,
  GATEWAY_ERROR_LABELS,
  type ChatRequestPayload,
  type ChatResponsePayload,
  type GatewayConnectionState,
  type GatewayErrorInfo,
  type GatewayErrorKind,
  type GatewayEvent,
  type GatewayEventType,
  type GatewayMode,
  type GatewaySocketState,
  type VoiceResponsePayload,
} from "@/pages/console/gateway/contracts";
import {
  hasUnknownAgentId,
  normalizeChatResponse,
  normalizeGatewayEvent,
  normalizeVoiceResponse,
} from "@/pages/console/gateway/normalize";

/**
 * The single reusable service for every Atlas Voice Gateway interaction.
 *
 * HTTP (complete text interaction) and WebSocket (live events) logic live here
 * and nowhere else — visual components never call fetch or WebSocket directly.
 * HAL and TRON are NEVER contacted directly; the browser only knows the gateway.
 */

export interface GatewayDiagnostics {
  mode: GatewayMode;
  host: string;
  connection: GatewayConnectionState;
  socket: GatewaySocketState;
  sessionId: string;
  activeRequestId: string | null;
  lastEventType: GatewayEventType | null;
  lastHeartbeat: number | null;
  reconnectAttempt: number;
}

type EventListener = (event: GatewayEvent) => void;
type StateListener = (state: GatewayConnectionState, detail: string) => void;
type DiagnosticsListener = (diagnostics: GatewayDiagnostics) => void;

/** Human-readable, stack-trace-free error raised by the service layer. */
export class GatewayError extends Error {
  readonly kind: GatewayErrorKind;

  readonly detail: string;

  constructor(kind: GatewayErrorKind, detail?: string) {
    super(detail ?? GATEWAY_ERROR_LABELS[kind]);
    this.name = "GatewayError";
    this.kind = kind;
    this.detail = detail ?? "";
  }

  toInfo(): GatewayErrorInfo {
    return { kind: this.kind, message: this.detail || GATEWAY_ERROR_HINTS[this.kind] };
  }
}

const CHAT_PATH = "/api/chat";
const VOICE_PATH = "/api/voice";
const SOCKET_PATH = "/ws";
const REQUEST_TIMEOUT_MS = 20000;
// Voice requests cover upload + local transcription + generation + synthesis, so
// they legitimately take far longer than a text round-trip.
const VOICE_REQUEST_TIMEOUT_MS = 120000;
const HEARTBEAT_TIMEOUT_MS = 45000;
const HEARTBEAT_POLL_MS = 15000;
const BACKOFF_BASE_MS = 1000;
const BACKOFF_MAX_MS = 30000;
const MAX_RECONNECT_ATTEMPTS = 6;

export class AtlasVoiceGateway {
  private socket: WebSocket | null = null;

  private eventListeners = new Set<EventListener>();

  private stateListeners = new Set<StateListener>();

  private diagnosticsListeners = new Set<DiagnosticsListener>();

  private reconnectTimer: number | null = null;

  private heartbeatTimer: number | null = null;

  private abortController: AbortController | null = null;

  private cancelRequested = false;

  private reconnectAttempt = 0;

  private intentionalClose = false;

  private sessionId = "";

  private activeRequestId: string | null = null;

  private lastEventType: GatewayEventType | null = null;

  private lastHeartbeat: number | null = null;

  private connection: GatewayConnectionState = "disconnected";

  private socketState: GatewaySocketState = "closed";

  get configured(): boolean {
    return gatewayConfig.configured;
  }

  getDiagnostics(): GatewayDiagnostics {
    return {
      mode: gatewayConfig.configured ? "live" : "offline",
      host: gatewayConfig.host,
      connection: this.connection,
      socket: this.socketState,
      sessionId: this.sessionId,
      activeRequestId: this.activeRequestId,
      lastEventType: this.lastEventType,
      lastHeartbeat: this.lastHeartbeat,
      reconnectAttempt: this.reconnectAttempt,
    };
  }

  onEvent(listener: EventListener): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  onState(listener: StateListener): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  onDiagnostics(listener: DiagnosticsListener): () => void {
    this.diagnosticsListeners.add(listener);
    return () => this.diagnosticsListeners.delete(listener);
  }

  setSession(sessionId: string): void {
    this.sessionId = sessionId;
    this.sendSocket({ type: "session", sessionId });
    this.emitDiagnostics();
  }

  /* --------------------------------------------------------------- lifecycle */

  connect(sessionId: string): void {
    this.sessionId = sessionId;
    this.intentionalClose = false;

    if (!gatewayConfig.configured) {
      this.emitState("error", "Voice Gateway not configured");
      return;
    }
    if (this.socket && (this.socketState === "open" || this.socketState === "opening")) return;

    this.clearReconnectTimer();
    this.emitState(this.reconnectAttempt > 0 ? "reconnecting" : "connecting", "Opening gateway link");
    this.socketState = "opening";
    this.emitDiagnostics();

    let socket: WebSocket;
    try {
      socket = new WebSocket(toSocketUrl(SOCKET_PATH));
    } catch {
      this.handleDrop("unreachable");
      return;
    }
    this.socket = socket;

    socket.onopen = () => {
      this.socketState = "open";
      this.reconnectAttempt = 0;
      this.lastHeartbeat = Date.now();
      this.emitState("connected", "Gateway link established");
      this.sendSocket({ type: "connect", sessionId: this.sessionId });
      this.startHeartbeatWatch();
    };

    socket.onmessage = (message: MessageEvent) => this.handleRawEvent(message.data);

    socket.onerror = () => {
      this.emitState("degraded", "Gateway link error");
    };

    socket.onclose = () => {
      this.socketState = "closed";
      this.stopHeartbeatWatch();
      this.socket = null;
      if (this.intentionalClose) {
        this.emitState("disconnected", "Gateway link closed");
        return;
      }
      this.handleDrop("socket-disconnect");
    };
  }

  disconnect(): void {
    this.intentionalClose = true;
    this.clearReconnectTimer();
    this.stopHeartbeatWatch();
    this.reconnectAttempt = 0;
    if (this.socket) {
      try {
        this.socket.close();
      } catch {
        /* socket already gone */
      }
    }
    this.socket = null;
    this.socketState = "closed";
    this.emitState("disconnected", "Gateway link closed");
  }

  reconnect(): void {
    this.clearReconnectTimer();
    this.reconnectAttempt = 0;
    if (this.socket) {
      this.intentionalClose = true;
      try {
        this.socket.close();
      } catch {
        /* ignore */
      }
      this.socket = null;
    }
    this.intentionalClose = false;
    this.connect(this.sessionId);
  }

  dispose(): void {
    this.disconnect();
    this.eventListeners.clear();
    this.stateListeners.clear();
    this.diagnosticsListeners.clear();
  }

  /* ------------------------------------------------------------ HTTP channel */

  /** Complete a single text (or transcript) interaction through the gateway. */
  async sendMessage(payload: ChatRequestPayload): Promise<ChatResponsePayload> {
    if (!gatewayConfig.configured) throw new GatewayError("not-configured");
    if (this.connection !== "connected" && this.connection !== "degraded") {
      throw new GatewayError("unreachable", GATEWAY_ERROR_HINTS.unreachable);
    }

    const controller = new AbortController();
    this.abortController = controller;
    const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(toHttpUrl(CHAT_PATH), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      const text = await response.text();
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = null;
      }
      // A non-2xx body is mapped to a specific, typed gateway error — in
      // particular a rejected `preferredAgent` (HTTP 400 `unknown_agent`)
      // surfaces as a clear contract error rather than a generic failure. This
      // mirrors how /api/voice error bodies are mapped.
      if (!response.ok) throw this.chatErrorFromBody(response.status, parsed);
      if (parsed === null) throw new GatewayError("malformed-response");
      const data = this.parseChatResponse(parsed);
      this.activeRequestId = data.requestId;
      this.emitDiagnostics();
      return data;
    } catch (error) {
      if (error instanceof GatewayError) throw error;
      const aborted = error instanceof DOMException && error.name === "AbortError";
      throw new GatewayError(aborted ? "timeout" : "unreachable");
    } finally {
      window.clearTimeout(timeout);
      this.abortController = null;
    }
  }

  sendTranscript(
    text: string,
    routingMode: ChatRequestPayload["routingMode"],
    preferredAgent: ChatRequestPayload["preferredAgent"],
  ): Promise<ChatResponsePayload> {
    return this.sendMessage({
      sessionId: this.sessionId,
      message: text,
      routingMode,
      preferredAgent,
    });
  }

  /**
   * Upload a captured clip to `POST /api/voice`.
   *
   * The audio goes to the Atlas Voice Gateway and nowhere else. Multipart is
   * sent as-is so the browser sets the boundary — the caller must NOT append a
   * Content-Type header. Errors are mapped to the specific gateway failure so
   * the console can show an accurate message.
   */
  async sendVoice(form: FormData): Promise<VoiceResponsePayload> {
    if (!gatewayConfig.configured) throw new GatewayError("not-configured");
    if (this.connection !== "connected" && this.connection !== "degraded") {
      throw new GatewayError("unreachable", GATEWAY_ERROR_HINTS.unreachable);
    }

    const controller = new AbortController();
    this.abortController = controller;
    this.cancelRequested = false;
    const timeout = window.setTimeout(() => controller.abort(), VOICE_REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(toHttpUrl(VOICE_PATH), {
        method: "POST",
        body: form,
        signal: controller.signal,
      });
      const text = await response.text();
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new GatewayError("malformed-response");
      }
      if (!response.ok) throw this.voiceErrorFromBody(response.status, parsed);
      const data = this.parseVoiceResponse(parsed);
      this.activeRequestId = data.requestId;
      this.emitDiagnostics();
      return data;
    } catch (error) {
      if (error instanceof GatewayError) throw error;
      const aborted = error instanceof DOMException && error.name === "AbortError";
      if (aborted) {
        throw new GatewayError(this.cancelRequested ? "request-cancelled" : "timeout");
      }
      throw new GatewayError("unreachable");
    } finally {
      window.clearTimeout(timeout);
      this.abortController = null;
      this.cancelRequested = false;
    }
  }

  cancelRequest(): void {
    this.cancelRequested = true;
    this.abortController?.abort();
    this.abortController = null;
    this.activeRequestId = null;
    this.sendSocket({ type: "cancel", sessionId: this.sessionId });
    this.emitDiagnostics();
  }

  interruptSpeech(): void {
    this.sendSocket({ type: "interrupt", sessionId: this.sessionId });
  }

  setRoutingMode(mode: string): void {
    this.sendSocket({ type: "routing_mode", mode, sessionId: this.sessionId });
  }

  requestAgentStatus(): void {
    this.sendSocket({ type: "agent_status_request", sessionId: this.sessionId });
  }

  /* -------------------------------------------------------- internal helpers */

  private parseChatResponse(value: unknown): ChatResponsePayload {
    // Agent ids (`atlas-hal` / `atlas-tron`) are normalized to the console's
    // `hal` / `tron` INSIDE normalizeChatResponse, before any validation or
    // conversation update. A missing or unknown agent id stays a hard contract
    // error and is never silently relabelled HAL or TRON.
    const data = normalizeChatResponse(value, this.sessionId);
    if (!data) {
      if (hasUnknownAgentId(value)) throw new GatewayError("unknown-agent");
      throw new GatewayError("malformed-response");
    }
    return data;
  }

  private parseVoiceResponse(value: unknown): VoiceResponsePayload {
    // Same canonical agent-id resolution as the text path: a voice body whose
    // agent id is PRESENT but unrecognised is a hard contract error, never a
    // silent `null`. A missing id alongside reply text is equally unusable, so
    // an unattributable reply is never rendered as an empty message.
    const data = normalizeVoiceResponse(value, this.sessionId);
    if (!data) {
      if (hasUnknownAgentId(value)) throw new GatewayError("unknown-agent");
      throw new GatewayError("malformed-response");
    }
    if (
      !data.selectedAgent &&
      data.response.trim() !== "" &&
      data.status !== "no_speech_detected"
    ) {
      throw new GatewayError("unknown-agent");
    }
    return data;
  }

  /** Map a non-2xx `/api/chat` body to a specific, typed gateway error. */
  private chatErrorFromBody(status: number, value: unknown): GatewayError {
    const record = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
    const code = typeof record.code === "string" ? record.code : "";
    const message = typeof record.message === "string" ? record.message : undefined;

    switch (code) {
      case "unknown_agent":
        return new GatewayError("unknown-agent", message);
      case "agent_unavailable":
      case "local_ai_unavailable":
      case "agent_unreachable":
        return new GatewayError("agent-unavailable", message);
      case "agent_busy":
      case "too_many_requests":
        return new GatewayError("agent-busy", message);
      default:
        break;
    }

    if (status === 408 || status === 504) return new GatewayError("timeout", message);
    return new GatewayError("unreachable", message ?? `Voice Gateway responded ${status}`);
  }

  /** Map a non-2xx `/api/voice` body to a specific, typed gateway error. */
  private voiceErrorFromBody(status: number, value: unknown): GatewayError {
    const record = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
    const code = typeof record.code === "string" ? record.code : "";
    const message = typeof record.message === "string" ? record.message : undefined;

    switch (code) {
      case "unsupported_type":
        return new GatewayError("unsupported-audio", message);
      case "too_large":
      case "audio_too_long":
      case "message_too_large":
        return new GatewayError("audio-too-large", message);
      case "audio_too_short":
        return new GatewayError("audio-too-short", message);
      case "stt_busy":
      case "agent_busy":
      case "too_many_requests":
        return new GatewayError("agent-busy", message);
      case "agent_unavailable":
      case "local_ai_unavailable":
      case "agent_unreachable":
        return new GatewayError("agent-unavailable", message);
      case "no_speech_detected":
        return new GatewayError("no-speech", message);
      case "unknown_agent":
        return new GatewayError("unknown-agent", message);
      default:
        break;
    }

    if (status === 415) return new GatewayError("unsupported-audio", message);
    if (status === 413) return new GatewayError("audio-too-large", message);
    if (status === 408 || status === 504) return new GatewayError("timeout", message);
    return new GatewayError("voice-failure", message);
  }

  private handleRawEvent(data: unknown): void {
    if (typeof data !== "string") return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      this.emitEvent({ type: "error", message: "Malformed event payload" });
      return;
    }

    // Every inbound event passes through the shared normalization layer, which
    // maps gateway agent ids (`atlas-hal`) to console ids (`hal`) and flattens
    // the gateway's nested `payload` into the console's typed event.
    const event = normalizeGatewayEvent(parsed);
    if (!event) return;

    if (event.type === "heartbeat") this.lastHeartbeat = Date.now();
    if (event.requestId) this.activeRequestId = event.requestId;
    this.lastEventType = event.type;
    this.emitEvent(event);
  }

  private sendSocket(payload: Record<string, unknown>): void {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    try {
      socket.send(JSON.stringify(payload));
    } catch {
      /* socket closed mid-send */
    }
  }

  private handleDrop(kind: GatewayErrorKind): void {
    this.socketState = "closed";
    this.stopHeartbeatWatch();
    if (this.reconnectAttempt >= MAX_RECONNECT_ATTEMPTS) {
      this.emitState("error", "Gateway unreachable");
      this.emitEvent({ type: "error", message: GATEWAY_ERROR_LABELS[kind] });
      return;
    }
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    this.reconnectAttempt += 1;
    const backoff = Math.min(
      BACKOFF_BASE_MS * 2 ** (this.reconnectAttempt - 1),
      BACKOFF_MAX_MS,
    );
    const delay = backoff + Math.floor(Math.random() * 250);
    this.emitState("reconnecting", `Reconnecting · attempt ${this.reconnectAttempt}`);
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect(this.sessionId);
    }, delay);
  }

  private startHeartbeatWatch(): void {
    this.stopHeartbeatWatch();
    this.heartbeatTimer = window.setInterval(() => {
      if (this.lastHeartbeat && Date.now() - this.lastHeartbeat > HEARTBEAT_TIMEOUT_MS) {
        this.emitState("degraded", "No heartbeat from gateway");
      }
      this.sendSocket({ type: "heartbeat", sessionId: this.sessionId });
    }, HEARTBEAT_POLL_MS);
  }

  private stopHeartbeatWatch(): void {
    if (this.heartbeatTimer !== null) {
      window.clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private emitEvent(event: GatewayEvent): void {
    this.eventListeners.forEach((listener) => listener(event));
    this.emitDiagnostics();
  }

  private emitState(state: GatewayConnectionState, detail: string): void {
    this.connection = state;
    this.stateListeners.forEach((listener) => listener(state, detail));
    this.emitDiagnostics();
  }

  private emitDiagnostics(): void {
    const snapshot = this.getDiagnostics();
    this.diagnosticsListeners.forEach((listener) => listener(snapshot));
  }
}