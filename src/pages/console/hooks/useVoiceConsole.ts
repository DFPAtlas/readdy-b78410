import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ActivityEvent,
  Agent,
  AgentId,
  ChatMessage,
  ConnectionNode,
  FailoverState,
  MessageStatus,
  RoutingMode,
  TranscriptKind,
  TranscriptLine,
  VoiceError,
  VoiceSession,
  VoiceState,
} from "@/pages/console/types";
import { VOICE_ERROR_HINTS, VOICE_ERROR_LABELS } from "@/pages/console/types";
import {
  demoUtterances,
  handoffLines,
  mockActivity,
  mockAgents,
  mockConnections,
  mockHalReplies,
  mockMessages,
  mockOperator,
  mockTronReplies,
} from "@/mocks/console";
import { agentForText, detectIntent, intentLabel, otherAgent } from "@/pages/console/routing";
import { VOICE_TIMINGS, clockStamp, createSession } from "@/pages/console/session";
import { useVoiceGateway, type GatewayApi } from "@/pages/console/hooks/useVoiceGateway";
import { useLiveVoiceTurn } from "@/pages/console/hooks/useLiveVoiceTurn";
import type { MicCaptureDiagnostics } from "@/pages/console/hooks/useMicCapture";
import { gatewayConfig } from "@/pages/console/gateway/config";
import {
  GATEWAY_ERROR_HINTS,
  GATEWAY_ERROR_LABELS,
  type AgentStatusPayload,
  type GatewayErrorInfo,
  type GatewayEvent,
} from "@/pages/console/gateway/contracts";
import { agentStatusToAgent } from "@/pages/console/gateway/mappers";

export { clockStamp } from "@/pages/console/session";

const inferenceTimes = [742, 968, 615, 1284, 833, 1071, 904];
const defaultPrompt = "Atlas, run a full status sweep across both agents.";
const partialRevealStep = 320;

export interface VoiceConsoleApi {
  agents: Record<AgentId, Agent>;
  connections: ConnectionNode[];
  messages: ChatMessage[];
  events: ActivityEvent[];
  operatorName: string;

  routingMode: RoutingMode;
  setRoutingMode: (mode: RoutingMode) => void;

  voiceState: VoiceState;
  speakingAgent: AgentId | null;
  session: VoiceSession;
  transcript: TranscriptLine[];
  continuous: boolean;
  busy: boolean;

  inputValue: string;
  setInputValue: (value: string) => void;
  sendMessage: () => void;

  micPointerDown: () => void;
  micPointerUp: () => void;
  micActivate: () => void;

  stopSpeaking: () => void;
  cancelSession: () => void;

  failover: FailoverState | null;
  resolveFailover: (agent: AgentId) => void;
  dismissFailover: () => void;

  voiceError: VoiceError | null;
  retryVoice: () => void;
  dismissError: () => void;
  simulateError: (error: VoiceError) => void;

  /** Live microphone input level (0..1) while recording — drives the meter. */
  inputLevel: number;
  /** Live microphone diagnostics (safe metadata only, no raw audio). */
  micDiagnostics: MicCaptureDiagnostics;

  voiceGatewayOnline: boolean;
  toggleVoiceGateway: () => void;
  /** Master switch: whether agent replies are spoken aloud. */
  voiceOutput: boolean;
  toggleVoiceOutput: () => void;
  setAgentAvailable: (agent: AgentId, available: boolean) => void;

  toggleContinuous: () => void;
  newConversation: () => void;
  clearTranscript: () => void;

  talkTo: (agent: AgentId) => void;
  toggleMute: (agent: AgentId) => void;

  detailsAgent: AgentId | null;
  openDetails: (agent: AgentId) => void;
  closeDetails: () => void;

  /** Atlas Voice Gateway integration layer (LIVE / DEMO / OFFLINE). */
  gateway: GatewayApi;
  gatewayError: GatewayErrorInfo | null;
  retryGateway: () => void;
  dismissGatewayError: () => void;
}

/**
 * Owns the entire local voice / chat simulation. Every side effect lives here so
 * swapping in a real WebSocket / API layer only touches this file.
 */
