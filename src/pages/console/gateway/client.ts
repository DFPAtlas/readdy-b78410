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
} from "@/pages/console/gateway/contracts";

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
const SOCKET_PATH = "/ws";
const REQUEST_TIMEOUT_MS = 20000;
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
      if (!response.ok) {
        throw new GatewayError("unreachable", `Voice Gateway responded ${response.status}`);
      }
      const text = await response.text();
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new GatewayError("malformed-response");
      }
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

  cancelRequest(): void {
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
    if (!value || typeof value !== "object") throw new GatewayError("malformed-response");
    const record = value as Record<string, unknown>;
    const { selectedAgent } = record;
    if (selectedAgent !== "hal" && selectedAgent !== "tron") {
      throw new GatewayError("malformed-response");
    }
    if (typeof record.response !== "string") throw new GatewayError("malformed-response");

    const status = record.status;
    return {
      requestId: typeof record.requestId === "string" ? record.requestId : `req-${Date.now()}`,
      sessionId: typeof record.sessionId === "string" ? record.sessionId : this.sessionId,
      selectedAgent,
      response: record.response,
      model: typeof record.model === "string" ? record.model : "Unknown",
      latency: typeof record.latency === "number" ? record.latency : 0,
      status: status === "partial" || status === "error" ? status : "complete",
    };
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
    if (!parsed || typeof parsed !== "object") return;
    const event = parsed as GatewayEvent;
    if (typeof event.type !== "string") return;

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