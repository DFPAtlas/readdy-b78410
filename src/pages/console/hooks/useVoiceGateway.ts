import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AtlasVoiceGateway, GatewayError, type GatewayDiagnostics } from "@/pages/console/gateway/client";
import { gatewayConfig } from "@/pages/console/gateway/config";
import {
  GATEWAY_ERROR_HINTS,
  type ChatRequestPayload,
  type ChatResponsePayload,
  type GatewayConnectionState,
  type GatewayErrorInfo,
  type GatewayErrorKind,
  type GatewayEvent,
  type GatewayMode,
  type GatewayPreference,
} from "@/pages/console/gateway/contracts";
import type { AgentId, RoutingMode } from "@/pages/console/types";

type EventListener = (event: GatewayEvent) => void;

let sessionCounter = 2043;

const createSessionId = (): string => {
  sessionCounter += 1;
  return `atlas-${sessionCounter}`;
};

export interface GatewayApi {
  mode: GatewayMode;
  preference: GatewayPreference;
  configured: boolean;
  connection: GatewayConnectionState;
  connectionDetail: string;
  notice: string | null;
  error: GatewayErrorInfo | null;
  diagnostics: GatewayDiagnostics;
  sessionId: string;
  setPreference: (preference: GatewayPreference) => void;
  retryConnection: () => void;
  newSession: () => string;
  clearError: () => void;
  reportError: (info: GatewayErrorInfo) => void;
  sendChat: (payload: Omit<ChatRequestPayload, "sessionId">) => Promise<ChatResponsePayload>;
  sendTranscript: (
    text: string,
    routingMode: RoutingMode,
    preferredAgent: AgentId | null,
  ) => Promise<ChatResponsePayload>;
  cancelRequest: () => void;
  interruptSpeech: () => void;
  pushRoutingMode: (mode: RoutingMode) => void;
  requestAgentStatus: () => void;
  subscribe: (listener: EventListener) => () => void;
}

const buildFallbackDiagnostics = (
  mode: GatewayMode,
  sessionId: string,
): GatewayDiagnostics => ({
  mode,
  host: gatewayConfig.host,
  connection: "disconnected",
  socket: "closed",
  sessionId,
  activeRequestId: null,
  lastEventType: null,
  lastHeartbeat: null,
  reconnectAttempt: 0,
});

const errorKindForConnectivity = (): GatewayErrorKind =>
  gatewayConfig.configured ? "unreachable" : "not-configured";

/**
 * Owns the Atlas Voice Gateway connection for the console.
 *
 * Components only ever consume the typed actions + events exposed here; every
 * fetch / WebSocket call is isolated inside the gateway service.
 */
