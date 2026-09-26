import { useEffect, useRef, useState } from "react";
import StatusBadge from "@/components/base/StatusBadge";
import DiagnosticsPanel from "@/pages/console/components/DiagnosticsPanel";
import { GATEWAY_MODE_LABELS } from "@/pages/console/gateway/contracts";
import type { GatewayApi } from "@/pages/console/hooks/useVoiceGateway";
import type { MicCaptureDiagnostics } from "@/pages/console/hooks/useMicCapture";
import type { Agent, AgentId } from "@/pages/console/types";

interface TopBarProps {
  agents: Record<AgentId, Agent>;
  gateway: GatewayApi;
  /** Live microphone diagnostics for the developer diagnostics panel. */
  mic?: MicCaptureDiagnostics;
  /** Master voice-output switch — drives whether LIVE replies are synthesized. */
  voiceOutput: boolean;
  onToggleVoiceOutput: () => void;
}

interface SettingRow {
  id: "voice" | "auto" | "notify";
  label: string;
  hint: string;
}

const settingRows: SettingRow[] = [
  { id: "voice", label: "Voice output", hint: "Speak agent replies aloud" },
  { id: "auto", label: "Auto routing", hint: "Let the router pick the agent" },
  { id: "notify", label: "Activity alerts", hint: "Highlight new console events" },
];

const pad = (value: number) => value.toString().padStart(2, "0");

