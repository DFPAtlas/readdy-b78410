import RoutingSelector from "@/pages/console/components/RoutingSelector";
import VoiceStatusBanner from "@/pages/console/components/VoiceStatusBanner";
import LiveTranscript from "@/pages/console/components/LiveTranscript";
import { VOICE_STATE_LABELS } from "@/pages/console/session";
import type { GatewayErrorInfo, GatewayMode } from "@/pages/console/gateway/contracts";
import type {
  AgentId,
  FailoverState,
  RoutingMode,
  TranscriptLine,
  VoiceError,
  VoiceState,
} from "@/pages/console/types";

interface VoiceControlProps {
  voiceState: VoiceState;
  speakingAgent: AgentId | null;
  routingMode: RoutingMode;
  busy: boolean;
  inputValue: string;
  /** Live microphone input level (0..1) while recording. */
  inputLevel: number;
  /** Live transcript lines shown beside the microphone. */
  transcript: TranscriptLine[];
  /** True when the transcript genuinely comes from the local simulation. */
  transcriptSimulated: boolean;
  voiceError: VoiceError | null;
  gatewayError: GatewayErrorInfo | null;
  gatewayMode: GatewayMode;
  failover: FailoverState | null;
  onRoutingChange: (mode: RoutingMode) => void;
  onMicPointerDown: () => void;
  onMicPointerUp: () => void;
  onMicActivate: () => void;
  onInputChange: (value: string) => void;
  onSubmit: () => void;
  onRetry: () => void;
  onDismissError: () => void;
  onRetryGateway: () => void;
  onDismissGateway: () => void;
  onResolveFailover: (agent: AgentId) => void;
  onDismissFailover: () => void;
}

interface VoiceStateMeta {
  icon: string;
  button: string;
  caption: string;
  hint: string;
  spin?: boolean;
}

/** How every voice state renders in the microphone area. */
const voiceStateMeta: Record<VoiceState, VoiceStateMeta> = {
  idle: {
    icon: "ri-mic-line",
    button: "border-background-400 bg-background-200/80 text-foreground-700",
    caption: "text-foreground-500",
    hint: "Hold space or press the mic · press Escape to cancel",
  },
  recording: {
    icon: "ri-mic-fill",
    button: "border-accent-400 bg-accent-500/25 text-accent-300",
    caption: "text-accent-300",
    hint: "Recording · release to send",
  },
  uploading: {
    icon: "ri-upload-cloud-2-line",
    button: "border-primary-400 bg-primary-500/20 text-primary-300",
    caption: "text-primary-300",
    hint: "Sending audio to the Atlas Voice Gateway",
    spin: true,
  },
  listening: {
    icon: "ri-mic-fill",
    button: "border-accent-400 bg-accent-500/25 text-accent-300",
    caption: "text-accent-300",
    hint: "Capturing audio · release to transcribe",
  },
  transcribing: {
    icon: "ri-file-text-line",
    button: "border-primary-400 bg-primary-500/20 text-primary-300",
    caption: "text-primary-300",
    hint: "Converting speech to text",
  },
  routing: {
    icon: "ri-git-branch-line",
    button: "border-primary-400 bg-primary-500/20 text-primary-300",
    caption: "text-primary-300",
    hint: "Deciding which agent takes the request",
  },
  thinking: {
    icon: "ri-loader-4-line",
    button: "border-primary-400 bg-primary-500/20 text-primary-300",
    caption: "text-primary-300",
    hint: "Agent is reasoning over the request",
    spin: true,
  },
  "preparing-voice": {
    icon: "ri-voiceprint-line",
    button: "border-primary-400 bg-primary-500/20 text-primary-300",
    caption: "text-primary-300",
    hint: "Synthesizing the agent's voice before playback",
    spin: true,
  },
  "hal-speaking": {
    icon: "ri-volume-up-fill",
    button: "border-accent-400 bg-accent-500/30 text-accent-300",
    caption: "text-accent-200",
    hint: "Tap the mic to interrupt",
  },
  "tron-speaking": {
    icon: "ri-volume-up-fill",
    button: "border-secondary-400 bg-secondary-500/30 text-secondary-300",
    caption: "text-secondary-200",
    hint: "Tap the mic to interrupt",
  },
  error: {
    icon: "ri-error-warning-line",
    button: "border-accent-500 bg-accent-500/20 text-accent-300",
    caption: "text-accent-300",
    hint: "Retry or cancel the voice session",
  },
};

/** Colour tone + label for the selected send destination. */
function destinationMeta(mode: RoutingMode): { label: string; tone: string; icon: string } {
  if (mode === "hal") {
    return {
      label: "HAL",
      tone: "border-accent-500/50 bg-accent-500/15 text-accent-300",
      icon: "ri-server-line",
    };
  }
  if (mode === "tron") {
    return {
      label: "TRON",
      tone: "border-secondary-500/50 bg-secondary-500/15 text-secondary-300",
      icon: "ri-code-s-slash-line",
    };
  }
  return {
    label: "AUTO",
    tone: "border-primary-500/50 bg-primary-500/15 text-primary-300",
    icon: "ri-git-branch-line",
  };
}

/**
 * The single voice composer. The microphone, the live transcript, the routing
 * selector and the text input live in one panel, so a voice turn reads as one
 * flow: capture → transcript → destination → send.
 */
