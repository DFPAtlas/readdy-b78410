import { useCallback, useMemo, useRef } from "react";
import type {
  ActivityEvent,
  AgentId,
  ChatMessage,
  MessageStatus,
  RoutingMode,
  TranscriptKind,
  VoiceError,
  VoiceSession,
  VoiceState,
} from "@/pages/console/types";
import { VOICE_ERROR_HINTS } from "@/pages/console/types";
import { mockOperator } from "@/mocks/console";
import { clockStamp, createSession } from "@/pages/console/session";
import { useMicCapture } from "@/pages/console/hooks/useMicCapture";
import {
  MicError,
  extensionForMimeType,
  type MicErrorKind,
  type RecordedClip,
} from "@/pages/console/audio/micRecorder";
import { GatewayError } from "@/pages/console/gateway/client";
import type { GatewayApi } from "@/pages/console/hooks/useVoiceGateway";
import {
  GATEWAY_ERROR_HINTS,
  type ChatResponsePayload,
  type GatewayErrorInfo,
  type GatewayEvent,
  type VoiceResponsePayload,
} from "@/pages/console/gateway/contracts";
import { LiveTurnController } from "@/pages/console/gateway/turns";

const defaultPrompt = "Atlas, run a full status sweep across both agents.";

/**
 * Everything the live voice turn needs from the console shell.
 *
 * The live hook owns the network + microphone work; the console keeps owning
 * the render state. Passing stable callbacks (never raw setters) keeps the two
 * sides loosely coupled and lets the demo engine stay untouched.
 */
export interface LiveVoiceBridge {
  getGateway: () => GatewayApi;
  getSessionId: () => string;
  getRoutingMode: () => RoutingMode;
  getSelectedAgent: () => AgentId | null;
  nextId: (prefix: string) => string;
  pushMessage: (message: ChatMessage) => void;
  patchMessage: (id: string, patch: Partial<ChatMessage>) => void;
  appendMessageText: (id: string, chunk: string) => void;
  pushEvent: (event: ActivityEvent) => void;
  updateEvent: (id: string, patch: Partial<ActivityEvent>) => void;
  pushTranscript: (kind: TranscriptKind, text: string) => void;
  clearTranscriptLines: () => void;
  clearPartialLine: () => void;
  setPartialLine: (text: string) => void;
  stopPartialReveal: () => void;
  applyVoiceState: (state: VoiceState) => void;
  setAgentSpeaking: (agent: AgentId, speaking: boolean) => void;
  clearAllSpeaking: () => void;
  markSpeakingMessages: (status: MessageStatus) => void;
  updateSession: (updater: (prev: VoiceSession) => VoiceSession) => void;
  replaceSession: (session: VoiceSession) => void;
  nameForAgent: (agent: AgentId) => string;
  raiseVoiceError: (type: VoiceError, detail: string) => void;
  reportGatewayProblem: (info: GatewayErrorInfo) => void;
  scheduleContinuous: () => void;
  markBusy: (busy: boolean) => void;
  isBusy: () => boolean;
}

export interface LiveVoiceTurnApi {
  isCapturing: () => boolean;
  startCapture: () => Promise<void>;
  endCapture: () => Promise<void>;
  /** Send a LIVE text turn through the gateway (exactly one user + one reply). */
  sendText: (text: string) => void;
  /** Consume a turn-scoped WebSocket event. Returns true when it was handled. */
  handleEvent: (event: GatewayEvent) => boolean;
  /** Mark the streamed assistant message interrupted and close the turn. */
  interrupt: () => void;
  /** Abort any capture and drop the active turn (used by session cancel). */
  reset: () => void;
}

/**
 * Owns the LIVE (real gateway) half of the console: browser microphone capture,
 * the `/api/voice` and `/api/chat` requests, and turn reconciliation.
 *
 * The golden rule here: one operator interaction produces exactly ONE user
 * message and ONE assistant message, no matter whether the reply arrives over
 * the WebSocket, the HTTP response, or both.
 */
