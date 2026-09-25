import type { AgentId } from "@/pages/console/types";

interface ConversationControlsProps {
  continuous: boolean;
  canStop: boolean;
  mutedHal: boolean;
  mutedTron: boolean;
  onToggleContinuous: () => void;
  onNewConversation: () => void;
  onClearTranscript: () => void;
  onStopSpeaking: () => void;
  onToggleMute: (agent: AgentId) => void;
}

interface ControlButtonProps {
  icon: string;
  label: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  tone?: "default" | "accent" | "secondary";
  title?: string;
}

const toneActive: Record<NonNullable<ControlButtonProps["tone"]>, string> = {
  default: "border-primary-500/50 bg-primary-500/15 text-primary-300",
  accent: "border-accent-500/50 bg-accent-500/15 text-accent-300",
  secondary: "border-secondary-500/50 bg-secondary-500/15 text-secondary-300",
};

function ControlButton({
  icon,
  label,
  onClick,
  active = false,
  disabled = false,
  tone = "default",
  title,
}: ControlButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-pressed={active}
      className={`flex items-center gap-1.5 whitespace-nowrap rounded-lg border px-2.5 py-1.5 font-label text-[10px] uppercase tracking-[0.14em] transition-colors ${
        disabled
          ? "cursor-not-allowed border-background-300/50 bg-background-200/30 text-foreground-500 opacity-60"
          : active
            ? `cursor-pointer ${toneActive[tone]}`
            : "cursor-pointer border-background-300/70 bg-background-200/60 text-foreground-600 hover:text-foreground-900"
      }`}
    >
      <i className={`${icon} text-xs`} />
      {label}
    </button>
  );
}

/** Compact conversation + voice control strip. */
export default function ConversationControls({
  continuous,
  canStop,
  mutedHal,
  mutedTron,
  onToggleContinuous,
  onNewConversation,
  onClearTranscript,
  onStopSpeaking,
  onToggleMute,
}: ConversationControlsProps) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-background-300/60 bg-background-200/30 px-4 py-2">
      <ControlButton
        icon="ri-add-line"
        label="New"
        onClick={onNewConversation}
        title="Start a new local conversation"
      />
      <ControlButton
        icon="ri-delete-bin-6-line"
        label="Clear"
        onClick={onClearTranscript}
        title="Clear the transcript (local mock session only)"
      />
      <ControlButton
        icon="ri-stop-circle-line"
        label="Stop"
        onClick={onStopSpeaking}
        disabled={!canStop}
        tone="accent"
        title="Stop the agent that is currently speaking"
      />
      <span className="mx-1 hidden h-4 w-px bg-background-300/70 sm:block" />
      <ControlButton
        icon={mutedHal ? "ri-volume-mute-line" : "ri-volume-up-line"}
        label="Mute HAL"
        onClick={() => onToggleMute("hal")}
        active={mutedHal}
        tone="accent"
      />
      <ControlButton
        icon={mutedTron ? "ri-volume-mute-line" : "ri-volume-up-line"}
        label="Mute TRON"
        onClick={() => onToggleMute("tron")}
        active={mutedTron}
        tone="secondary"
      />
      <span className="mx-1 hidden h-4 w-px bg-background-300/70 sm:block" />
      <ControlButton
        icon="ri-loop-right-line"
        label="Continuous"
        onClick={onToggleContinuous}
        active={continuous}
        tone="secondary"
        title="Automatically return to listening after each reply"
      />
    </div>
  );
}