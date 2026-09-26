import { useEffect, useRef, useState } from "react";
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

interface MenuItemProps {
  icon: string;
  label: string;
  hint: string;
  onClick: () => void;
  active?: boolean;
}

function MenuItem({ icon, label, hint, onClick, active = false }: MenuItemProps) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="flex w-full cursor-pointer items-start gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors hover:bg-background-200/70"
    >
      <i
        className={`${icon} mt-0.5 text-sm ${active ? "text-primary-400" : "text-foreground-500"}`}
      />
      <span className="flex min-w-0 flex-col">
        <span
          className={`whitespace-nowrap font-label text-[11px] uppercase tracking-[0.12em] ${
            active ? "text-foreground-950" : "text-foreground-700"
          }`}
        >
          {label}
        </span>
        <span className="text-[10px] leading-snug text-foreground-500">{hint}</span>
      </span>
      {active && <i className="ri-check-line ml-auto mt-0.5 text-xs text-primary-400" />}
    </button>
  );
}

/**
 * Conversation toolbar controls. New and Stop stay visible because they are the
 * primary actions; everything less-used (clear transcript, per-agent mute,
 * continuous conversation) is grouped under one clearly labelled Options menu.
 */
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
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <ControlButton
        icon="ri-add-line"
        label="New"
        onClick={onNewConversation}
        title="Start a new conversation"
      />
      <ControlButton
        icon="ri-stop-circle-line"
        label="Stop"
        onClick={onStopSpeaking}
        disabled={!canStop}
        tone="accent"
        title="Stop the agent that is currently speaking"
      />

      <div ref={menuRef} className="relative">
        <ControlButton
          icon="ri-equalizer-line"
          label="Options"
          onClick={() => setOpen((prev) => !prev)}
          active={open}
          title="More conversation controls"
        />
        {open && (
          <div
            role="menu"
            aria-label="Conversation options"
            className="absolute right-0 z-30 mt-1.5 w-64 rounded-lg border border-background-300/70 bg-background-100 p-1.5 atlas-rise"
          >
            <MenuItem
              icon="ri-delete-bin-6-line"
              label="Clear transcript"
              hint="Clears the console log · stored memory is untouched"
              onClick={() => {
                onClearTranscript();
                setOpen(false);
              }}
            />
            <span className="mx-1.5 my-1 block h-px bg-background-300/60" />
            <MenuItem
              icon={mutedHal ? "ri-volume-mute-line" : "ri-volume-up-line"}
              label={mutedHal ? "Unmute HAL" : "Mute HAL"}
              hint="Agent voice output for HAL"
              active={mutedHal}
              onClick={() => {
                onToggleMute("hal");
                setOpen(false);
              }}
            />
            <MenuItem
              icon={mutedTron ? "ri-volume-mute-line" : "ri-volume-up-line"}
              label={mutedTron ? "Unmute TRON" : "Mute TRON"}
              hint="Agent voice output for TRON"
              active={mutedTron}
              onClick={() => {
                onToggleMute("tron");
                setOpen(false);
              }}
            />
            <span className="mx-1.5 my-1 block h-px bg-background-300/60" />
            <MenuItem
              icon={continuous ? "ri-loop-right-line" : "ri-loop-left-line"}
              label="Continuous conversation"
              hint="Auto-return to listening after each reply"
              active={continuous}
              onClick={() => {
                onToggleContinuous();
                setOpen(false);
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}