import AiCore from "@/pages/console/components/AiCore";
import MetricDisplay from "@/components/base/MetricDisplay";
import StatusBadge from "@/components/base/StatusBadge";
import { agentTheme } from "@/pages/console/agentTheme";
import type { Agent, AgentId } from "@/pages/console/types";

interface AgentDetailsModalProps {
  agent: Agent | null;
  onClose: () => void;
  onTalk: (agent: AgentId) => void;
  onSetAvailable: (agent: AgentId, available: boolean) => void;
}

export default function AgentDetailsModal({
  agent,
  onClose,
  onTalk,
  onSetAvailable,
}: AgentDetailsModalProps) {
  if (!agent) return null;

  const theme = agentTheme[agent.id];
  const tone = agent.id === "hal" ? "accent" : "secondary";

  const rows = [
    { label: "Host", value: agent.host, icon: "ri-server-line" },
    { label: "Runtime", value: agent.runtime, icon: "ri-terminal-box-line" },
    { label: "Uptime", value: agent.uptime, icon: "ri-time-line" },
    { label: "Tasks today", value: String(agent.tasksToday), icon: "ri-pulse-line" },
    { label: "Voice path", value: agent.isMuted ? "MUTED" : "READY", icon: "ri-mic-2-line" },
    {
      label: "Latency",
      value: agent.unknownFields?.includes("latency") ? "Unknown" : `${agent.latency} ms`,
      icon: "ri-flashlight-line",
    },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background-50/85 p-4 backdrop-blur-sm">
      <div className="absolute inset-0 cursor-pointer" onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${agent.name} details`}
        className={`relative z-10 w-full max-w-2xl overflow-hidden rounded-xl border ${theme.borderStrong} bg-background-100 atlas-rise`}
      >
        <div className="flex items-center gap-4 border-b border-background-300/60 px-5 py-4">
          <AiCore variant={agent.id} size={64} />
          <div className="flex flex-col">
            <h3 className={`font-heading text-base font-semibold tracking-[0.26em] ${theme.text}`}>
              {agent.name}
            </h3>
            <span className="text-xs text-foreground-600">{agent.role}</span>
          </div>
          <div className="ml-auto rounded-full border border-background-300/60 bg-background-200/50 px-3 py-1">
            <StatusBadge state={agent.status} />
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close details"
            className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border border-background-300/70 bg-background-200/60 text-foreground-600 transition-colors hover:text-foreground-900"
          >
            <i className="ri-close-line text-base" />
          </button>
        </div>

        <div className="flex flex-col gap-5 px-5 py-5">
          <p className="text-xs leading-relaxed text-foreground-700">{agent.summary}</p>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {rows.map((row) => (
              <div
                key={row.label}
                className="flex flex-col gap-1 rounded-lg border border-background-300/50 bg-background-200/40 px-3 py-2.5"
              >
                <span className="flex items-center gap-1.5 font-label text-[10px] uppercase tracking-[0.16em] text-foreground-500">
                  <i className={`${row.icon} text-[11px] ${theme.text}`} />
                  {row.label}
                </span>
                <span className="font-label truncate text-[12px] text-foreground-900">
                  {row.value}
                </span>
              </div>
            ))}
          </div>

          <div className="rounded-lg border border-background-300/50 bg-background-200/40 p-4">
            <span className="font-label text-[10px] uppercase tracking-[0.18em] text-foreground-500">
              Current model
            </span>
            <p className="mt-1 font-label text-[12px] text-foreground-900">{agent.model}</p>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
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

          <div className="rounded-lg border border-background-300/50 bg-background-200/40 p-4">
            <span className="font-label text-[10px] uppercase tracking-[0.18em] text-foreground-500">
              Subsystems
            </span>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
              <SubsystemChip label="Ollama" state={agent.ollamaStatus} />
              <SubsystemChip label="Voice" state={agent.voiceStatus} />
              <SubsystemChip label="RAG" state={agent.ragStatus} />
              <SubsystemChip label="n8n" state={agent.n8nStatus} />
              <SubsystemChip label="GPU" state={agent.gpuUsage > 85 ? "degraded" : "ok"} />
              <SubsystemChip label="RAM" state={agent.ramUsage > 85 ? "degraded" : "ok"} />
            </div>
          </div>

          <div className="rounded-lg border border-background-300/50 bg-background-200/40 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="flex flex-col">
                <span className="font-label text-[10px] uppercase tracking-[0.18em] text-foreground-500">
                  Availability (simulation)
                </span>
                <span className="text-[11px] text-foreground-600">
                  Toggle to preview the offline and failover states. No live service is affected.
                </span>
              </span>
              <div className="flex items-center gap-1 rounded-full border border-background-300/60 bg-background-200/50 p-1">
                <button
                  type="button"
                  onClick={() => onSetAvailable(agent.id, true)}
                  aria-pressed={agent.available}
                  className={`cursor-pointer whitespace-nowrap rounded-full px-3 py-1.5 font-label text-[10px] uppercase tracking-[0.16em] transition-colors ${
                    agent.available
                      ? "bg-secondary-500 text-background-900"
                      : "text-foreground-600 hover:text-foreground-900"
                  }`}
                >
                  Available
                </button>
                <button
                  type="button"
                  onClick={() => onSetAvailable(agent.id, false)}
                  aria-pressed={!agent.available}
                  className={`cursor-pointer whitespace-nowrap rounded-full px-3 py-1.5 font-label text-[10px] uppercase tracking-[0.16em] transition-colors ${
                    !agent.available
                      ? "bg-accent-500 text-background-900"
                      : "text-foreground-600 hover:text-foreground-900"
                  }`}
                >
                  Unavailable
                </button>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-2 border-t border-background-300/60 pt-4 sm:flex-row sm:items-center sm:justify-between">
            <span className="font-label text-[10px] uppercase tracking-[0.14em] text-foreground-500">
              Placeholder telemetry · ready for live agent feed
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onClose}
                className="flex cursor-pointer items-center justify-center whitespace-nowrap rounded-lg border border-background-300/70 bg-background-200/60 px-4 py-2 font-label text-[11px] uppercase tracking-[0.16em] text-foreground-600 transition-colors hover:text-foreground-900"
              >
                Close
              </button>
              <button
                type="button"
                onClick={() => {
                  onTalk(agent.id);
                  onClose();
                }}
                className={`flex cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-lg ${theme.solid} px-4 py-2 font-label text-[11px] uppercase tracking-[0.16em] text-background-50 transition-colors ${theme.solidHover}`}
              >
                <i className="ri-mic-line text-sm" />
                Talk to {agent.name}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

interface SubsystemChipProps {
  label: string;
  state: Agent["ollamaStatus"];
}

function SubsystemChip({ label, state }: SubsystemChipProps) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-background-300/50 bg-background-200/30 px-3 py-2">
      <span className="text-[11px] text-foreground-700">{label}</span>
      <StatusBadge state={state} />
    </div>
  );
}