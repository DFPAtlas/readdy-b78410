import { useCallback, useEffect, useMemo, useRef } from "react";
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
import { useMicCapture, type MicCaptureDiagnostics } from "@/pages/console/hooks/useMicCapture";
import {
  MicError,
  extensionForMimeType,
  type MicErrorKind,
  type RecordedClip,
} from "@/pages/console/audio/micRecorder";
import { GatewayError } from "@/pages/console/gateway/client";
import { SpeechPlayer } from "@/pages/console/audio/speechPlayer";
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
  /** Whether agent voice output is enabled by the operator (top-bar switch). */
  getVoiceOutput: () => boolean;
  /** Whether the given agent is muted in the console (suppresses playback). */
  getAgentMuted: (agent: AgentId) => boolean;
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
  /** Clear any lingering voice error at the start of a NEW attempt. */
  clearVoiceError: () => void;
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
  /** Stop any audible reply playback and release its audio resources. */
  stopPlayback: () => void;
  /** Abort any capture and drop the active turn (used by session cancel). */
  reset: () => void;
  /** Live input level (0..1) while recording — drives the meter. */
  inputLevel: number;
  /** Live microphone diagnostics for the Developer Diagnostics panel. */
  micDiagnostics: MicCaptureDiagnostics;
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

  // Single reusable audio element + object-URL owner for agent speech.
  const speechPlayerRef = useRef<SpeechPlayer | null>(null);
  if (speechPlayerRef.current === null) speechPlayerRef.current = new SpeechPlayer();
  // The clip currently playing (for the gateway cancellation acknowledgement).
  const activePlaybackRef = useRef<{ requestId: string; sessionId: string; agent: AgentId } | null>(
    null,
  );
  // Bumped whenever playback starts/stops so a clip fetched for an aborted turn
  // can never begin playing after a newer attempt has taken over.
  const playbackEpochRef = useRef(0);
  // The gateway's real code/message for a failed synthesis, captured from the
  // `speech_failed` event so the HTTP reconcile can report the exact reason.
  const speechFailureRef = useRef<{ code?: string; message?: string } | null>(null);

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
      silent: "microphone-silent",
      "device-muted": "microphone-muted",
      failure: "microphone-unavailable",
    };
    const kind = mapping[error.kind] ?? "microphone-unavailable";
    capturingRef.current = false;
    startPromiseRef.current = null;
    controllerRef.current.clear();
    bridgeRef.current.raiseVoiceError(kind, error.detail || VOICE_ERROR_HINTS[kind]);
  }, []);

  /* ------------------------------------------------------- speech playback */

  /**
   * Stop any audible reply and release its audio + object URL.
   *
   * When a clip is active the gateway is told `stopped` — its confirmed
   * cancellation mechanism, which also drops the short-lived audio resource.
   */
  const stopPlayback = useCallback((acknowledge = true) => {
    playbackEpochRef.current += 1;
    speechPlayerRef.current?.release();
    const active = activePlaybackRef.current;
    activePlaybackRef.current = null;
    if (acknowledge && active) {
      void bridgeRef.current.getGateway().reportPlayback(active.requestId, {
        sessionId: active.sessionId,
        agent: active.agent === "hal" ? "atlas-hal" : "atlas-tron",
        state: "stopped",
      });
    }
  }, []);

  useEffect(
    () => () => {
      // Unmount: release the audio element and object URL, and best-effort drop
      // the gateway-side clip. No audio resource survives the console.
      playbackEpochRef.current += 1;
      speechPlayerRef.current?.release();
      const active = activePlaybackRef.current;
      activePlaybackRef.current = null;
      if (active) {
        void bridgeRef.current.getGateway().reportPlayback(active.requestId, {
          sessionId: active.sessionId,
          agent: active.agent === "hal" ? "atlas-hal" : "atlas-tron",
          state: "stopped",
        });
      }
    },
    [],
  );

  /**
   * Fetch the synthesized clip through the gateway client and play it once.
   *
   * "Speaking" is only set once audio is actually audible; until then the
   * console shows the distinct "Preparing voice" state. A failure keeps the text
   * reply and raises a specific voice-output error.
   */
  const startPlayback = useCallback(
    async (
      b: LiveVoiceBridge,
      params: {
        requestId: string | null;
        sessionId: string;
        agent: AgentId;
        audioRef: string;
      },
    ) => {
      const api = b.getGateway();
      const epoch = ++playbackEpochRef.current;
      const speakingState: VoiceState = params.agent === "hal" ? "hal-speaking" : "tron-speaking";

      const finishIdle = () => {
        b.setAgentSpeaking(params.agent, false);
        b.applyVoiceState("idle");
        b.updateSession((prev) => ({ ...prev, state: "idle", canInterrupt: false }));
      };

      b.setAgentSpeaking(params.agent, false);
      b.applyVoiceState("preparing-voice");
      b.updateSession((prev) => ({ ...prev, state: "preparing-voice", canInterrupt: true }));
      b.pushEvent({
        id: b.nextId("evt"),
        type: "voice",
        label: "Preparing voice",
        detail: `${b.nameForAgent(params.agent)} · synthesizing speech`,
        timestamp: clockStamp(),
        status: "active",
        agent: params.agent,
      });

      let blob: Blob;
      try {
        blob = await api.fetchSpeechAudio(params.audioRef);
      } catch (failure) {
        if (epoch !== playbackEpochRef.current) return;
        finishIdle();
        const detail =
          failure instanceof GatewayError && failure.detail
            ? failure.detail
            : "The synthesized audio could not be downloaded.";
        b.raiseVoiceError("synthesis-failed", detail);
        return;
      }

      // The turn was cancelled / a newer attempt took over while we fetched.
      if (epoch !== playbackEpochRef.current) return;

      activePlaybackRef.current = {
        requestId: params.requestId ?? "",
        sessionId: params.sessionId,
        agent: params.agent,
      };

      await speechPlayerRef.current?.start(blob, {
        onStart: () => {
          if (epoch !== playbackEpochRef.current) return;
          b.setAgentSpeaking(params.agent, true);
          b.applyVoiceState(speakingState);
          b.updateSession((prev) => ({
            ...prev,
            state: speakingState,
            selectedAgent: params.agent,
            canInterrupt: true,
          }));
          b.pushTranscript("agent", `${b.nameForAgent(params.agent)} speaking`);
          if (params.requestId) {
            void api.reportPlayback(params.requestId, {
              sessionId: params.sessionId,
              agent: params.agent === "hal" ? "atlas-hal" : "atlas-tron",
              state: "started",
            });
          }
        },
        onEnd: () => {
          if (epoch !== playbackEpochRef.current) return;
          activePlaybackRef.current = null;
          if (params.requestId) {
            void api.reportPlayback(params.requestId, {
              sessionId: params.sessionId,
              agent: params.agent === "hal" ? "atlas-hal" : "atlas-tron",
              state: "ended",
            });
          }
          finishIdle();
          b.pushEvent({
            id: b.nextId("evt"),
            type: "done",
            label: "Response complete",
            detail: `${b.nameForAgent(params.agent)} → console`,
            timestamp: clockStamp(),
            status: "complete",
            agent: params.agent,
          });
          b.scheduleContinuous();
        },
        onError: (detail) => {
          if (epoch !== playbackEpochRef.current) return;
          activePlaybackRef.current = null;
          finishIdle();
          b.raiseVoiceError("synthesis-failed", detail);
        },
      });
    },
    [],
  );

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

    // --- Voice output ---------------------------------------------------
    // The text reply above is already reconciled and is ALWAYS kept. From here
    // we only decide whether that reply is also spoken.
    const voiceOutputOn = b.getVoiceOutput();
    const muted = selected ? b.getAgentMuted(selected) : false;
    const requestId = result.requestId ?? turn.requestId;
    const audioRef = result.audioRef ?? null;

    const finishIdle = () => {
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
    };

    // Synthesis failure: the reply stands, only the voice output failed. The
    // gateway's real code is included when the event supplied one.
    if (result.speechStatus === "failed") {
      const failure = speechFailureRef.current;
      const codeSuffix = failure?.code ? ` (code: ${failure.code})` : "";
      const detail = failure?.message?.trim()
        ? `${failure.message}${codeSuffix}`
        : `The gateway could not synthesize a voice reply${codeSuffix}.`;
      if (selected) b.setAgentSpeaking(selected, false);
      b.applyVoiceState("idle");
      b.updateSession((prev) => ({ ...prev, state: "idle", canInterrupt: false }));
      b.raiseVoiceError("synthesis-failed", detail);
      b.scheduleContinuous();
      return;
    }

    const producedAudio = !!selected && result.speechStatus === "synthesized" && !!audioRef;

    if (producedAudio && selected && audioRef) {
      if (!voiceOutputOn || muted) {
        // Audio was produced but this turn must stay silent (voice output off,
        // or the agent is muted): drop the clip instead of leaving it to expire.
        if (requestId) {
          void b.getGateway().reportPlayback(requestId, {
            sessionId: result.sessionId,
            agent: selected === "hal" ? "atlas-hal" : "atlas-tron",
            state: "stopped",
          });
        }
        finishIdle();
        return;
      }

      // Play exactly one clip. Playback owns the idle transition + continuous
      // scheduling, so the turn is NOT closed here.
      void startPlayback(b, {
        requestId,
        sessionId: result.sessionId,
        agent: selected,
        audioRef,
      });
      return;
    }

    finishIdle();
  }, [startPlayback]);

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
    // A new attempt always silences the previous reply and clears its synthesis
    // failure record, so nothing from the last turn leaks into this one.
    stopPlayback();
    speechFailureRef.current = null;
    // A brand-new attempt owns its own status: drop the previous attempt's
    // voice error and gateway error so a stale banner can never linger.
    b.clearVoiceError();
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
        // Voice output switch controls synthesis: when it is ON the gateway
        // synthesizes the reply in the selected agent's voice (returned as a
        // short-lived audio resource); when it is OFF we ask for text only, so
        // no CPU is spent and no audio is ever fetched or played.
        form.append("speak", b.getVoiceOutput() ? "true" : "false");

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
    stopPlayback();
    speechFailureRef.current = null;
    capture.cancel();
    capturingRef.current = false;
    startPromiseRef.current = null;
    controllerRef.current.clear();
  }, [capture, stopPlayback]);

  /* ------------------------------------------------------- text turns */

  const runTextTurn = useCallback(
    async (text: string, userId: string, mode: RoutingMode, sessionId: string) => {
      const b = bridgeRef.current;
      const api = b.getGateway();

      b.stopPartialReveal();
      b.clearPartialLine();
      b.clearTranscriptLines();
      // A new attempt silences any reply still playing and clears the previous
      // synthesis failure record.
      stopPlayback();
      speechFailureRef.current = null;
      // Each new attempt clears the previous attempt's banners immediately.
      b.clearVoiceError();
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
        if (turn.kind === "voice") {
          // Voice turns own "speaking" through REAL audio playback: the reply
          // text streams first with no sound, so the console shows the reply
          // being composed until synthesized audio actually starts.
          b.setAgentSpeaking(agentId, false);
          b.applyVoiceState("thinking");
          b.updateSession((prev) => ({
            ...prev,
            selectedAgent: agentId,
            state: "thinking",
            responseStartedAt: Date.now(),
            canInterrupt: true,
          }));
        } else {
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
        }
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
      case "speech_synthesis_started": {
        const agentLabel = (event.agent ?? b.getSelectedAgent() ?? "agent").toUpperCase();
        b.applyVoiceState("preparing-voice");
        b.updateSession((prev) => ({ ...prev, state: "preparing-voice", canInterrupt: true }));
        b.pushTranscript("status", `${agentLabel} preparing voice...`);
        return true;
      }
      case "speech_ready": {
        // The clip is synthesized and waiting to be played. Playback is started
        // from the HTTP response's audioRef, so the state stays "preparing".
        b.applyVoiceState("preparing-voice");
        return true;
      }
      case "speech_started": {
        const agentId = event.agent ?? b.getSelectedAgent();
        if (!agentId) return true;
        b.setAgentSpeaking(agentId, true);
        b.applyVoiceState(agentId === "hal" ? "hal-speaking" : "tron-speaking");
        b.updateSession((prev) => ({
          ...prev,
          state: agentId === "hal" ? "hal-speaking" : "tron-speaking",
          canInterrupt: true,
        }));
        return true;
      }
      case "speech_ended":
      case "speech_cancelled": {
        const agentId = event.agent ?? b.getSelectedAgent();
        if (agentId) b.setAgentSpeaking(agentId, false);
        return true;
      }
      case "speech_failed": {
        // Record the gateway's real error code/message. The HTTP response owns
        // the single user-facing message, so the failure is reported once.
        speechFailureRef.current = { code: event.code, message: event.message };
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
    stopPlayback();
    const turn = controllerRef.current.current;
    if (turn?.assistantMessageId) {
      b.patchMessage(turn.assistantMessageId, { status: "interrupted" });
    }
    controllerRef.current.finish();
  }, [stopPlayback]);

  return useMemo(
    () => ({
      isCapturing: () => capturingRef.current,
      startCapture,
      endCapture,
      sendText,
      handleEvent,
      interrupt,
      stopPlayback,
      reset,
      inputLevel: capture.level,
      micDiagnostics: capture.diagnostics,
    }),
    [
      capture.diagnostics,
      capture.level,
      startCapture,
      endCapture,
      sendText,
      handleEvent,
      interrupt,
      stopPlayback,
      reset,
    ],
  );
}