export function useVoiceGateway(): GatewayApi {
  const [preference, setPreference] = useState<GatewayPreference>(() =>
    gatewayConfig.configured ? "live" : "demo",
  );
  const [sessionId, setSessionId] = useState<string>(createSessionId);
  const [connection, setConnection] = useState<GatewayConnectionState>("disconnected");
  const [connectionDetail, setConnectionDetail] = useState("");
  const [notice, setNotice] = useState<string | null>(
    gatewayConfig.configured ? null : "Voice Gateway not configured",
  );
  const [error, setError] = useState<GatewayErrorInfo | null>(null);
  const [retryToken, setRetryToken] = useState(0);

  const clientRef = useRef<AtlasVoiceGateway | null>(null);
  const listenersRef = useRef<Set<EventListener>>(new Set());
  const sessionIdRef = useRef(sessionId);
  const [diagnostics, setDiagnostics] = useState<GatewayDiagnostics>(() =>
    buildFallbackDiagnostics(gatewayConfig.configured ? "live" : "demo", sessionId),
  );

  useEffect(() => {
    sessionIdRef.current = sessionId;
    clientRef.current?.setSession(sessionId);
  }, [sessionId]);

  useEffect(() => {
    if (preference !== "live") {
      setConnection("disconnected");
      setConnectionDetail("demo simulation");
      setNotice(null);
      return undefined;
    }

    if (!gatewayConfig.configured) {
      setConnection("disconnected");
      setConnectionDetail("not configured");
      setNotice("Voice Gateway not configured");
      setDiagnostics(buildFallbackDiagnostics("offline", sessionIdRef.current));
      return undefined;
    }

    const client = new AtlasVoiceGateway();
    clientRef.current = client;

    const offEvent = client.onEvent((event) => {
      listenersRef.current.forEach((listener) => listener(event));
    });

    const offState = client.onState((state, detail) => {
      setConnection(state);
      setConnectionDetail(detail);
      setNotice((prev) => {
        if (state === "connected") {
          return prev === "Reconnecting..." || prev === "Gateway offline" || prev === "Connection lost"
            ? "Connection restored"
            : null;
        }
        if (state === "reconnecting") return "Reconnecting...";
        if (state === "error") return "Gateway offline";
        if (state === "degraded") return "Connection degraded";
        return prev;
      });
    });

    const offDiagnostics = client.onDiagnostics((snapshot) => {
      setDiagnostics({ ...snapshot, mode: "live" });
    });

    client.connect(sessionIdRef.current);

    return () => {
      offEvent();
      offState();
      offDiagnostics();
      client.dispose();
      clientRef.current = null;
    };
  }, [preference, retryToken]);

  const mode = useMemo<GatewayMode>(() => {
    if (preference === "demo") return "demo";
    if (!gatewayConfig.configured) return "offline";
    if (connection === "error" || connection === "disconnected") return "offline";
    return "live";
  }, [preference, connection]);

  const resolvedDiagnostics = useMemo<GatewayDiagnostics>(
    () => ({ ...diagnostics, mode, sessionId }),
    [diagnostics, mode, sessionId],
  );

  const subscribe = useCallback((listener: EventListener) => {
    listenersRef.current.add(listener);
    return () => {
      listenersRef.current.delete(listener);
    };
  }, []);

  const reportError = useCallback((info: GatewayErrorInfo) => {
    setError(info);
  }, []);

  const clearError = useCallback(() => setError(null), []);

  const sendChat = useCallback(
    async (payload: Omit<ChatRequestPayload, "sessionId">): Promise<ChatResponsePayload> => {
      const client = clientRef.current;
      if (!client || !gatewayConfig.configured) {
        const info: GatewayErrorInfo = {
          kind: "not-configured",
          message: GATEWAY_ERROR_HINTS["not-configured"],
        };
        setError(info);
        throw new GatewayError("not-configured");
      }
      try {
        const result = await client.sendMessage({ ...payload, sessionId: sessionIdRef.current });
        setError(null);
        return result;
      } catch (failure) {
        const info =
          failure instanceof GatewayError
            ? failure.toInfo()
            : { kind: "unreachable" as GatewayErrorKind, message: GATEWAY_ERROR_HINTS.unreachable };
        setError(info);
        throw failure;
      }
    },
    [],
  );

  const sendTranscript = useCallback(
    (text: string, routingMode: RoutingMode, preferredAgent: AgentId | null) =>
      sendChat({ message: text, routingMode, preferredAgent }),
    [sendChat],
  );

  const cancelRequest = useCallback(() => {
    clientRef.current?.cancelRequest();
  }, []);

  const interruptSpeech = useCallback(() => {
    clientRef.current?.interruptSpeech();
  }, []);

  const pushRoutingMode = useCallback((next: RoutingMode) => {
    clientRef.current?.setRoutingMode(next);
  }, []);

  const requestAgentStatus = useCallback(() => {
    clientRef.current?.requestAgentStatus();
  }, []);

  const newSession = useCallback(() => {
    const id = createSessionId();
    setSessionId(id);
    return id;
  }, []);

  const retryConnection = useCallback(() => {
    setError(null);
    if (preference !== "live") {
      setPreference("live");
      setNotice("Reconnecting...");
      return;
    }
    if (!gatewayConfig.configured) {
      setNotice("Voice Gateway not configured");
      return;
    }
    const client = clientRef.current;
    setNotice("Reconnecting...");
    if (client) client.reconnect();
    else setRetryToken((token) => token + 1);
  }, [preference]);

  /* Report the session/agent health on connect so the UI fills from live data. */
  useEffect(() => {
    if (mode !== "live") return;
    const client = clientRef.current;
    if (!client) return;
    client.requestAgentStatus();
  }, [mode]);

  return {
    mode,
    preference,
    configured: gatewayConfig.configured,
    connection,
    connectionDetail,
    notice,
    error,
    diagnostics: resolvedDiagnostics,
    sessionId,
    setPreference,
    retryConnection,
    newSession,
    clearError,
    reportError,
    sendChat,
    sendTranscript,
    cancelRequest,
    interruptSpeech,
    pushRoutingMode,
    requestAgentStatus,
    subscribe,
  };
}