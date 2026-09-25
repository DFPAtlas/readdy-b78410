import AiCore from "@/pages/console/components/AiCore";
import Waveform from "@/pages/console/components/Waveform";
import MetricDisplay from "@/components/base/MetricDisplay";
import StatusBadge from "@/components/base/StatusBadge";
import { agentTheme } from "@/pages/console/agentTheme";
import type { Agent } from "@/pages/console/types";

interface AgentPanelProps {
  agent: Agent;
  compact?: boolean;
  onTalk: () => void;
  onToggleMute: () => void;
  onDetails: () => void;
}

/**
 * One reusable panel used by every agent. HAL and TRON only differ by the data
 * passed in (id drives the theme + AI core), never by layout logic.
 */
export default function AgentPanel({
  agent,
  compact = false,
  onTalk,
  onToggleMute,
  onDetails,
}: AgentPanelProps) {
  const theme = agentTheme[agent.id];
  const tone = agent.id === "hal" ? "accent" : "secondary";
  const speaking = agent.isSpeaking;
  const muted = agent.isMuted;
  const offline = !agent.available;
  const statusLabel = speaking ? "Speaking" : undefined;

  if (compact) {
    return (
      <section
        className={`flex flex-col gap-3 rounded-xl border ${theme.border} bg-background-100/70 p-3`}
      >
        <div className="flex items-center gap-3">
          <div className={offline ? "opacity-45" : ""}>
            <AiCore variant={agent.id} size={56} speaking={speaking} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2
                className={`font-heading text-sm font-semibold tracking-[0.22em] ${theme.text}`}
              >
                {agent.name}
              </h2>
              <StatusBadge state={agent.status} label={statusLabel} pill />
            </div>
            <p className="truncate text-[11px] text-foreground-600">{agent.role}</p>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={onTalk}
              aria-label={`Talk to ${agent.name}`}
              className={`flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg ${theme.solid} text-background-50 transition-colors ${theme.solidHover}`}
            >
              <i className="ri-mic-line text-sm" />
            </button>
            <button
              type="button"
              onClick={onToggleMute}
              aria-label={muted ? `Unmute ${agent.name}` : `Mute ${agent.name}`}
              className={`flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border transition-colors ${
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
              className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border border-background-300/70 bg-background-200/60 text-foreground-600 transition-colors hover:text-foreground-900"
            >
              <i className="ri-information-line text-sm" />
            </button>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 rounded-lg border border-background-300/50 bg-background-200/40 px-3 py-2">
          <span className="font-label truncate text-[10px] uppercase tracking-[0.14em] text-foreground-500">
            {agent.model}
          </span>
          <Waveform bars={10} active={speaking} tone={tone} height={18} barWidth={2} />
        </div>
      </section>
    );
  }

  return (
    <section
      className={`flex h-full w-[288px] flex-col gap-4 rounded-xl border ${theme.border} bg-background-100/70 p-4`}
    >
      <div className="flex items-start justify-between">
        <div className="flex flex-col">
          <span className="font-label text-[10px] uppercase tracking-[0.24em] text-foreground-500">
            Agent
          </span>
          <h2 className={`font-heading text-lg font-semibold tracking-[0.26em] ${theme.text}`}>
            {agent.name}
          </h2>
        </div>
        <StatusBadge state={agent.status} label={statusLabel} pill size="md" />
      </div>

      <div className="flex flex-col items-center gap-3 border-y border-background-300/50 py-4">
        <div className={offline ? "opacity-45" : ""}>
          <AiCore variant={agent.id} size={148} speaking={speaking} />
        </div>
        <div className="flex h-6 items-center">
          <Waveform bars={20} active={speaking} tone={tone} height={24} />
        </div>
        <span className="font-label text-[10px] uppercase tracking-[0.2em] text-foreground-500">
          {offline ? "Agent unavailable" : speaking ? "Voice active" : "Voice idle"}
        </span>
        {offline && (
          <span className="flex items-center gap-1.5 rounded-full border border-accent-500/40 bg-accent-500/10 px-2.5 py-0.5 font-label text-[10px] uppercase tracking-[0.16em] text-accent-300">
            <i className="ri-plug-line text-[11px]" />
            Offline · route or cancel
          </span>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="font-label text-[10px] uppercase tracking-[0.18em] text-foreground-500">
          Role
        </span>
        <p className="text-xs leading-relaxed text-foreground-800">{agent.role}</p>
      </div>

      <div className="flex flex-col gap-3 rounded-lg border border-background-300/50 bg-background-200/40 p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="font-label text-[10px] uppercase tracking-[0.16em] text-foreground-500">
            Model
          </span>
          <i className={`ri-cpu-line text-xs ${theme.text}`} />
        </div>
        <span className="font-label truncate text-[11px] text-foreground-900">{agent.model}</span>
        <div className="flex flex-col gap-2.5 pt-1">
          {agent.metrics.map((metric) => (
            <MetricDisplay
              key={metric.label}
              label={metric.label}
              value={metric.value}
              display={metric.display}
              tone={tone}
              unknown={agent.unknownFields?.includes(metric.label) ?? false}
            />
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <span className="font-label text-[10px] uppercase tracking-[0.18em] text-foreground-500">
          Services
        </span>
        {agent.services.map((service) => {
          const isVoice = service.label.toLowerCase() === "voice";
          const activeVoice = isVoice && speaking;
          const state = activeVoice ? "busy" : service.state;
          return (
            <div
              key={service.label}
              className="flex items-center justify-between rounded-lg border border-background-300/40 bg-background-200/30 px-2.5 py-1.5"
            >
              <span className="flex items-center gap-2">
                <StatusBadge state={state} showLabel={false} pulse={activeVoice} />
                <span className="text-[11px] text-foreground-700">{service.label}</span>
              </span>
              <span className="font-label text-[10px] uppercase tracking-[0.14em] text-foreground-500">
                {activeVoice ? "ACTIVE" : service.value}
              </span>
            </div>
          );
        })}
      </div>

      <div className="mt-auto flex flex-col gap-2">
        <button
          type="button"
          onClick={onTalk}
          className={`flex w-full cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-lg ${theme.solid} px-3 py-2.5 font-label text-[11px] uppercase tracking-[0.18em] text-background-50 transition-colors ${theme.solidHover}`}
        >
          <i className="ri-mic-line text-sm" />
          Talk to {agent.name}
        </button>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onToggleMute}
            className={`flex flex-1 cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-lg border px-3 py-2 font-label text-[11px] uppercase tracking-[0.16em] transition-colors ${
              muted
                ? "border-background-300/70 bg-background-200/60 text-foreground-500"
                : `${theme.border} ${theme.bgSoft} ${theme.text}`
            }`}
          >
            <i className={`text-sm ${muted ? "ri-volume-mute-line" : "ri-volume-up-line"}`} />
            {muted ? "Unmute" : "Mute"}
          </button>
          <button
            type="button"
            onClick={onDetails}
            className="flex flex-1 cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-lg border border-background-300/70 bg-background-200/60 px-3 py-2 font-label text-[11px] uppercase tracking-[0.16em] text-foreground-600 transition-colors hover:text-foreground-900"
          >
            <i className="ri-information-line text-sm" />
            Details
          </button>
        </div>
      </div>
    </section>
  );
}