export function useLiveVoiceTurn(bridge: LiveVoiceBridge): LiveVoiceTurnApi {
  const capture = useMicCapture();
  const controllerRef = useRef(new LiveTurnController());
  const capturingRef = useRef(false);
  const startPromiseRef = useRef<Promise<{ ok: boolean; error?: MicError }> | null>(null);
  const bridgeRef = useRef(bridge);
  // Keep the freshest bridge without re-creating every callback below.
  bridgeRef.current = bridge;

  /* ------------------------------------------------------------ helpers */

  const endTurn = useCallback(() => {
    controllerRef.current.finish();
  }, []);

  const handleTurnFailure = useCallback((failure: unknown) => {
    const b = bridgeRef.current;
    b.clearAllSpeaking();
    b.markSpeakingMessages("failed");

    const cancelled = failure instanceof GatewayError && failure.kind === "request-cancelled";
    if (!cancelled) {
      const info =
        failure instanceof GatewayError
          ? failure.toInfo()
          : { kind: "unreachable" as const, message: GATEWAY_ERROR_HINTS.unreachable };
      b.reportGatewayProblem(info);
    }

    b.applyVoiceState("idle");
    b.updateSession((prev) => ({ ...prev, state: "idle", canInterrupt: false }));
    b.markBusy(false);
  }, []);

  const handleMicFailure = useCallback((error: MicError) => {
    const mapping: Record<MicErrorKind, VoiceError> = {
      unsupported: "recording-unsupported",
      "permission-denied": "microphone-permission",
      "no-device": "microphone-missing",
      "device-error": "microphone-unavailable",
      empty: "recording-empty",
      failure: "microphone-unavailable",
    };
    const kind = mapping[error.kind] ?? "microphone-unavailable";
    capturingRef.current = false;
    startPromiseRef.current = null;
    controllerRef.current.clear();
    bridgeRef.current.raiseVoiceError(kind, error.detail || VOICE_ERROR_HINTS[kind]);
  }, []);

  /* ------------------------------------------- finalizing a turn (HTTP) */

  const reconcileText = useCallback((b: LiveVoiceBridge, result: ChatResponsePayload) => {
    const turn = controllerRef.current.current;
    // Nothing to reconcile if the turn was cancelled or interrupted before the
    // HTTP round-trip returned — that must never resurrect the reply.
    if (!turn || turn.finished) return;

    b.updateSession((prev) => ({
      ...prev,
      selectedAgent: result.selectedAgent,
      state: "idle",
      canInterrupt: false,
    }));
    b.pushTranscript("status", `${result.selectedAgent.toUpperCase()} selected`);

    // Exactly one assistant message: reconcile whatever streamed, or create the
    // single reply from the HTTP response when nothing streamed.
    if (turn.assistantMessageId) {
      const patch: Partial<ChatMessage> = { status: "complete" };
      if (result.response.trim()) patch.text = result.response;
      if (result.model) patch.model = result.model;
      if (typeof result.latency === "number") patch.latency = result.latency;
      b.patchMessage(turn.assistantMessageId, patch);
    } else if (result.response.trim()) {
      b.pushMessage({
        id: b.nextId("msg"),
        sender: b.nameForAgent(result.selectedAgent),
        senderType: result.selectedAgent,
        text: result.response,
        timestamp: clockStamp(),
        model: result.model,
        latency: result.latency,
        status: "complete",
        tools: [{ label: "voice-gateway", kind: "route" }],
      });
    }

    b.applyVoiceState("idle");
    b.pushEvent({
      id: b.nextId("evt"),
      type: "done",
      label: "Response complete",
      detail: `${b.nameForAgent(result.selectedAgent)} → console`,
      timestamp: clockStamp(),
      status: "complete",
      agent: result.selectedAgent,
    });
    b.scheduleContinuous();
  }, []);

  const reconcileVoice = useCallback((b: LiveVoiceBridge, result: VoiceResponsePayload) => {
    const turn = controllerRef.current.current;
    // A cancelled/interrupted turn is left exactly as the operator saw it.
    if (!turn || turn.finished) return;

    const transcript = (result.transcript ?? "").trim();
    const selected = result.selectedAgent;

    if (result.status === "no_speech_detected" || !transcript) {
      // raiseVoiceError already surfaces the banner + transcript + activity line.
      b.raiseVoiceError(
        "no-speech",
        "Nothing was recognised in the clip, so no agent was asked to respond.",
      );
      return;
    }

    // Exactly one user message: reuse the one the WebSocket created from
    // `transcript_final`, or create it here if the socket did not deliver it.
    if (turn.userMessageId) {
      const patch: Partial<ChatMessage> = { status: "complete" };
      if (transcript) patch.text = transcript;
      b.patchMessage(turn.userMessageId, patch);
    } else {
      const id = b.nextId("msg");
      b.pushMessage({
        id,
        sender: mockOperator.name,
        senderType: "user",
        text: transcript,
        timestamp: clockStamp(),
        status: "complete",
      });
      controllerRef.current.setUserMessage(id);
      b.clearPartialLine();
      b.pushTranscript("final", transcript);
    }

    b.updateSession((prev) => ({
      ...prev,
      finalTranscript: transcript,
      partialTranscript: "",
      selectedAgent: selected ?? prev.selectedAgent,
    }));

    // Exactly one assistant message: reconcile the streamed message, or create
    // one from the HTTP response when nothing streamed.
    if (turn.assistantMessageId) {
      const patch: Partial<ChatMessage> = { status: "complete" };
      if (result.response.trim()) patch.text = result.response;
      if (result.model) patch.model = result.model;
      if (typeof result.latency === "number") patch.latency = result.latency;
      b.patchMessage(turn.assistantMessageId, patch);
    } else if (selected && result.response.trim()) {
      b.pushMessage({
        id: b.nextId("msg"),
        sender: b.nameForAgent(selected),
        senderType: selected,
        text: result.response,
        timestamp: clockStamp(),
        model: result.model,
        latency: result.latency,
        status: "complete",
        tools: [{ label: "voice-gateway", kind: "route" }],
      });
    }

    if (selected) b.setAgentSpeaking(selected, false);
    b.applyVoiceState("idle");
    b.updateSession((prev) => ({ ...prev, state: "idle", canInterrupt: false }));
    b.pushEvent({
      id: b.nextId("evt"),
      type: "done",
      label: "Response complete",
      detail: `${selected ? b.nameForAgent(selected) : "Agent"} → console`,
      timestamp: clockStamp(),
      status: "complete",
      agent: selected ?? "system",
    });
    b.scheduleContinuous();
  }, []);

  /* ------------------------------------------------- capture lifecycle */

  const startCapture = useCallback(async () => {
    if (capturingRef.current) return;
    const b = bridgeRef.current;
    if (b.isBusy()) return;

    const api = b.getGateway();
    if (api.mode === "offline") return;

    capturingRef.current = true;
    b.stopPartialReveal();
    b.clearPartialLine();
    b.clearTranscriptLines();
    api.clearError();

    const sessionId = b.getSessionId();
    controllerRef.current.begin(b.nextId("turn"), "voice", sessionId, null);
    b.replaceSession({
      ...createSession(sessionId, b.getRoutingMode()),
      state: "recording",
      startedAt: Date.now(),
    });
    b.markBusy(true);
    b.applyVoiceState("recording");
    b.pushTranscript("status", "Requesting microphone...");

    const startPromise = capture.start();
    startPromiseRef.current = startPromise;
    const started = await startPromise;
    if (startPromiseRef.current === startPromise) startPromiseRef.current = null;

    // Released/cancelled while the microphone was still opening.
    if (!capturingRef.current) return;
    if (!started.ok) {
      handleMicFailure(started.error ?? new MicError("failure"));
      return;
    }

    b.pushTranscript("status", "Listening...");
    b.pushEvent({
      id: b.nextId("evt"),
      type: "voice",
      label: "Recording audio",
      detail: "Browser microphone · push-to-talk",
      timestamp: clockStamp(),
      status: "active",
      agent: "system",
    });
  }, [capture, handleMicFailure]);

  const submitClip = useCallback(
    async (clip: RecordedClip) => {
      const b = bridgeRef.current;
      const api = b.getGateway();
      const turn = controllerRef.current.current;
      if (!turn) return;

      b.markBusy(true);
      b.applyVoiceState("uploading");
      b.updateSession((prev) => ({ ...prev, state: "uploading", partialTranscript: "" }));
      b.pushTranscript("status", "Uploading audio...");

      const uploadEvtId = b.nextId("evt");
      b.pushEvent({
        id: uploadEvtId,
        type: "voice",
        label: "Uploading audio",
        detail: `${Math.max(1, Math.round(clip.blob.size / 1024))} KB · ${clip.mimeType || "audio"}`,
        timestamp: clockStamp(),
        status: "active",
        agent: "system",
      });

      try {
        const mode = b.getRoutingMode();
        const form = new FormData();
        form.append("audio", clip.blob, `atlas-clip.${extensionForMimeType(clip.mimeType)}`);
        form.append("sessionId", turn.sessionId);
        // The gateway normalises case, but send the canonical HAL/AUTO/TRON.
        form.append("routingMode", mode.toUpperCase());
        if (mode !== "auto") {
          form.append("preferredAgent", mode === "hal" ? "atlas-hal" : "atlas-tron");
        }
        form.append("language", "en");
        // No playback in this phase: ask the gateway not to synthesize so no
        // CPU is spent producing audio the console would only discard.
        form.append("speak", "false");

        const result = await api.sendVoice(form);
        b.updateEvent(uploadEvtId, { status: "complete" });
        controllerRef.current.adoptRequestId(result.requestId);
        reconcileVoice(b, result);
      } catch (failure) {
        b.updateEvent(uploadEvtId, { status: "failed" });
        handleTurnFailure(failure);
      } finally {
        endTurn();
        b.markBusy(false);
      }
    },
    [endTurn, handleTurnFailure, reconcileVoice],
  );

  const endCapture = useCallback(async () => {
    if (!capturingRef.current) return;
    capturingRef.current = false;
    const b = bridgeRef.current;

    // If the microphone was still opening (e.g. the operator released during
    // the permission prompt), wait for it and surface the real result here so a
    // specific failure is never lost.
    const pending = startPromiseRef.current;
    if (pending) {
      startPromiseRef.current = null;
      const started = await pending;
      if (!started.ok) {
        b.markBusy(false);
        handleMicFailure(started.error ?? new MicError("failure"));
        return;
      }
    }

    const stopped = await capture.stop();
    if (!stopped.ok || !stopped.clip) {
      b.markBusy(false);
      handleMicFailure(stopped.error ?? new MicError("empty"));
      return;
    }
    void submitClip(stopped.clip);
  }, [capture, handleMicFailure, submitClip]);

  const reset = useCallback(() => {
    capture.cancel();
    capturingRef.current = false;
    startPromiseRef.current = null;
    controllerRef.current.clear();
  }, [capture]);

  /* ------------------------------------------------------- text turns */

  const runTextTurn = useCallback(
    async (text: string, userId: string, mode: RoutingMode, sessionId: string) => {
      const b = bridgeRef.current;
      const api = b.getGateway();

      b.stopPartialReveal();
      b.clearPartialLine();
      b.clearTranscriptLines();
      api.clearError();

      b.applyVoiceState("routing");
      b.replaceSession({
        ...createSession(sessionId, mode),
        state: "routing",
        startedAt: Date.now(),
        finalTranscript: text,
      });
      b.pushTranscript("status", "Request received");
      b.pushTranscript("status", "Routing request...");

      const evtId = b.nextId("evt");
      b.pushEvent({
        id: evtId,
        type: "request",
        label: "Request received",
        detail: "Atlas Voice Gateway · live",
        timestamp: clockStamp(),
        status: "active",
        agent: "system",
      });

      try {
        const result = await api.sendChat({
          message: text,
          routingMode: mode,
          preferredAgent: mode === "auto" ? null : mode,
        });
        b.patchMessage(userId, { status: "complete" });
        b.updateEvent(evtId, { status: "complete" });
        controllerRef.current.adoptRequestId(result.requestId);
        reconcileText(b, result);
      } catch (failure) {
        b.patchMessage(userId, { status: "failed" });
        b.updateEvent(evtId, { status: "failed" });
        handleTurnFailure(failure);
      } finally {
        endTurn();
        b.markBusy(false);
      }
    },
    [endTurn, handleTurnFailure, reconcileText],
  );

  const sendText = useCallback(
    (raw: string) => {
      const b = bridgeRef.current;
      if (b.isBusy()) return;

      const text = raw.trim() || defaultPrompt;
      const sessionId = b.getSessionId();
      const userId = b.nextId("msg");
      b.pushMessage({
        id: userId,
        sender: mockOperator.name,
        senderType: "user",
        text,
        timestamp: clockStamp(),
        status: "sending",
      });
      controllerRef.current.begin(b.nextId("turn"), "text", sessionId, userId);
      b.markBusy(true);
      void runTextTurn(text, userId, b.getRoutingMode(), sessionId);
    },
    [runTextTurn],
  );

  /* ------------------------------------------------------ event routing */

  const handleEvent = useCallback((event: GatewayEvent): boolean => {
    const controller = controllerRef.current;
    if (!controller.isActive()) return false;
    if (!controller.match({ sessionId: event.sessionId, requestId: event.requestId })) return false;

    const b = bridgeRef.current;
    const turn = controller.current;
    if (!turn) return false;

    switch (event.type) {
      case "audio_received": {
        b.pushEvent({
          id: b.nextId("evt"),
          type: "voice",
          label: "Audio received",
          detail: "Atlas Voice Gateway · validated",
          timestamp: clockStamp(),
          status: "complete",
          agent: "system",
        });
        return true;
      }
      case "transcription_started": {
        b.applyVoiceState("transcribing");
        b.updateSession((prev) => ({ ...prev, state: "transcribing" }));
        return true;
      }
      case "transcription_failed": {
        // The HTTP round-trip owns the user-facing error message.
        return true;
      }
      case "transcript_partial": {
        if (event.text) b.setPartialLine(event.text);
        return true;
      }
      case "transcript_final": {
        b.clearPartialLine();
        const text = (event.text ?? "").trim();
        if (text) {
          b.pushTranscript("final", text);
          b.updateSession((prev) => ({ ...prev, finalTranscript: text }));
          if (turn.kind === "voice" && !turn.userMessageId) {
            const id = b.nextId("msg");
            b.pushMessage({
              id,
              sender: mockOperator.name,
              senderType: "user",
              text,
              timestamp: clockStamp(),
              status: "complete",
            });
            controller.setUserMessage(id);
          }
        }
        return true;
      }
      case "routing_started": {
        b.applyVoiceState("routing");
        b.updateSession((prev) => ({ ...prev, state: "routing" }));
        b.pushTranscript("status", event.label ?? "Routing request...");
        b.pushEvent({
          id: b.nextId("evt"),
          type: "route",
          label: "Routing request",
          detail: event.intent ?? "Gateway router",
          timestamp: clockStamp(),
          status: "active",
          agent: "system",
        });
        return true;
      }
      case "agent_selected": {
        if (!event.agent) return true;
        const selected = event.agent;
        b.updateSession((prev) => ({ ...prev, selectedAgent: selected }));
        b.pushTranscript("status", `${selected.toUpperCase()} selected`);
        b.pushEvent({
          id: b.nextId("evt"),
          type: "route",
          label: `${selected.toUpperCase()} selected`,
          detail: "Gateway decision",
          timestamp: clockStamp(),
          status: "complete",
          agent: selected,
        });
        return true;
      }
      case "agent_thinking": {
        b.applyVoiceState("thinking");
        b.updateSession((prev) => ({ ...prev, state: "thinking" }));
        b.pushTranscript("status", `${(event.agent ?? "agent").toUpperCase()} thinking...`);
        return true;
      }
      case "response_started": {
        const agentId = event.agent ?? b.getSelectedAgent();
        if (!agentId) return true;
        if (!turn.assistantMessageId) {
          const id = b.nextId("msg");
          controller.setAssistantMessage(id);
          b.pushMessage({
            id,
            sender: b.nameForAgent(agentId),
            senderType: agentId,
            text: "",
            timestamp: clockStamp(),
            status: "processing",
          });
        }
        b.applyVoiceState(agentId === "hal" ? "hal-speaking" : "tron-speaking");
        b.setAgentSpeaking(agentId, true);
        b.updateSession((prev) => ({
          ...prev,
          selectedAgent: agentId,
          state: agentId === "hal" ? "hal-speaking" : "tron-speaking",
          responseStartedAt: Date.now(),
          canInterrupt: true,
        }));
        b.pushTranscript("agent", `${b.nameForAgent(agentId)} speaking`);
        b.pushEvent({
          id: b.nextId("evt"),
          type: "generate",
          label: "Agent responding",
          detail: `${b.nameForAgent(agentId)} · gateway`,
          timestamp: clockStamp(),
          status: "active",
          agent: agentId,
        });
        return true;
      }
      case "response_delta": {
        const id = turn.assistantMessageId;
        const chunk = event.delta ?? event.text ?? "";
        if (!id || !chunk) return true;
        b.appendMessageText(id, chunk);
        return true;
      }
      case "response_complete": {
        const agentId = event.agent ?? b.getSelectedAgent();
        if (turn.assistantMessageId) {
          const patch: Partial<ChatMessage> = { status: "complete" };
          if (event.text) patch.text = event.text;
          if (event.model) patch.model = event.model;
          if (typeof event.latency === "number") patch.latency = event.latency;
          b.patchMessage(turn.assistantMessageId, patch);
        }
        if (agentId) b.setAgentSpeaking(agentId, false);
        return true;
      }
      case "error": {
        // The HTTP round-trip reports the failure with a typed banner, so the
        // socket event is consumed here to avoid a duplicate message.
        return true;
      }
      default:
        return false;
    }
  }, []);

  const interrupt = useCallback(() => {
    const b = bridgeRef.current;
    const turn = controllerRef.current.current;
    if (turn?.assistantMessageId) {
      b.patchMessage(turn.assistantMessageId, { status: "interrupted" });
    }
    controllerRef.current.finish();
  }, []);

  return useMemo(
    () => ({ isCapturing: () => capturingRef.current, startCapture, endCapture, sendText, handleEvent, interrupt, reset }),
    [startCapture, endCapture, sendText, handleEvent, interrupt, reset],
  );
}