export default function VoiceControl({
  voiceState,
  speakingAgent,
  routingMode,
  busy,
  inputValue,
  inputLevel,
  transcript,
  transcriptSimulated,
  voiceError,
  gatewayError,
  gatewayMode,
  failover,
  onRoutingChange,
  onMicPointerDown,
  onMicPointerUp,
  onMicActivate,
  onInputChange,
  onSubmit,
  onRetry,
  onDismissError,
  onRetryGateway,
  onDismissGateway,
  onResolveFailover,
  onDismissFailover,
}: VoiceControlProps) {
  const state = voiceStateMeta[voiceState];
  const isSpeaking = speakingAgent !== null;
  const offline = gatewayMode === "offline";
  const waveActive =
    voiceState === "recording" ||
    voiceState === "uploading" ||
    voiceState === "listening" ||
    voiceState === "transcribing" ||
    isSpeaking;
  const ringTone = speakingAgent === "tron" ? "border-secondary-500/50" : "border-accent-500/50";
  const destination = destinationMeta(routingMode);
  const paused = busy && voiceState !== "error";

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-background-300/60 bg-background-100/80 px-3 py-3 md:px-4">
      <div className="flex flex-col gap-4 lg:flex-row">
        {/* ---------------------------------------------------- microphone */}
        <div className="flex flex-col items-center gap-1.5 lg:w-[184px] lg:shrink-0 lg:border-r lg:border-background-300/50 lg:pr-4">
          <div className="relative flex items-center justify-center">
            {(waveActive || paused) && (
              <>
                <span
                  className={`absolute h-20 w-20 rounded-full border ${ringTone} atlas-pulse-ring`}
                />
                <span
                  className={`absolute h-20 w-20 rounded-full border ${ringTone} atlas-pulse-ring`}
                  style={{ animationDelay: "1.1s" }}
                />
              </>
            )}
            <button
              type="button"
              onPointerDown={onMicPointerDown}
              onPointerUp={onMicPointerUp}
              onPointerCancel={onMicPointerUp}
              onClick={onMicActivate}
              onKeyDown={(event) => {
                if (event.code === "Space") event.preventDefault();
              }}
              aria-label={isSpeaking ? "Interrupt current reply" : "Push to talk"}
              className={`relative flex h-16 w-16 cursor-pointer select-none items-center justify-center rounded-full border-2 transition-colors ${state.button}`}
            >
              <i className={`${state.icon} text-2xl ${state.spin ? "animate-spin" : ""}`} />
            </button>
          </div>

          <span
            className={`font-heading text-[11px] font-semibold uppercase tracking-[0.24em] ${state.caption}`}
          >
            {VOICE_STATE_LABELS[voiceState]}
          </span>

          {voiceState === "recording" && (
            <div className="flex w-40 flex-col items-center gap-1">
              <div className="flex h-1.5 w-full items-center overflow-hidden rounded-full border border-background-300/60 bg-background-200/60">
                <span
                  className="h-full rounded-full bg-accent-400 transition-[width] duration-75"
                  style={{ width: `${Math.min(100, Math.round(inputLevel * 140))}%` }}
                />
              </div>
              <span className="font-label text-[9px] uppercase tracking-[0.16em] text-foreground-500">
                {inputLevel > 0.008
                  ? `Input ${Math.round(inputLevel * 100)}%`
                  : "Waiting for sound…"}
              </span>
            </div>
          )}

          {isSpeaking ? (
            <span className="flex items-center gap-1.5 rounded-full border border-accent-500/50 bg-accent-500/15 px-2.5 py-0.5 font-label text-[10px] uppercase tracking-[0.18em] text-accent-300">
              <i className="ri-stop-circle-line text-[11px]" />
              Interrupt
            </span>
          ) : (
            <span className="text-center font-label text-[10px] uppercase leading-relaxed tracking-[0.14em] text-foreground-500">
              {state.hint}
            </span>
          )}
        </div>

        {/* ----------------------------------- transcript · routing · input */}
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <VoiceStatusBanner
            voiceError={voiceError}
            gatewayError={gatewayError}
            failover={failover}
            onRetry={onRetry}
            onDismissError={onDismissError}
            onRetryGateway={onRetryGateway}
            onDismissGateway={onDismissGateway}
            onResolveFailover={onResolveFailover}
            onDismissFailover={onDismissFailover}
          />

          <LiveTranscript lines={transcript} simulated={transcriptSimulated} />

          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <RoutingSelector value={routingMode} onChange={onRoutingChange} />
            <span
              className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-label text-[10px] uppercase tracking-[0.16em] ${destination.tone}`}
            >
              <i className={`${destination.icon} text-[11px]`} />
              To {destination.label}
            </span>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-background-300/70 bg-background-200/50 px-3 py-2 transition-colors focus-within:border-primary-500/50">
              <i className="ri-chat-3-line text-sm text-foreground-500" />
              <input
                type="text"
                value={inputValue}
                onChange={(event) => onInputChange(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    onSubmit();
                  }
                }}
                placeholder="Talk to HAL or TRON..."
                aria-label="Message input"
                className="min-w-0 flex-1 bg-transparent text-sm text-foreground-900 placeholder:text-foreground-500 focus:outline-none"
              />
            </div>
            <button
              type="button"
              onClick={onSubmit}
              disabled={offline}
              title={offline ? "Voice Gateway unavailable · live send disabled" : undefined}
              className={`flex items-center justify-center gap-2 whitespace-nowrap rounded-lg px-5 py-2.5 font-label text-[11px] uppercase tracking-[0.2em] text-background-50 transition-colors ${
                offline
                  ? "cursor-not-allowed bg-background-400 opacity-60"
                  : "cursor-pointer bg-primary-500 hover:bg-primary-400"
              }`}
            >
              <i className="ri-send-plane-2-line text-sm" />
              Send
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}