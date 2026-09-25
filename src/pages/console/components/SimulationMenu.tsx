import { useEffect, useRef, useState } from "react";
import type { AgentId, VoiceError } from "@/pages/console/types";

interface SimulationMenuProps {
  halAvailable: boolean;
  tronAvailable: boolean;
  gatewayOnline: boolean;
  /** Live mode drives the gateway link from the service layer, not the sim. */
  gatewayLocked: boolean;
  onToggleAgent: (agent: AgentId, available: boolean) => void;
  onToggleGateway: () => void;
  onSimulateError: (error: VoiceError) => void;
}

const errorTriggers: { id: VoiceError; label: string; icon: string }[] = [
  { id: "transcription-failed", label: "Transcription failed", icon: "ri-file-text-line" },
  { id: "synthesis-failed", label: "Synthesis failed", icon: "ri-volume-mute-line" },
  { id: "response-timeout", label: "Response timeout", icon: "ri-timer-line" },
  { id: "microphone-unavailable", label: "Microphone unavailable", icon: "ri-mic-off-line" },
];

/**
 * Demo-only control surface. Lets the operator toggle simulated availability and
 * trigger voice error states. Nothing here talks to a real service.
 */
export default function SimulationMenu({
  halAvailable,
  tronAvailable,
  gatewayOnline,
  gatewayLocked,
  onToggleAgent,
  onToggleGateway,
  onSimulateError,
}: SimulationMenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const rows: {
    id: string;
    label: string;
    on: boolean;
    toggle: () => void;
    locked?: boolean;
  }[] = [
    {
      id: "hal",
      label: "HAL available",
      on: halAvailable,
      toggle: () => onToggleAgent("hal", !halAvailable),
    },
    {
      id: "tron",
      label: "TRON available",
      on: tronAvailable,
      toggle: () => onToggleAgent("tron", !tronAvailable),
    },
    {
      id: "gateway",
      label: "Voice gateway online",
      on: gatewayOnline,
      toggle: onToggleGateway,
      locked: gatewayLocked,
    },
  ];

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-label="Simulation controls"
        className={`flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-lg border px-2.5 py-1.5 font-label text-[10px] uppercase tracking-[0.16em] transition-colors ${
          open
            ? "border-primary-500/60 bg-primary-500/15 text-primary-300"
            : "border-background-300/70 bg-background-200/60 text-foreground-600 hover:text-foreground-900"
        }`}
      >
        <i className="ri-flask-line text-xs" />
        Sim
      </button>

      {open && (
        <div className="absolute right-0 top-10 z-40 w-72 rounded-xl border border-background-300/70 bg-background-100 p-4 atlas-rise">
          <div className="mb-3 flex flex-col">
            <span className="font-heading text-xs font-semibold uppercase tracking-[0.2em] text-foreground-900">
              Simulation
            </span>
            <span className="font-label text-[10px] uppercase tracking-[0.14em] text-foreground-500">
              Demo only · no live services
            </span>
          </div>

          <div className="flex flex-col gap-2">
            {rows.map((row) => (
              <button
                key={row.id}
                type="button"
                onClick={row.toggle}
                disabled={row.locked}
                title={row.locked ? "Controlled by the live gateway service" : undefined}
                className={`flex items-center justify-between gap-3 rounded-lg border border-background-300/60 bg-background-200/50 px-3 py-2 text-left transition-colors hover:border-primary-500/40 ${
                  row.locked ? "cursor-not-allowed opacity-60" : "cursor-pointer"
                }`}
              >
                <span className="text-xs text-foreground-900">{row.label}</span>
                <span
                  className={`relative h-4 w-8 shrink-0 rounded-full transition-colors ${
                    row.on ? "bg-secondary-500" : "bg-background-400"
                  }`}
                >
                  <span
                    className={`absolute top-0.5 h-3 w-3 rounded-full bg-background-950 transition-all ${
                      row.on ? "left-4" : "left-0.5"
                    }`}
                  />
                </span>
              </button>
            ))}
          </div>

          <div className="mt-3 border-t border-background-300/60 pt-3">
            <span className="font-label text-[10px] uppercase tracking-[0.16em] text-foreground-500">
              Trigger voice error
            </span>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {errorTriggers.map((trigger) => (
                <button
                  key={trigger.id}
                  type="button"
                  onClick={() => {
                    onSimulateError(trigger.id);
                    setOpen(false);
                  }}
                  className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-accent-500/30 bg-accent-500/10 px-2 py-1.5 text-left font-label text-[10px] uppercase tracking-[0.12em] text-accent-300 transition-colors hover:border-accent-500/60"
                >
                  <i className={`${trigger.icon} text-[11px]`} />
                  {trigger.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}