import RoutingSelector from "@/pages/console/components/RoutingSelector";
import VoiceStatusBanner from "@/pages/console/components/VoiceStatusBanner";
import Waveform from "@/pages/console/components/Waveform";
import { VOICE_STATE_LABELS } from "@/pages/console/session";
import type { GatewayErrorInfo, GatewayMode } from "@/pages/console/gateway/contracts";
import type {
  Agent,
  AgentId,
  FailoverState,
  RoutingMode,
  VoiceError,
  VoiceState,
} from "@/pages/console/types";

interface VoiceControlProps {
  voiceState: VoiceState;
  speakingAgent: AgentId | null;
  routingMode: RoutingMode;
  agents: Record<AgentId, Agent>;
  continuous: boolean;
  busy: boolean;
  inputValue: string;
  voiceError: VoiceError | null;
  gatewayError: GatewayErrorInfo | null;
  gatewayMode: GatewayMode;
  failover: FailoverState | null;
  onRoutingChange: (mode: RoutingMode) => void;
  onToggleContinuous: () => void;
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

const waveTone: Record<VoiceState, "primary" | "accent" | "secondary" | "foreground"> = {
  idle: "foreground",
  listening: "accent",
  transcribing: "primary",
  routing: "primary",
  thinking: "primary",
  "hal-speaking": "accent",
  "tron-speaking": "secondary",
  error: "accent",
};

export default function VoiceControl({
  voiceState,
  speakingAgent,
  routingMode,
  agents,
  continuous,
  busy,
  inputValue,
  voiceError,
  gatewayError,
  gatewayMode,
  failover,
  onRoutingChange,
  onToggleContinuous,
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
    voiceState === "listening" || voiceState === "transcribing" || isSpeaking;
  const routeLabel = routingMode === "auto" ? "AUTO" : routingMode.toUpperCase();
  const ringTone =
    speakingAgent === "tron" ? "border-secondary-500/50" : "border-accent-500/50";
  const mutedIds = (["hal", "tron"] as AgentId[]).filter((id) => agents[id].isMuted);

  return (
    <section className="flex flex-col gap-3 border-t border-background-300/60 bg-background-100/80 px-4 py-3 md:px-6">
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

      <div className="flex flex-wrap items-center justify-between gap-3">
        <RoutingSelector value={routingMode} onChange={onRoutingChange} />

        <div className="flex flex-wrap items-center gap-2">
          <span className="font-label text-[10px] uppercase tracking-[0.18em] text-foreground-500">
            Route · <span className="text-foreground-900">{routeLabel}</span>
          </span>
          <button
            type="button"
            onClick={onToggleContinuous}
            aria-pressed={continuous}
            className={`flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 font-label text-[10px] uppercase tracking-[0.16em] transition-colors ${
              continuous
                ? "border-secondary-500/50 bg-secondary-500/15 text-secondary-300"
                : "border-background-300/60 bg-background-200/60 text-foreground-500 hover:text-foreground-900"
            }`}
          >
            <i className="ri-loop-right-line text-[11px]" />
            Continuous conversation
          </button>
          {mutedIds.map((id) => (
            <span
              key={id}
              className="flex items-center gap-1 rounded-full border border-background-300/60 bg-background-200/60 px-2 py-0.5 font-label text-[10px] uppercase tracking-[0.16em] text-foreground-500"
            >
              <i className="ri-volume-mute-line text-[11px]" />
              {agents[id].name} muted
            </span>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-center gap-5">
        <Waveform
          bars={16}
          active={waveActive}
          tone={waveTone[voiceState]}
          height={30}
          className="hidden lg:flex"
        />

        <div className="flex flex-col items-center gap-1.5">
          <div className="relative flex items-center justify-center">
            {(waveActive || (busy && voiceState !== "error")) && (
              <>
                <span className={`absolute h-20 w-20 rounded-full border ${ringTone} atlas-pulse-ring`} />
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

          {isSpeaking ? (
            <span className="flex items-center gap-1.5 rounded-full border border-accent-500/50 bg-accent-500/15 px-2.5 py-0.5 font-label text-[10px] uppercase tracking-[0.18em] text-accent-300">
              <i className="ri-stop-circle-line text-[11px]" />
              Interrupt
            </span>
          ) : (
            <span className="hidden font-label text-[10px] uppercase tracking-[0.14em] text-foreground-500 xl:block">
              {state.hint}
            </span>
          )}
        </div>

        <Waveform
          bars={16}
          active={waveActive}
          tone={waveTone[voiceState]}
          height={30}
          className="hidden lg:flex"
        />
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
          <span className="hidden font-label text-[10px] uppercase tracking-[0.16em] text-foreground-500 md:block">
            → {routeLabel}
          </span>
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
    </section>
  );
}