export default function TopBar({ agents, gateway, mic, voiceOutput, onToggleVoiceOutput }: TopBarProps) {
  const [now, setNow] = useState(() => new Date());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [toggles, setToggles] = useState<Record<SettingRow["id"], boolean>>({
    voice: true,
    auto: true,
    notify: true,
  });
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const onDown = (event: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) {
        setSettingsOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const agentList = Object.values(agents);
  const allOnline = agentList.every(
    (agent) => agent.status === "online" || agent.status === "busy",
  );

  const timeLabel = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  const dateLabel = now
    .toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "2-digit",
    })
    .toUpperCase();

  return (
    <header className="relative z-30 w-full border-b border-background-300/60 bg-background-100/70 backdrop-blur">
      <div className="flex w-full items-center gap-4 px-4 py-3 md:px-6">
        <div className="flex items-center gap-3">
          <div className="relative flex h-9 w-9 items-center justify-center rounded-lg border border-primary-500/40 bg-primary-500/10">
            <i className="ri-radar-line text-lg text-primary-400" />
            <span className="absolute inset-0 rounded-lg border border-primary-400/30 atlas-pulse-ring" />
          </div>
          <div className="flex flex-col">
            <h1 className="font-heading text-sm font-semibold uppercase tracking-[0.28em] text-foreground-950">
              Atlas Voice Console
            </h1>
            <span className="font-label text-[10px] uppercase tracking-[0.2em] text-foreground-500">
              Local AI operations surface
            </span>
          </div>
        </div>

        <div className="ml-auto flex items-center gap-2 md:gap-3">
          <div className="rounded-lg border border-secondary-500/30 bg-secondary-500/10 px-2.5 py-1.5">
            <StatusBadge
              state={allOnline ? "online" : "degraded"}
              label={allOnline ? "System online" : "System degraded"}
            />
          </div>

          <div className="hidden flex-col items-end sm:flex">
            <span className="font-label text-sm tabular-nums text-foreground-900">{timeLabel}</span>
            <span className="font-label text-[10px] uppercase tracking-[0.18em] text-foreground-500">
              {dateLabel}
            </span>
          </div>

          <div className="relative" ref={panelRef}>
            <button
              type="button"
              aria-label="Console settings"
              aria-expanded={settingsOpen}
              onClick={() => setSettingsOpen((prev) => !prev)}
              className={`flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg border transition-colors ${
                settingsOpen
                  ? "border-primary-500/60 bg-primary-500/15 text-primary-300"
                  : "border-background-300/70 bg-background-200/60 text-foreground-700 hover:border-primary-500/40 hover:text-primary-300"
              }`}
            >
              <i className="ri-settings-3-line text-base" />
            </button>

            {settingsOpen && (
              <div className="absolute right-0 top-11 z-40 w-72 rounded-xl border border-background-300/70 bg-background-100 p-4 atlas-rise">
                <div className="mb-3 flex items-center justify-between">
                  <span className="font-heading text-xs font-semibold uppercase tracking-[0.2em] text-foreground-900">
                    Console settings
                  </span>
                  <span className="font-label text-[10px] uppercase tracking-[0.16em] text-foreground-500">
                    atlas-2043
                  </span>
                </div>
                <div className="flex flex-col gap-2">
                  {settingRows.map((row) => {
                    const isOn = row.id === "voice" ? voiceOutput : toggles[row.id];
                    return (
                      <button
                        key={row.id}
                        type="button"
                        onClick={() => {
                          if (row.id === "voice") onToggleVoiceOutput();
                          else setToggles((prev) => ({ ...prev, [row.id]: !prev[row.id] }));
                        }}
                        className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-background-300/60 bg-background-200/50 px-3 py-2.5 text-left transition-colors hover:border-primary-500/40"
                      >
                        <span className="flex flex-col">
                          <span className="text-xs font-medium text-foreground-900">{row.label}</span>
                          <span className="text-[11px] text-foreground-500">{row.hint}</span>
                        </span>
                        <span
                          className={`relative h-4 w-8 shrink-0 rounded-full transition-colors ${
                            isOn ? "bg-primary-500" : "bg-background-400"
                          }`}
                        >
                          <span
                            className={`absolute top-0.5 h-3 w-3 rounded-full bg-background-950 transition-all ${
                              isOn ? "left-4" : "left-0.5"
                            }`}
                          />
                        </span>
                      </button>
                    );
                  })}
                </div>
                <div className="mt-3 border-t border-background-300/60 pt-3">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="font-label text-[10px] uppercase tracking-[0.18em] text-foreground-500">
                      Gateway mode
                    </span>
                    <span className="font-label text-[10px] uppercase tracking-[0.16em] text-foreground-700">
                      {GATEWAY_MODE_LABELS[gateway.mode]}
                    </span>
                  </div>
                  <div className="flex items-center gap-1 rounded-full border border-background-300/60 bg-background-200/50 p-1">
                    <button
                      type="button"
                      onClick={() => gateway.setPreference("demo")}
                      aria-pressed={gateway.preference === "demo"}
                      className={`flex flex-1 cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 font-label text-[10px] uppercase tracking-[0.16em] transition-colors ${
                        gateway.preference === "demo"
                          ? "bg-primary-500 text-background-950"
                          : "text-foreground-600 hover:text-foreground-900"
                      }`}
                    >
                      <i className="ri-flask-line text-[11px]" />
                      Demo
                    </button>
                    <button
                      type="button"
                      onClick={() => gateway.setPreference("live")}
                      disabled={!gateway.configured}
                      aria-pressed={gateway.preference === "live"}
                      title={gateway.configured ? undefined : "Set VITE_ATLAS_VOICE_GATEWAY_URL to enable live mode"}
                      className={`flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 font-label text-[10px] uppercase tracking-[0.16em] transition-colors ${
                        !gateway.configured
                          ? "cursor-not-allowed text-foreground-500 opacity-60"
                          : gateway.preference === "live"
                            ? "cursor-pointer bg-secondary-500 text-background-950"
                            : "cursor-pointer text-foreground-600 hover:text-foreground-900"
                      }`}
                    >
                      <i className="ri-broadcast-line text-[11px]" />
                      Live
                    </button>
                  </div>
                  <p className="mt-2 text-[10px] leading-relaxed text-foreground-500">
                    {gateway.configured
                      ? "Gateway URL detected from the environment. Live mode routes through the Atlas Voice Gateway only."
                      : "Voice Gateway not configured. Demo mode stays fully available."}
                  </p>
                </div>

                <DiagnosticsPanel diagnostics={gateway.diagnostics} configured={gateway.configured} mic={mic} />
              </div>
            )}
          </div>
        </div>
      </div>

    </header>
  );
}