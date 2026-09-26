import AiCore from "@/pages/console/components/AiCore";
import StatusBadge from "@/components/base/StatusBadge";
import { agentTheme } from "@/pages/console/agentTheme";
import type { Agent } from "@/pages/console/types";

interface AgentPanelProps {
  agent: Agent;
  onTalk: () => void;
  onToggleMute: () => void;
  onDetails: () => void;
}

/**
 * Compact agent card used in the desktop side rails and the mobile agent row.
 *
 * Identity, online state, current model and the live voice state sit up top;
 * the heavier telemetry (metrics, services, subsystems, host detail) lives in
 * the existing Details modal so the card stays light and the conversation area
 * stays dominant. HAL and TRON remain visually distinct through their themes.
 */
export default function AgentPanel({ agent, onTalk, onToggleMute, onDetails }: AgentPanelProps) {
  const theme = agentTheme[agent.id];
  const speaking = agent.isSpeaking;
  const muted = agent.isMuted;
  const offline = !agent.available;

  const voiceLabel = offline ? "Offline" : speaking ? "Speaking" : muted ? "Muted" : "Voice idle";
  const voiceTone = offline
    ? "text-accent-300"
    : speaking
      ? theme.text
      : muted
        ? "text-foreground-500"
        : "text-foreground-600";
  const voiceIcon = offline
    ? "ri-plug-line"
    : speaking
      ? "ri-volume-up-fill"
      : muted
        ? "ri-volume-mute-line"
        : "ri-mic-line";

  return (
    <section
      className={`flex w-full flex-col gap-3 rounded-xl border bg-background-100/80 p-3 ${
        speaking ? theme.borderStrong : theme.border
      }`}
    >
      <div className="flex items-start gap-3">
        <div className={offline ? "opacity-45" : ""}>
          <AiCore variant={agent.id} size={64} speaking={speaking} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className={`font-heading text-sm font-semibold tracking-[0.22em] ${theme.text}`}>
              {agent.name}
            </h2>
            <StatusBadge state={agent.status} label={speaking ? "Speaking" : undefined} pill />
          </div>
          <p className="mt-0.5 truncate text-[11px] text-foreground-600">{agent.role}</p>
          <span
            className={`mt-1.5 inline-flex items-center gap-1.5 font-label text-[9px] uppercase tracking-[0.16em] ${voiceTone}`}
          >
            <i className={`${voiceIcon} text-[11px]`} />
            {voiceLabel}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-2 rounded-lg border border-background-300/50 bg-background-200/40 px-2.5 py-1.5">
        <i className={`ri-cpu-line text-[11px] ${theme.text}`} />
        <span className="truncate font-label text-[10px] text-foreground-700" title={agent.model}>
          {agent.model}
        </span>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onTalk}
          className={`flex min-w-0 flex-1 cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-2 font-label text-[10px] uppercase tracking-[0.16em] text-background-50 transition-colors ${theme.solid} ${theme.solidHover}`}
        >
          <i className="ri-mic-line text-sm" />
          Talk
        </button>
        <button
          type="button"
          onClick={onToggleMute}
          aria-label={muted ? `Unmute ${agent.name}` : `Mute ${agent.name}`}
          aria-pressed={muted}
          title={muted ? `Unmute ${agent.name}` : `Mute ${agent.name}`}
          className={`flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-lg border transition-colors ${
            muted
              ? "border-background-300/70 bg-background-200/60 text-foreground-500"
              : `${theme.border} ${theme.bgSoft} ${theme.text}`
          }`}
        >
          <i className={`text-sm ${muted ? "ri-volume-mute-line" : "ri-volume-up-line"}`} />
        </button>
        <button
          type="button"
          onClick={onDetails}
          aria-label={`${agent.name} details`}
          title={`${agent.name} details`}
          className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-background-300/70 bg-background-200/60 text-foreground-600 transition-colors hover:text-foreground-900"
        >
          <i className="ri-information-line text-sm" />
        </button>
      </div>
    </section>
  );
}