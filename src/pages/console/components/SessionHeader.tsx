import { useEffect, useState, type ReactNode } from "react";
import StatusBadge from "@/components/base/StatusBadge";
import SimulationMenu from "@/pages/console/components/SimulationMenu";
import { VOICE_STATE_LABELS, formatDuration } from "@/pages/console/session";
import { agentTheme } from "@/pages/console/agentTheme";
import type { AgentId, RoutingMode, VoiceError, VoiceState } from "@/pages/console/types";

interface SessionHeaderProps {
  sessionId: string;
  mode: RoutingMode;
  activeAgent: AgentId | null;
  voiceState: VoiceState;
  startedAt: number | null;
  continuous: boolean;
  halAvailable: boolean;
  tronAvailable: boolean;
  gatewayOnline: boolean;
  gatewayLocked: boolean;
  onToggleAgent: (agent: AgentId, available: boolean) => void;
  onToggleGateway: () => void;
  onSimulateError: (error: VoiceError) => void;
}

const modeLabel: Record<RoutingMode, string> = {
  hal: "HAL",
  auto: "AUTO",
  tron: "TRON",
};

const stateTone: Record<VoiceState, string> = {
  idle: "text-foreground-700",
  listening: "text-accent-300",
  transcribing: "text-primary-300",
  routing: "text-primary-300",
  thinking: "text-primary-300",
  "hal-speaking": "text-accent-300",
  "tron-speaking": "text-secondary-300",
  error: "text-accent-300",
};

/** Compact current-session indicator shown above the conversation feed. */
export default function SessionHeader({
  sessionId,
  mode,
  activeAgent,
  voiceState,
  startedAt,
  continuous,
  halAvailable,
  tronAvailable,
  gatewayOnline,
  gatewayLocked,
  onToggleAgent,
  onToggleGateway,
  onSimulateError,
}: SessionHeaderProps) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const duration = startedAt ? formatDuration(now - startedAt) : "00:00";
  const agentTone = activeAgent ? agentTheme[activeAgent].text : "text-foreground-700";

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-background-300/60 bg-background-200/40 px-4 py-2.5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        <Meta label="Mode">
          <span className="font-label text-[11px] uppercase tracking-[0.16em] text-foreground-900">
            {modeLabel[mode]}
          </span>
        </Meta>
        <Meta label="Agent">
          <span
            className={`font-heading text-[11px] font-semibold uppercase tracking-[0.18em] ${
              activeAgent ? agentTone : "text-foreground-500"
            }`}
          >
            {activeAgent ? activeAgent.toUpperCase() : "—"}
          </span>
        </Meta>
        <Meta label="Voice">
          <span
            className={`font-label text-[11px] uppercase tracking-[0.14em] ${stateTone[voiceState]}`}
          >
            {VOICE_STATE_LABELS[voiceState]}
          </span>
        </Meta>
        <Meta label="Session">
          <span className="font-label text-[11px] tabular-nums text-foreground-800">{duration}</span>
        </Meta>
        <Meta label="Continuous">
          <span
            className={`flex items-center gap-1.5 font-label text-[11px] uppercase tracking-[0.14em] ${
              continuous ? "text-secondary-300" : "text-foreground-500"
            }`}
          >
            <i className={continuous ? "ri-loop-right-line" : "ri-loop-left-line"} />
            {continuous ? "On" : "Off"}
          </span>
        </Meta>
      </div>

      <div className="ml-auto flex flex-wrap items-center gap-2">
        <span className="hidden items-center gap-1.5 font-label text-[10px] uppercase tracking-[0.16em] text-foreground-500 lg:flex">
          <i className="ri-fingerprint-line text-[11px]" />
          {sessionId}
        </span>
        <span className="flex items-center gap-1.5">
          <StatusBadge state={halAvailable ? "connected" : "disconnected"} label="HAL" />
          <StatusBadge state={tronAvailable ? "connected" : "disconnected"} label="TRON" />
        </span>
        <SimulationMenu
          halAvailable={halAvailable}
          tronAvailable={tronAvailable}
          gatewayOnline={gatewayOnline}
          gatewayLocked={gatewayLocked}
          onToggleAgent={onToggleAgent}
          onToggleGateway={onToggleGateway}
          onSimulateError={onSimulateError}
        />
      </div>
    </div>
  );
}

function Meta({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className="flex items-center gap-2">
      <span className="font-label text-[10px] uppercase tracking-[0.18em] text-foreground-500">
        {label}
      </span>
      {children}
    </span>
  );
}