export function useVoiceConsole(): VoiceConsoleApi {
  const [voiceState, setVoiceState] = useState<VoiceState>("idle");
  const [routingMode, setRoutingModeState] = useState<RoutingMode>("auto");
  const [session, setSession] = useState<VoiceSession>(() =>
    createSession("session-0000", "auto"),
  );
  const [transcript, setTranscript] = useState<TranscriptLine[]>([]);
  const [agents, setAgents] = useState<Record<AgentId, Agent>>(() => ({
    hal: { ...mockAgents.hal },
    tron: { ...mockAgents.tron },
  }));
  const [messages, setMessages] = useState<ChatMessage[]>(() =>
    mockMessages.map((message) => ({ ...message })),
  );
  const [events, setEvents] = useState<ActivityEvent[]>(() =>
    mockActivity.map((event) => ({ ...event })),
  );
  const [inputValue, setInputValue] = useState("");
  const [detailsAgent, setDetailsAgent] = useState<AgentId | null>(null);
  const [continuous, setContinuous] = useState(false);
  const [failover, setFailover] = useState<FailoverState | null>(null);
  const [voiceError, setVoiceError] = useState<VoiceError | null>(null);
  const [voiceGatewayOnline, setVoiceGatewayOnline] = useState(true);
  /** Master switch: whether agent replies are spoken aloud (Voice output). */
  const [voiceOutput, setVoiceOutput] = useState(true);

  const gateway = useVoiceGateway();
  const gatewayApiRef = useRef(gateway);
  const modeRef = useRef(gateway.mode);
  const sessionStateRef = useRef(session);
  const scheduleContinuousRef = useRef<() => void>(() => {});

  const idRef = useRef(9000);
  const timersRef = useRef<number[]>([]);
  const partialTimerRef = useRef<number | null>(null);
  const partialIdRef = useRef<string | null>(null);
  const busyRef = useRef(false);
  const autoRef = useRef(0);
  const replyRef = useRef<Record<AgentId, number>>({ hal: 0, tron: 0 });
  const latencyRef = useRef(0);
  const phraseRef = useRef("");
  const listenStartRef = useRef(0);
  const pressModeRef = useRef<"listen" | "interrupt" | null>(null);
  const lastPointerRef = useRef(0);
  const lastRequestRef = useRef<{ text: string; mode: RoutingMode } | null>(null);

  const voiceStateRef = useRef<VoiceState>("idle");
  const agentsRef = useRef(agents);
  const routingModeRef = useRef<RoutingMode>("auto");
  const continuousRef = useRef(false);
  const gatewayRef = useRef(true);
  const speakingRef = useRef<AgentId | null>(null);
  const voiceOutputRef = useRef(true);

  useEffect(() => {
    agentsRef.current = agents;
  }, [agents]);

  useEffect(() => {
    gatewayApiRef.current = gateway;
  }, [gateway]);

  useEffect(() => {
    modeRef.current = gateway.mode;
  }, [gateway.mode]);

  useEffect(() => {
    sessionStateRef.current = session;
  }, [session]);

  useEffect(() => {
    voiceOutputRef.current = voiceOutput;
  }, [voiceOutput]);

  /* ---------------------------------------------------------------- helpers */

  const nextId = useCallback((prefix: string) => {
    idRef.current += 1;
    return `${prefix}-${idRef.current}`;
  }, []);

  const schedule = useCallback((fn: () => void, ms: number) => {
    const id = window.setTimeout(fn, ms);
    timersRef.current.push(id);
  }, []);

  const clearTimers = useCallback(() => {
    timersRef.current.forEach((id) => window.clearTimeout(id));
    timersRef.current = [];
  }, []);

  const stopPartialReveal = useCallback(() => {
    if (partialTimerRef.current !== null) {
      window.clearInterval(partialTimerRef.current);
      partialTimerRef.current = null;
    }
  }, []);

  const applyVoiceState = useCallback((next: VoiceState) => {
    voiceStateRef.current = next;
    speakingRef.current =
      next === "hal-speaking" ? "hal" : next === "tron-speaking" ? "tron" : null;
    setVoiceState(next);
  }, []);

  const pushEvent = useCallback((event: ActivityEvent) => {
    setEvents((prev) => {
      const next = [...prev, event];
      return next.length > 80 ? next.slice(next.length - 80) : next;
    });
  }, []);

  const updateEvent = useCallback((id: string, patch: Partial<ActivityEvent>) => {
    setEvents((prev) =>
      prev.map((event) => (event.id === id ? { ...event, ...patch } : event)),
    );
  }, []);

  const pushMessage = useCallback((message: ChatMessage) => {
    setMessages((prev) => [...prev, message]);
  }, []);

  const patchMessage = useCallback((id: string, patch: Partial<ChatMessage>) => {
    setMessages((prev) =>
      prev.map((message) => (message.id === id ? { ...message, ...patch } : message)),
    );
  }, []);

  const markSpeakingMessages = useCallback((status: MessageStatus) => {
    setMessages((prev) =>
      prev.map((message) =>
        (message.senderType === "hal" || message.senderType === "tron") &&
        message.status === "processing"
          ? { ...message, status }
          : message,
      ),
    );
  }, []);

  const pushTranscript = useCallback(
    (kind: TranscriptKind, text: string) => {
      setTranscript((prev) =>
        [...prev, { id: nextId("tr"), kind, text, timestamp: clockStamp() }].slice(-26),
      );
    },
    [nextId],
  );

  const clearTranscriptLines = useCallback(() => {
    partialIdRef.current = null;
    setTranscript([]);
  }, []);

  const setPartialLine = useCallback(
    (text: string) => {
      if (partialIdRef.current) {
        const id = partialIdRef.current;
        setTranscript((prev) =>
          prev.map((line) => (line.id === id ? { ...line, text, timestamp: clockStamp() } : line)),
        );
        return;
      }
      const id = nextId("tr");
      partialIdRef.current = id;
      setTranscript((prev) =>
        [...prev, { id, kind: "partial", text, timestamp: clockStamp() }].slice(-26),
      );
    },
    [nextId],
  );

  const clearPartialLine = useCallback(() => {
    if (!partialIdRef.current) return;
    const id = partialIdRef.current;
    partialIdRef.current = null;
    setTranscript((prev) => prev.filter((line) => line.id !== id));
  }, []);

  const setAgentSpeaking = useCallback((agentId: AgentId, speaking: boolean) => {
    setAgents((prev) => {
      const current = prev[agentId];
      return {
        ...prev,
        [agentId]: {
          ...current,
          isSpeaking: speaking,
          status: current.available ? (speaking ? "busy" : "online") : "offline",
          voiceStatus: speaking ? "busy" : "idle",
        },
      };
    });
  }, []);

  const clearAllSpeaking = useCallback(() => {
    setAgents((prev) => {
      const next = { ...prev };
      (["hal", "tron"] as AgentId[]).forEach((id) => {
        next[id] = {
          ...prev[id],
          isSpeaking: false,
          status: prev[id].available ? "online" : "offline",
          voiceStatus: "idle",
        };
      });
      return next;
    });
  }, []);

  const startPartialReveal = useCallback(() => {
    stopPartialReveal();
    const phrase = demoUtterances[Math.floor(Math.random() * demoUtterances.length)];
    phraseRef.current = phrase;
    const words = phrase.split(" ");
    let index = 0;
    partialTimerRef.current = window.setInterval(() => {
      index = Math.min(index + 1, words.length);
      const partial = words.slice(0, index).join(" ");
      setSession((prev) => ({ ...prev, partialTranscript: partial }));
      setPartialLine(partial);
      if (index >= words.length) stopPartialReveal();
    }, partialRevealStep);
  }, [setPartialLine, stopPartialReveal]);

  const nameForAgent = useCallback(
    (agentId: AgentId) => agentsRef.current[agentId]?.name ?? agentId.toUpperCase(),
    [],
  );

  const reportGatewayProblem = useCallback(
    (info: GatewayErrorInfo) => {
      gatewayApiRef.current.reportError(info);
      pushTranscript("error", GATEWAY_ERROR_LABELS[info.kind]);
      pushEvent({
        id: nextId("evt"),
        type: "error",
        label: GATEWAY_ERROR_LABELS[info.kind],
        detail: "Atlas Voice Gateway · live channel",
        timestamp: clockStamp(),
        status: "failed",
        agent: "system",
      });
    },
    [nextId, pushEvent, pushTranscript],
  );

  /** Live mode selected but the gateway is unreachable / not configured. */
  const reportOffline = useCallback(() => {
    const info: GatewayErrorInfo = {
      kind: gatewayConfig.configured ? "unreachable" : "not-configured",
      message: gatewayConfig.configured
        ? GATEWAY_ERROR_HINTS.unreachable
        : GATEWAY_ERROR_HINTS["not-configured"],
    };
    reportGatewayProblem(info);
  }, [reportGatewayProblem]);

  /* ------------------------------------------------------------ error paths */

  const raiseVoiceError = useCallback(
    (type: VoiceError, detail: string) => {
      clearTimers();
      stopPartialReveal();
      clearPartialLine();
      clearAllSpeaking();
      markSpeakingMessages("failed");
      busyRef.current = false;
      setVoiceError(type);
      applyVoiceState("error");
      setSession((prev) => ({ ...prev, state: "error", error: type, canInterrupt: false }));
      pushTranscript("error", VOICE_ERROR_LABELS[type]);
      pushEvent({
        id: nextId("evt"),
        type: "error",
        label: VOICE_ERROR_LABELS[type],
        detail,
        timestamp: clockStamp(),
        status: "failed",
        agent: "system",
      });
    },
    [
      applyVoiceState,
      clearAllSpeaking,
      clearPartialLine,
      clearTimers,
      markSpeakingMessages,
      nextId,
      pushEvent,
      pushTranscript,
      stopPartialReveal,
    ],
  );

  /**
   * Clear any lingering voice error at the start of a NEW attempt. Only the
   * error fields are reset — the caller sets the new state immediately after,
   * so this never disturbs the DEMO flow.
   */
  const clearVoiceError = useCallback(() => {
    setVoiceError(null);
    setSession((prev) => (prev.error ? { ...prev, error: null } : prev));
  }, []);

  /* ---------------------------------------------- live gateway voice turns */

  /**
   * LIVE (real gateway) turns: microphone capture, `/api/voice` + `/api/chat`
   * requests, and single-message reconciliation. The browser only ever talks to
   * the Atlas Voice Gateway — never to HAL, TRON or Ollama directly.
   */
  const live = useLiveVoiceTurn({
    getGateway: () => gatewayApiRef.current,
    getSessionId: () => gatewayApiRef.current.sessionId,
    getRoutingMode: () => routingModeRef.current,
    getSelectedAgent: () => sessionStateRef.current.selectedAgent,
    getVoiceOutput: () => voiceOutputRef.current,
    getAgentMuted: (agent) => agentsRef.current[agent]?.isMuted ?? false,
    nextId,
    pushMessage,
    patchMessage,
    appendMessageText: (id, chunk) =>
      setMessages((prev) =>
        prev.map((message) =>
          message.id === id ? { ...message, text: message.text + chunk } : message,
        ),
      ),
    pushEvent,
    updateEvent,
    pushTranscript,
    clearTranscriptLines,
    clearPartialLine,
    setPartialLine,
    stopPartialReveal,
    applyVoiceState,
    setAgentSpeaking,
    clearAllSpeaking,
    markSpeakingMessages,
    updateSession: (updater) => setSession(updater),
    replaceSession: (next) => setSession(next),
    nameForAgent,
    raiseVoiceError,
    clearVoiceError,
    reportGatewayProblem,
    scheduleContinuous: () => scheduleContinuousRef.current(),
    markBusy: (nextBusy) => {
      busyRef.current = nextBusy;
    },
    isBusy: () => busyRef.current,
  });

  /* ------------------------------------------------------------ speech core */

  const finishSpeaking = useCallback(
    (agent: AgentId, replyId: string, doneId: string) => {
      const name = agent.toUpperCase();
      patchMessage(replyId, { status: "complete" });
      pushEvent({
        id: doneId,
        type: "done",
        label: "Response complete",
        detail: `${name} → console`,
        timestamp: clockStamp(),
        status: "complete",
        agent,
      });
      setAgentSpeaking(agent, false);
      pushTranscript("status", `${name} response complete`);
      setSession((prev) => ({ ...prev, canInterrupt: false }));

      if (continuousRef.current) {
        // Continuous Conversation: auto-return to listening after a short pause.
        applyVoiceState("idle");
        setSession((prev) => ({ ...prev, state: "listening" }));
        schedule(() => {
          if (!continuousRef.current) return;
          startListeningRef.current({ auto: true });
          schedule(() => {
            if (continuousRef.current) endListeningRef.current();
          }, VOICE_TIMINGS.continuousListen);
        }, VOICE_TIMINGS.continuousPause);
        return;
      }

      applyVoiceState("idle");
      setSession((prev) => ({ ...prev, state: "idle" }));
      busyRef.current = false;
    },
    [applyVoiceState, patchMessage, pushEvent, pushTranscript, schedule, setAgentSpeaking],
  );

  const speakReply = useCallback(
    (agent: AgentId, text: string, mode: RoutingMode) => {
      const name = agent.toUpperCase();
      const speakingState: VoiceState = agent === "hal" ? "hal-speaking" : "tron-speaking";

      const pool = agent === "hal" ? mockHalReplies : mockTronReplies;
      const replyText = pool[replyRef.current[agent] % pool.length];
      replyRef.current[agent] += 1;
      const latency = inferenceTimes[latencyRef.current++ % inferenceTimes.length];

      const replyId = nextId("msg");
      const generateId = nextId("evt");
      const voiceId = nextId("evt");
      const doneId = nextId("evt");

      lastRequestRef.current = { text, mode };
      applyVoiceState(speakingState);
      setAgentSpeaking(agent, true);
      setSession((prev) => ({
        ...prev,
        state: speakingState,
        selectedAgent: agent,
        responseStartedAt: Date.now(),
        canInterrupt: true,
      }));

      pushTranscript("agent", `${name} speaking`);
      pushEvent({
        id: generateId,
        type: "generate",
        label: "Ollama generating response",
        detail: agent === "hal" ? "llama3.1:70b · 14 tok/s" : "mistral-nemo:12b · 21 tok/s",
        timestamp: clockStamp(),
        status: "active",
        agent,
      });

      pushMessage({
        id: replyId,
        sender: name,
        senderType: agent,
        text: replyText,
        timestamp: clockStamp(),
        model: mockAgents[agent].model,
        latency,
        status: "processing",
        tools:
          agent === "hal"
            ? [
                { label: "ollama", kind: "tool" },
                { label: "n8n", kind: "route" },
                { label: "voice", kind: "voice" },
              ]
            : [
                { label: "ollama", kind: "tool" },
                { label: "rag-index", kind: "vector" },
                { label: "voice", kind: "voice" },
              ],
      });

      if (agent === "tron") {
        schedule(() => {
          pushEvent({
            id: nextId("evt"),
            type: "search",
            label: "RAG search",
            detail: "Vector store · 128 chunks matched",
            timestamp: clockStamp(),
            status: "complete",
            agent: "tron",
          });
        }, 700);
      }

      schedule(() => {
        updateEvent(generateId, { status: "complete" });
        const muted = agentsRef.current[agent].isMuted;
        pushEvent({
          id: voiceId,
          type: "voice",
          label: muted ? "Voice muted" : "Voice synthesis",
          detail: muted
            ? `${name} output suppressed — text only`
            : agent === "hal"
              ? "piper · en-US · 1.1 s"
              : "piper · en-GB · 0.9 s",
          timestamp: clockStamp(),
          status: "complete",
          agent,
        });
      }, VOICE_TIMINGS.synth);

      schedule(() => finishSpeaking(agent, replyId, doneId), VOICE_TIMINGS.speak);
    },
    [
      applyVoiceState,
      finishSpeaking,
      nextId,
      pushEvent,
      pushMessage,
      pushTranscript,
      schedule,
      setAgentSpeaking,
      updateEvent,
    ],
  );

  const speakHandoff = useCallback(
    (from: AgentId, to: AgentId, text: string, mode: RoutingMode) => {
      const fromName = from.toUpperCase();
      const toName = to.toUpperCase();
      const pool = handoffLines[from];
      const line = pool[Math.floor(Math.random() * pool.length)];
      const fromState: VoiceState = from === "hal" ? "hal-speaking" : "tron-speaking";

      const msgId = nextId("msg");
      const reqEvtId = nextId("evt");
      const accEvtId = nextId("evt");

      applyVoiceState(fromState);
      setAgentSpeaking(from, true);
      setSession((prev) => ({
        ...prev,
        state: fromState,
        selectedAgent: from,
        responseStartedAt: Date.now(),
        canInterrupt: true,
      }));

      pushTranscript("agent", `${fromName} speaking`);
      pushTranscript("status", "Handoff request");
      pushMessage({
        id: msgId,
        sender: fromName,
        senderType: from,
        text: line,
        timestamp: clockStamp(),
        model: mockAgents[from].model,
        latency: 540,
        status: "processing",
        handoff: { from, to },
        tools: [{ label: "ollama", kind: "tool" }],
      });
      pushEvent({
        id: reqEvtId,
        type: "handoff",
        label: `${fromName} → ${toName}`,
        detail: "Handoff request",
        timestamp: clockStamp(),
        status: "active",
        agent: to,
      });

      schedule(() => {
        patchMessage(msgId, { status: "complete" });
        setAgentSpeaking(from, false);
        updateEvent(reqEvtId, { status: "complete" });
        pushEvent({
          id: accEvtId,
          type: "handoff",
          label: `${toName} accepted handoff`,
          detail: "Control transferred",
          timestamp: clockStamp(),
          status: "complete",
          agent: to,
        });
        pushMessage({
          id: nextId("msg"),
          sender: "System",
          senderType: "system",
          text: `Handoff accepted · ${fromName} → ${toName}. Control transferred for this request.`,
          timestamp: clockStamp(),
          status: "complete",
        });
        pushTranscript("status", `${toName} selected`);
        pushTranscript("status", `${toName} thinking...`);
        applyVoiceState("thinking");
        setSession((prev) => ({ ...prev, selectedAgent: to, state: "thinking" }));
        schedule(() => speakReply(to, text, mode), VOICE_TIMINGS.handoffHandover);
      }, VOICE_TIMINGS.handoffSpeak);
    },
    [
      applyVoiceState,
      nextId,
      patchMessage,
      pushEvent,
      pushMessage,
      pushTranscript,
      schedule,
      setAgentSpeaking,
      speakReply,
      updateEvent,
    ],
  );

  const pickHandoff = useCallback((from: AgentId, text: string): AgentId | null => {
    const other = otherAgent(from);
    if (!agentsRef.current[other].available) return null;
    const intent = detectIntent(text);
    if (from === "hal" && intent === "development") return other;
    if (from === "tron" && intent === "infrastructure") return other;
    return null;
  }, []);

  const raiseAgentFailure = useCallback(
    (target: AgentId | "both", text: string, mode: RoutingMode) => {
      clearTimers();
      stopPartialReveal();
      clearPartialLine();
      clearAllSpeaking();
      markSpeakingMessages("failed");
      busyRef.current = false;
      lastRequestRef.current = { text, mode };

      if (target === "both") {
        setFailover({
          kind: "all-offline",
          message: "Local AI unavailable",
          unavailable: ["hal", "tron"],
          suggested: null,
        });
        applyVoiceState("error");
        setSession((prev) => ({ ...prev, state: "error", canInterrupt: false }));
        pushTranscript("error", "Local AI unavailable");
        pushEvent({
          id: nextId("evt"),
          type: "failover",
          label: "Local AI unavailable",
          detail: "No agents reachable · cloud fallback not configured",
          timestamp: clockStamp(),
          status: "failed",
          agent: "system",
        });
        return;
      }

      const name = target.toUpperCase();
      const other = otherAgent(target);
      const suggestion = agentsRef.current[other].available ? other : null;
      setFailover({
        kind: "agent-unavailable",
        message: `${name} is currently unavailable`,
        unavailable: [target],
        suggested: suggestion,
      });
      applyVoiceState("error");
      setSession((prev) => ({ ...prev, state: "error", canInterrupt: false }));
      pushTranscript("error", `${name} is currently unavailable`);
      pushEvent({
        id: nextId("evt"),
        type: "failover",
        label: `${name} unavailable`,
        detail: suggestion
          ? `Operator can route to ${suggestion.toUpperCase()}`
          : "No fallback agent available",
        timestamp: clockStamp(),
        status: "failed",
        agent: "system",
      });
    },
    [
      applyVoiceState,
      clearAllSpeaking,
      clearPartialLine,
      clearTimers,
      markSpeakingMessages,
      nextId,
      pushEvent,
      pushTranscript,
      stopPartialReveal,
    ],
  );

  /**
   * Resolves which agent answers, then runs the thinking → speaking flow.
   * DEMONSTRATION LOGIC: routing is local keyword matching (see routing.ts) and
   * the responses come from the mock reply pools. Replace this single function
   * with the real router when live HAL / TRON connectivity lands.
   */
  const resolveAndRespond = useCallback(
    (rawText: string, mode: RoutingMode, opts: { viaVoice: boolean }) => {
      const text = rawText.trim() || defaultPrompt;
      lastRequestRef.current = { text, mode };

      const halAvailable = agentsRef.current.hal.available;
      const tronAvailable = agentsRef.current.tron.available;
      if (!halAvailable && !tronAvailable) {
        raiseAgentFailure("both", text, mode);
        return;
      }

      let resolved: AgentId;
      if (mode === "auto") {
        const alternate: AgentId = autoRef.current++ % 2 === 0 ? "hal" : "tron";
        const decision = agentForText(text, alternate);
        pushTranscript("status", "Analysing request type...");
        pushTranscript("status", intentLabel(decision.intent));
        resolved = decision.agent;
      } else {
        resolved = mode;
      }

      if (!agentsRef.current[resolved].available) {
        const other = otherAgent(resolved);
        if (mode === "auto" && agentsRef.current[other].available) {
          const note = `${resolved.toUpperCase()} unavailable — routing to ${other.toUpperCase()}`;
          pushTranscript("status", note);
          pushEvent({
            id: nextId("evt"),
            type: "failover",
            label: note,
            detail: "Automatic failover",
            timestamp: clockStamp(),
            status: "complete",
            agent: other,
          });
          resolved = other;
        } else {
          raiseAgentFailure(resolved, text, mode);
          return;
        }
      }

      const agentName = resolved.toUpperCase();
      applyVoiceState("thinking");
      setSession((prev) => ({ ...prev, selectedAgent: resolved, state: "thinking" }));
      pushTranscript("status", `${agentName} selected`);
      pushTranscript("status", `${agentName} thinking...`);
      pushEvent({
        id: nextId("evt"),
        type: "route",
        label: `${agentName} selected`,
        detail: mode === "auto" ? "Auto-router decision" : "Operator override",
        timestamp: clockStamp(),
        status: "complete",
        agent: resolved,
      });

      const handoffTarget = pickHandoff(resolved, text);
      schedule(
        () => {
          if (handoffTarget) speakHandoff(resolved, handoffTarget, text, mode);
          else speakReply(resolved, text, mode);
        },
        opts.viaVoice ? VOICE_TIMINGS.thinkVoice : VOICE_TIMINGS.thinkText,
      );
    },
    [
      applyVoiceState,
      nextId,
      pickHandoff,
      pushEvent,
      pushTranscript,
      raiseAgentFailure,
      schedule,
      speakHandoff,
      speakReply,
    ],
  );

  /* --------------------------------------------------------- listening flow */

  const startListeningSession = useCallback(
    (options: { auto?: boolean; preserve?: boolean } = {}) => {
      stopPartialReveal();
      clearPartialLine();
      if (!options.preserve) clearTranscriptLines();
      const sessionId = gatewayApiRef.current.sessionId;
      setSession({
        ...createSession(sessionId, routingModeRef.current),
        state: "listening",
        startedAt: Date.now(),
      });
      setVoiceError(null);
      setFailover(null);
      applyVoiceState("listening");
      pushTranscript("status", "Listening...");
      listenStartRef.current = Date.now();
      startPartialReveal();
      pushEvent({
        id: nextId("evt"),
        type: "voice",
        label: "Listening",
        detail: options.auto ? "Continuous conversation · channel 1" : "Push-to-talk · channel 1",
        timestamp: clockStamp(),
        status: "active",
        agent: "system",
      });
      busyRef.current = true;
    },
    [
      applyVoiceState,
      clearPartialLine,
      clearTranscriptLines,
      nextId,
      pushEvent,
      pushTranscript,
      startPartialReveal,
      stopPartialReveal,
    ],
  );

  const endListening = useCallback(() => {
    if (voiceStateRef.current !== "listening") return;
    stopPartialReveal();
    clearPartialLine();
    const phrase = phraseRef.current || defaultPrompt;

    setSession((prev) => ({
      ...prev,
      partialTranscript: "",
      finalTranscript: phrase,
      state: "transcribing",
    }));
    pushTranscript("final", phrase);
    pushTranscript("status", "Transcribing...");
    applyVoiceState("transcribing");
    pushEvent({
      id: nextId("evt"),
      type: "voice",
      label: "Transcribing audio",
      detail: "Speech-to-text · local whisper (simulated)",
      timestamp: clockStamp(),
      status: "active",
      agent: "system",
    });
    pushMessage({
      id: nextId("msg"),
      sender: mockOperator.name,
      senderType: "user",
      text: phrase,
      timestamp: clockStamp(),
      status: "complete",
    });

    schedule(() => {
      pushTranscript("status", "Routing request...");
      applyVoiceState("routing");
      setSession((prev) => ({ ...prev, state: "routing" }));
      pushEvent({
        id: nextId("evt"),
        type: "route",
        label: "Routing request",
        detail: "Auto-router evaluating intent",
        timestamp: clockStamp(),
        status: "active",
        agent: "system",
      });
    }, VOICE_TIMINGS.transcribe);

    schedule(() => {
      const activeMode = modeRef.current;
      if (activeMode === "live") {
        // Voice transcript is submitted through the gateway exactly like text.
        live.sendText(phrase);
      } else if (activeMode === "offline") {
        reportOffline();
        busyRef.current = false;
      } else {
        resolveAndRespond(phrase, routingModeRef.current, { viaVoice: true });
      }
    }, VOICE_TIMINGS.transcribe + VOICE_TIMINGS.route);
  }, [
    applyVoiceState,
    clearPartialLine,
    live,
    nextId,
    pushEvent,
    pushMessage,
    pushTranscript,
    reportOffline,
    resolveAndRespond,
    schedule,
    stopPartialReveal,
  ]);

  /* --------------------------------------------------------- turn controls */

  const startTextTurn = useCallback(
    (raw: string, mode: RoutingMode) => {
      if (busyRef.current) return;
      const text = raw.trim() || defaultPrompt;
      busyRef.current = true;
      lastRequestRef.current = { text, mode };
      stopPartialReveal();
      clearPartialLine();
      clearTranscriptLines();

      const sessionId = gatewayApiRef.current.sessionId;
      setSession({
        ...createSession(sessionId, mode),
        state: "routing",
        startedAt: Date.now(),
        finalTranscript: text,
      });
      setVoiceError(null);
      setFailover(null);
      applyVoiceState("routing");
      pushTranscript("status", "Request received");
      pushTranscript("status", "Routing request...");

      const userId = nextId("msg");
      const evtId = nextId("evt");
      pushMessage({
        id: userId,
        sender: mockOperator.name,
        senderType: "user",
        text,
        timestamp: clockStamp(),
        status: "sending",
      });
      pushEvent({
        id: evtId,
        type: "request",
        label: "Request received",
        detail: "Console · text channel",
        timestamp: clockStamp(),
        status: "active",
        agent: "system",
      });

      schedule(() => {
        patchMessage(userId, { status: "complete" });
        updateEvent(evtId, { status: "complete" });
      }, 420);
      schedule(() => resolveAndRespond(text, mode, { viaVoice: false }), 900);
    },
    [
      applyVoiceState,
      clearPartialLine,
      clearTranscriptLines,
      nextId,
      patchMessage,
      pushEvent,
      pushMessage,
      pushTranscript,
      resolveAndRespond,
      schedule,
      stopPartialReveal,
      updateEvent,
    ],
  );

  const interrupt = useCallback(() => {
    const agent = speakingRef.current;
    if (!agent) return;
    const name = agent.toUpperCase();
    if (modeRef.current === "live") {
      gatewayApiRef.current.interruptSpeech();
      live.interrupt();
    }
    clearTimers();
    stopPartialReveal();
    clearPartialLine();
    setAgentSpeaking(agent, false);
    markSpeakingMessages("interrupted");
    pushTranscript("status", `${name} interrupted`);
    pushEvent({
      id: nextId("evt"),
      type: "interrupt",
      label: `Martin interrupted ${name}`,
      detail: "Barge-in on channel 1",
      timestamp: clockStamp(),
      status: "complete",
      agent,
    });
    setSession((prev) => ({ ...prev, canInterrupt: false, selectedAgent: agent }));
    // Immediately return to listening.
    startListeningSession({ preserve: true });
  }, [
    clearPartialLine,
    clearTimers,
    live,
    markSpeakingMessages,
    nextId,
    pushEvent,
    pushTranscript,
    setAgentSpeaking,
    startListeningSession,
    stopPartialReveal,
  ]);

  const stopSpeaking = useCallback(() => {
    const agent = speakingRef.current;
    if (!agent) return;
    const name = agent.toUpperCase();
    if (modeRef.current === "live") {
      gatewayApiRef.current.interruptSpeech();
      live.interrupt();
    }
    clearTimers();
    stopPartialReveal();
    clearPartialLine();
    setAgentSpeaking(agent, false);
    markSpeakingMessages("interrupted");
    pushTranscript("status", "Speaking stopped");
    pushEvent({
      id: nextId("evt"),
      type: "interrupt",
      label: `Martin stopped ${name}`,
      detail: "Voice output halted",
      timestamp: clockStamp(),
      status: "complete",
      agent,
    });
    applyVoiceState("idle");
    setSession((prev) => ({ ...prev, state: "idle", canInterrupt: false }));
    busyRef.current = false;
  }, [
    applyVoiceState,
    clearPartialLine,
    clearTimers,
    live,
    markSpeakingMessages,
    nextId,
    pushEvent,
    pushTranscript,
    setAgentSpeaking,
    stopPartialReveal,
  ]);

  const cancelSession = useCallback(() => {
    if (voiceStateRef.current === "idle" && !failover && !voiceError) return;
    if (modeRef.current === "live") {
      gatewayApiRef.current.cancelRequest();
      live.interrupt();
      live.reset();
    }
    clearTimers();
    stopPartialReveal();
    clearPartialLine();
    clearAllSpeaking();
    markSpeakingMessages("failed");
    setFailover(null);
    setVoiceError(null);
    pressModeRef.current = null;
    applyVoiceState("idle");
    setSession((prev) => ({ ...prev, state: "idle", canInterrupt: false, error: null }));
    pushTranscript("status", "Voice session cancelled");
    pushEvent({
      id: nextId("evt"),
      type: "system",
      label: "Session cancelled",
      detail: "Escape · operator abort",
      timestamp: clockStamp(),
      status: "complete",
      agent: "system",
    });
    busyRef.current = false;
  }, [
    applyVoiceState,
    clearAllSpeaking,
    clearPartialLine,
    clearTimers,
    failover,
    live,
    markSpeakingMessages,
    nextId,
    pushEvent,
    pushTranscript,
    stopPartialReveal,
    voiceError,
  ]);

  /* ------------------------------------------------------------- mic inputs */

  const startListeningRef = useRef(startListeningSession);
  const endListeningRef = useRef(endListening);
  const interruptRef = useRef(interrupt);
  const cancelRef = useRef(cancelSession);
  const beginPressRef = useRef<() => void>(() => {});
  const endPressRef = useRef<() => void>(() => {});

  useEffect(() => {
    startListeningRef.current = startListeningSession;
    endListeningRef.current = endListening;
    interruptRef.current = interrupt;
    cancelRef.current = cancelSession;
  }, [cancelSession, endListening, interrupt, startListeningSession]);

  const beginPress = useCallback(() => {
    const state = voiceStateRef.current;
    if (state === "hal-speaking" || state === "tron-speaking") {
      pressModeRef.current = "interrupt";
      interruptRef.current();
      return;
    }
    if (busyRef.current) return;
    if (modeRef.current === "offline") {
      reportOffline();
      return;
    }
    if (modeRef.current === "live") {
      void live.startCapture();
      return;
    }
    if (modeRef.current === "demo" && !gatewayRef.current) {
      raiseVoiceError("connection-lost", VOICE_ERROR_HINTS["connection-lost"]);
      return;
    }
    pressModeRef.current = "listen";
    startListeningSession();
  }, [live, raiseVoiceError, reportOffline, startListeningSession]);

  const endPress = useCallback(() => {
    if (modeRef.current === "live" && live.isCapturing()) {
      void live.endCapture();
      return;
    }
    if (pressModeRef.current !== "listen") {
      pressModeRef.current = null;
      return;
    }
    pressModeRef.current = null;
    const elapsed = Date.now() - listenStartRef.current;
    const wait = Math.max(0, VOICE_TIMINGS.minListen - elapsed);
    if (wait > 0) schedule(() => endListeningRef.current(), wait);
    else endListeningRef.current();
  }, [live, schedule]);

  useEffect(() => {
    beginPressRef.current = beginPress;
    endPressRef.current = endPress;
  }, [beginPress, endPress]);

  const micPointerDown = useCallback(() => {
    lastPointerRef.current = Date.now();
    beginPress();
  }, [beginPress]);

  const micPointerUp = useCallback(() => {
    lastPointerRef.current = Date.now();
    endPress();
  }, [endPress]);

  const micActivate = useCallback(() => {
    // Pointer press/ release already handled this interaction.
    if (Date.now() - lastPointerRef.current < 600) return;
    const state = voiceStateRef.current;
    if (state === "hal-speaking" || state === "tron-speaking") {
      interruptRef.current();
      return;
    }
    if (modeRef.current === "live") {
      if (live.isCapturing()) {
        void live.endCapture();
        return;
      }
      if (busyRef.current) return;
      void live.startCapture();
      return;
    }
    if (state === "listening") {
      endListeningRef.current();
      return;
    }
    if (busyRef.current) return;
    if (modeRef.current === "offline") {
      reportOffline();
      return;
    }
    if (modeRef.current === "demo" && !gatewayRef.current) {
      raiseVoiceError("connection-lost", VOICE_ERROR_HINTS["connection-lost"]);
      return;
    }
    pressModeRef.current = "listen";
    startListeningSession();
    schedule(() => {
      if (voiceStateRef.current === "listening") endListeningRef.current();
    }, VOICE_TIMINGS.tapListen);
  }, [live, raiseVoiceError, reportOffline, schedule, startListeningSession]);

  const applyAgentStatus = useCallback((payload: AgentStatusPayload) => {
    setAgents((prev) => {
      const base = prev[payload.agent];
      if (!base) return prev;
      return { ...prev, [payload.agent]: agentStatusToAgent(base, payload) };
    });
  }, []);

  /**
   * Single router for every inbound gateway event.
   *
   * All WebSocket categories flow through here, so new event types can be added
   * in one place without touching any visual component. Nothing in this handler
   * fabricates agent data — missing fields arrive as "Unknown".
   */
  const handleGatewayEvent = useCallback(
    (event: GatewayEvent) => {
      // LIVE turns own their events: the turn controller matches by session +
      // request and reconciles exactly one user/assistant message. Only events
      // with no matching active turn fall through to this generic router.
      if (live.handleEvent(event)) return;

      switch (event.type) {
        case "agent_status": {
          const payloads = event.agentStatuses ?? (event.agentStatus ? [event.agentStatus] : []);
          payloads.forEach(applyAgentStatus);
          break;
        }
        case "routing_started": {
          applyVoiceState("routing");
          setSession((prev) => ({ ...prev, state: "routing" }));
          pushTranscript("status", event.label ?? "Routing request...");
          pushEvent({
            id: nextId("evt"),
            type: "route",
            label: "Routing request",
            detail: event.intent ?? "Gateway router",
            timestamp: clockStamp(),
            status: "active",
            agent: "system",
          });
          break;
        }
        case "agent_selected": {
          if (!event.agent) break;
          const selected = event.agent;
          setSession((prev) => ({ ...prev, selectedAgent: selected }));
          pushTranscript("status", `${selected.toUpperCase()} selected`);
          pushEvent({
            id: nextId("evt"),
            type: "route",
            label: `${selected.toUpperCase()} selected`,
            detail: "Gateway decision",
            timestamp: clockStamp(),
            status: "complete",
            agent: selected,
          });
          break;
        }
        case "audio_received": {
          pushEvent({
            id: nextId("evt"),
            type: "voice",
            label: "Audio received",
            detail: "Atlas Voice Gateway · validated",
            timestamp: clockStamp(),
            status: "complete",
            agent: "system",
          });
          break;
        }
        case "transcription_started": {
          applyVoiceState("transcribing");
          setSession((prev) => ({ ...prev, state: "transcribing" }));
          break;
        }
        case "transcription_failed": {
          pushTranscript("error", "Transcription failed");
          pushEvent({
            id: nextId("evt"),
            type: "error",
            label: "Transcription failed",
            detail: "Atlas Voice Gateway · speech-to-text",
            timestamp: clockStamp(),
            status: "failed",
            agent: "system",
          });
          break;
        }
        case "transcript_partial": {
          if (event.text) setPartialLine(event.text);
          break;
        }
        case "transcript_final": {
          clearPartialLine();
          if (event.text) {
            pushTranscript("final", event.text);
            setSession((prev) => ({ ...prev, finalTranscript: event.text ?? "" }));
          }
          break;
        }
        case "agent_thinking": {
          applyVoiceState("thinking");
          setSession((prev) => ({ ...prev, state: "thinking" }));
          pushTranscript("status", `${(event.agent ?? "agent").toUpperCase()} thinking...`);
          break;
        }
        case "response_started":
          // Turn-scoped rendering is owned by the live turn controller; any
          // event reaching here has no matching turn, so it is ignored.
          break;
        case "response_delta":
          break;
        case "response_complete": {
          // The live turn controller owns turn-scoped completion. This fallback
          // only clears lingering speaking state and never creates a message, so
          // a reconciled reply can never be duplicated.
          const agentId = event.agent ?? sessionStateRef.current.selectedAgent;
          if (agentId) setAgentSpeaking(agentId, false);
          break;
        }
        case "speech_started": {
          const agentId = event.agent ?? sessionStateRef.current.selectedAgent;
          if (!agentId) break;
          applyVoiceState(agentId === "hal" ? "hal-speaking" : "tron-speaking");
          setAgentSpeaking(agentId, true);
          setSession((prev) => ({
            ...prev,
            state: agentId === "hal" ? "hal-speaking" : "tron-speaking",
            canInterrupt: true,
          }));
          break;
        }
        case "speech_ended": {
          const agentId = event.agent ?? sessionStateRef.current.selectedAgent;
          if (agentId) setAgentSpeaking(agentId, false);
          break;
        }
        case "handoff": {
          const handoff = event.handoff;
          if (!handoff) break;
          pushMessage({
            id: nextId("msg"),
            sender: "System",
            senderType: "system",
            text: `Handoff · ${handoff.from.toUpperCase()} → ${handoff.to.toUpperCase()}`,
            timestamp: clockStamp(),
            status: "complete",
            handoff,
          });
          pushEvent({
            id: nextId("evt"),
            type: "handoff",
            label: `${handoff.from.toUpperCase()} → ${handoff.to.toUpperCase()}`,
            detail: event.detail ?? "Handoff request",
            timestamp: clockStamp(),
            status: "complete",
            agent: handoff.to,
          });
          break;
        }
        case "activity": {
          pushEvent({
            id: nextId("evt"),
            type: "system",
            label: event.label ?? "Gateway event",
            detail: event.detail ?? "",
            timestamp: clockStamp(),
            status: "complete",
            agent: event.agent ?? "system",
          });
          break;
        }
        case "error": {
          pushTranscript("error", event.message ?? "Gateway error");
          pushEvent({
            id: nextId("evt"),
            type: "error",
            label: event.message ?? "Gateway error",
            detail: "Atlas Voice Gateway",
            timestamp: clockStamp(),
            status: "failed",
            agent: "system",
          });
          break;
        }
        default:
          break;
      }
    },
    [
      applyAgentStatus,
      applyVoiceState,
      clearPartialLine,
      live,
      nameForAgent,
      nextId,
      pushEvent,
      pushMessage,
      pushTranscript,
      setAgentSpeaking,
      setPartialLine,
    ],
  );

  /** Continuous Conversation: auto-return to listening after a live reply. */
  const runContinuousLoop = useCallback(() => {
    if (!continuousRef.current) return;

    if (modeRef.current === "live") {
      // Live mode: start a real microphone capture, never the simulation.
      schedule(() => {
        if (!continuousRef.current) return;
        void (async () => {
          await live.startCapture();
          schedule(() => {
            if (continuousRef.current) void live.endCapture();
          }, VOICE_TIMINGS.continuousListen);
        })();
      }, VOICE_TIMINGS.continuousPause);
      return;
    }

    applyVoiceState("idle");
    setSession((prev) => ({ ...prev, state: "listening" }));
    schedule(() => {
      if (!continuousRef.current) return;
      startListeningRef.current({ auto: true });
      schedule(() => {
        if (continuousRef.current) endListeningRef.current();
      }, VOICE_TIMINGS.continuousListen);
    }, VOICE_TIMINGS.continuousPause);
  }, [applyVoiceState, live, schedule]);

  useEffect(() => {
    scheduleContinuousRef.current = runContinuousLoop;
  }, [runContinuousLoop]);

  useEffect(
    () => gateway.subscribe(handleGatewayEvent),
    [gateway.subscribe, handleGatewayEvent],
  );

  /* ----------------------------------------------------------- error repair */

  const retryVoice = useCallback(() => {
    setVoiceError(null);
    setFailover(null);
    const request = lastRequestRef.current;
    if (request) {
      busyRef.current = true;
      applyVoiceState("routing");
      setSession((prev) => ({ ...prev, state: "routing", error: null }));
      pushTranscript("status", "Retrying request...");
      schedule(() => resolveAndRespond(request.text, routingModeRef.current, { viaVoice: false }), 400);
      return;
    }
    applyVoiceState("idle");
    setSession((prev) => ({ ...prev, state: "idle", error: null }));
  }, [applyVoiceState, pushTranscript, resolveAndRespond, schedule]);

  const dismissError = useCallback(() => {
    setVoiceError(null);
    applyVoiceState("idle");
    setSession((prev) => ({ ...prev, state: "idle", error: null }));
  }, [applyVoiceState]);

  const simulateError = useCallback(
    (error: VoiceError) => {
      raiseVoiceError(error, VOICE_ERROR_HINTS[error]);
    },
    [raiseVoiceError],
  );

  const resolveFailover = useCallback(
    (agent: AgentId) => {
      const request = lastRequestRef.current;
      setFailover(null);
      setVoiceError(null);
      setRoutingModeState(agent);
      routingModeRef.current = agent;
      setSession((prev) => ({ ...prev, mode: agent, targetAgent: agent }));
      if (!request) {
        applyVoiceState("idle");
        return;
      }
      busyRef.current = true;
      applyVoiceState("routing");
      pushTranscript("status", `Routing to ${agent.toUpperCase()}`);
      schedule(() => resolveAndRespond(request.text, agent, { viaVoice: false }), 500);
    },
    [applyVoiceState, pushTranscript, resolveAndRespond, schedule],
  );

  const dismissFailover = useCallback(() => {
    setFailover(null);
    applyVoiceState("idle");
    setSession((prev) => ({ ...prev, state: "idle" }));
    pushTranscript("status", "Failover cancelled");
    busyRef.current = false;
  }, [applyVoiceState, pushTranscript]);

  const toggleVoiceOutput = useCallback(() => {
    const next = !voiceOutputRef.current;
    voiceOutputRef.current = next;
    setVoiceOutput(next);
    pushEvent({
      id: nextId("evt"),
      type: "voice",
      label: `Voice output ${next ? "enabled" : "disabled"}`,
      detail: next
        ? "Agent replies are spoken through the browser"
        : "Agent replies are text-only — no synthesis requested",
      timestamp: clockStamp(),
      status: "complete",
      agent: "system",
    });
  }, [nextId, pushEvent]);

  /* -------------------------------------------------------- console actions */

  const setRoutingMode = useCallback((mode: RoutingMode) => {
    setRoutingModeState(mode);
    routingModeRef.current = mode;
    gatewayApiRef.current.pushRoutingMode(mode);
    setSession((prev) => ({
      ...prev,
      mode,
      targetAgent: mode === "auto" ? null : mode,
    }));
  }, []);

  const sendMessage = useCallback(() => {
    const raw = inputValue;
    if (!raw.trim()) return;
    setInputValue("");
    if (modeRef.current === "live") {
      live.sendText(raw);
      return;
    }
    if (modeRef.current === "offline") {
      reportOffline();
      return;
    }
    startTextTurn(raw, routingModeRef.current);
  }, [inputValue, live, reportOffline, startTextTurn]);

  const talkTo = useCallback(
    (agent: AgentId) => {
      if (busyRef.current) return;
      setRoutingMode(agent);
      if (modeRef.current === "live") {
        void live.startCapture().then(() => {
          schedule(() => {
            void live.endCapture();
          }, VOICE_TIMINGS.tapListen);
        });
        return;
      }
      startListeningSession();
      schedule(() => endListeningRef.current(), VOICE_TIMINGS.tapListen);
    },
    [live, schedule, setRoutingMode, startListeningSession],
  );

  const toggleMute = useCallback(
    (agent: AgentId) => {
      setAgents((prev) => {
        const next = { ...prev, [agent]: { ...prev[agent], isMuted: !prev[agent].isMuted } };
        const muted = next[agent].isMuted;
        pushEvent({
          id: nextId("evt"),
          type: "voice",
          label: `${agent.toUpperCase()} ${muted ? "muted" : "unmuted"}`,
          detail: muted ? "Voice output suppressed" : "Voice output restored",
          timestamp: clockStamp(),
          status: "complete",
          agent,
        });
        return next;
      });
    },
    [nextId, pushEvent],
  );

  const setAgentAvailable = useCallback(
    (agent: AgentId, available: boolean) => {
      setAgents((prev) => {
        const current = prev[agent];
        return {
          ...prev,
          [agent]: {
            ...current,
            available,
            isSpeaking: available ? current.isSpeaking : false,
            status: available ? (current.isSpeaking ? "busy" : "online") : "offline",
            voiceStatus: available && current.isSpeaking ? "busy" : "idle",
          },
        };
      });
      pushEvent({
        id: nextId("evt"),
        type: "system",
        label: `${agent.toUpperCase()} marked ${available ? "available" : "unavailable"}`,
        detail: "Frontend simulation · no live service involved",
        timestamp: clockStamp(),
        status: "complete",
        agent: "system",
      });
    },
    [nextId, pushEvent],
  );

  const toggleVoiceGateway = useCallback(() => {
    if (modeRef.current !== "demo") return;
    const next = !gatewayRef.current;
    gatewayRef.current = next;
    setVoiceGatewayOnline(next);
    pushEvent({
      id: nextId("evt"),
      type: "system",
      label: `Voice gateway ${next ? "connected" : "disconnected"}`,
      detail: "Frontend simulation",
      timestamp: clockStamp(),
      status: next ? "complete" : "failed",
      agent: "system",
    });
    if (!next && voiceStateRef.current === "listening") {
      raiseVoiceError("connection-lost", VOICE_ERROR_HINTS["connection-lost"]);
    }
  }, [nextId, pushEvent, raiseVoiceError]);

  const toggleContinuous = useCallback(() => {
    const next = !continuousRef.current;
    continuousRef.current = next;
    setContinuous(next);
    pushEvent({
      id: nextId("evt"),
      type: "system",
      label: `Continuous conversation ${next ? "enabled" : "disabled"}`,
      detail: next ? "Auto-return to listening after each reply" : "Manual turns only",
      timestamp: clockStamp(),
      status: "complete",
      agent: "system",
    });
    if (!next && voiceStateRef.current === "listening") {
      clearTimers();
      stopPartialReveal();
      clearPartialLine();
      applyVoiceState("idle");
      setSession((prev) => ({ ...prev, state: "idle", canInterrupt: false }));
      busyRef.current = false;
    }
  }, [applyVoiceState, clearPartialLine, clearTimers, nextId, pushEvent, stopPartialReveal]);

  const newConversation = useCallback(() => {
    clearTimers();
    stopPartialReveal();
    clearPartialLine();
    clearAllSpeaking();
    if (modeRef.current === "live") live.stopPlayback();
    busyRef.current = false;
    setMessages([]);
    clearTranscriptLines();
    setFailover(null);
    setVoiceError(null);
    gatewayApiRef.current.clearError();
    applyVoiceState("idle");
    const sessionId = gatewayApiRef.current.newSession();
    setSession(createSession(sessionId, routingModeRef.current));
    pushMessage({
      id: nextId("msg"),
      sender: "System",
      senderType: "system",
      text: `New conversation started · ${sessionId}. Local mock session only — any stored memory is untouched.`,
      timestamp: clockStamp(),
      status: "complete",
    });
    pushEvent({
      id: nextId("evt"),
      type: "system",
      label: "New conversation",
      detail: `${sessionId} initialised`,
      timestamp: clockStamp(),
      status: "complete",
      agent: "system",
    });
  }, [
    applyVoiceState,
    clearAllSpeaking,
    clearPartialLine,
    clearTimers,
    clearTranscriptLines,
    live,
    nextId,
    pushEvent,
    pushMessage,
    stopPartialReveal,
  ]);

  const clearTranscript = useCallback(() => {
    setMessages([]);
    pushEvent({
      id: nextId("evt"),
      type: "system",
      label: "Transcript cleared",
      detail: "Local console log only · stored memory untouched",
      timestamp: clockStamp(),
      status: "complete",
      agent: "system",
    });
  }, [nextId, pushEvent]);

  const openDetails = useCallback((agent: AgentId) => setDetailsAgent(agent), []);
  const closeDetails = useCallback(() => setDetailsAgent(null), []);

  /* ------------------------------------------------------------- keyboard */

  useEffect(() => {
    const isFormField = (target: EventTarget | null) => {
      const element = target as HTMLElement | null;
      if (!element) return false;
      const tag = element.tagName ? element.tagName.toLowerCase() : "";
      return (
        tag === "input" ||
        tag === "textarea" ||
        tag === "select" ||
        element.isContentEditable === true
      );
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (isFormField(event.target)) return;
      if (event.code === "Space") {
        if (event.repeat) return;
        event.preventDefault();
        beginPressRef.current();
      } else if (event.key === "Escape") {
        event.preventDefault();
        cancelRef.current();
      }
    };

    const onKeyUp = (event: KeyboardEvent) => {
      if (isFormField(event.target)) return;
      if (event.code === "Space") {
        event.preventDefault();
        endPressRef.current();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);

  useEffect(
    () => () => {
      timersRef.current.forEach((id) => window.clearTimeout(id));
      if (partialTimerRef.current !== null) window.clearInterval(partialTimerRef.current);
    },
    [],
  );

  const connections = useMemo<ConnectionNode[]>(
    () =>
      mockConnections.map((node) => {
        if (node.id === "voice-gateway") {
          const state: ConnectionNode["state"] =
            gateway.mode === "demo"
              ? voiceGatewayOnline
                ? "connected"
                : "disconnected"
              : gateway.connection === "connected"
                ? "connected"
                : gateway.connection === "connecting" || gateway.connection === "reconnecting"
                  ? "connecting"
                  : gateway.connection === "degraded"
                    ? "degraded"
                    : "disconnected";
          return {
            ...node,
            state,
            detail:
              gateway.mode === "demo"
                ? "demo · simulated"
                : gateway.mode === "offline"
                  ? gateway.configured
                    ? "gateway unreachable"
                    : "not configured"
                  : "live · atlas gateway",
          };
        }
        if (node.id === "hal" || node.id === "tron") {
          const agent = agents[node.id];
          return {
            ...node,
            state: agent.available ? "connected" : "disconnected",
            detail: agent.available ? agent.host : "agent unavailable",
          };
        }
        return node;
      }),
    [agents, gateway.connection, gateway.configured, gateway.mode, voiceGatewayOnline],
  );

  const speakingAgent = speakingRef.current;
  const busy = voiceState !== "idle";

  return {
    agents,
    connections,
    messages,
    events,
    operatorName: mockOperator.name,
    routingMode,
    setRoutingMode,
    voiceState,
    speakingAgent,
    session,
    transcript,
    continuous,
    busy,
    inputValue,
    setInputValue,
    sendMessage,
    micPointerDown,
    micPointerUp,
    micActivate,
    stopSpeaking,
    cancelSession,
    failover,
    resolveFailover,
    dismissFailover,
    voiceError,
    retryVoice,
    dismissError,
    simulateError,
    inputLevel: live.inputLevel,
    micDiagnostics: live.micDiagnostics,
    voiceGatewayOnline,
    toggleVoiceGateway,
    voiceOutput,
    toggleVoiceOutput,
    setAgentAvailable,
    toggleContinuous,
    newConversation,
    clearTranscript,
    talkTo,
    toggleMute,
    detailsAgent,
    openDetails,
    closeDetails,
    gateway,
    gatewayError: gateway.error,
    retryGateway: gateway.retryConnection,
    dismissGatewayError: gateway.clearError,
  };
}