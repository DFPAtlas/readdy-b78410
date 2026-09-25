import { useState } from "react";
import type { GatewayDiagnostics } from "@/pages/console/gateway/client";
import { GATEWAY_MODE_LABELS } from "@/pages/console/gateway/contracts";

interface DiagnosticsPanelProps {
  diagnostics: GatewayDiagnostics;
  configured: boolean;
}

const pad = (value: number) => value.toString().padStart(2, "0");

const formatHeartbeat = (value: number | null): string => {
  if (!value) return "—";
  const date = new Date(value);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
};

const formatRelative = (value: number | null): string => {
  if (!value) return "never";
  const seconds = Math.max(0, Math.round((Date.now() - value) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  return `${Math.round(seconds / 60)}m ago`;
};

/**
 * Collapsible developer diagnostics. Frontend-safe values only — never any
 * secret, credential or token.
 */
export default function DiagnosticsPanel({ diagnostics, configured }: DiagnosticsPanelProps) {
  const [open, setOpen] = useState(false);

  const rows: { label: string; value: string; icon: string }[] = [
    { label: "Application mode", value: GATEWAY_MODE_LABELS[diagnostics.mode], icon: "ri-flask-line" },
    { label: "Gateway host", value: configured ? diagnostics.host : "not configured", icon: "ri-global-line" },
    { label: "Connection", value: diagnostics.connection, icon: "ri-plug-line" },
    { label: "WebSocket", value: diagnostics.socket, icon: "ri-node-tree" },
    { label: "Session ID", value: diagnostics.sessionId, icon: "ri-fingerprint-line" },
    { label: "Active request", value: diagnostics.activeRequestId ?? "—", icon: "ri-send-plane-2-line" },
    { label: "Last event", value: diagnostics.lastEventType ?? "—", icon: "ri-pulse-line" },
    {
      label: "Last heartbeat",
      value: `${formatHeartbeat(diagnostics.lastHeartbeat)} (${formatRelative(diagnostics.lastHeartbeat)})`,
      icon: "ri-heart-pulse-line",
    },
    { label: "Reconnect attempt", value: String(diagnostics.reconnectAttempt), icon: "ri-loop-right-line" },
  ];

  return (
    <div className="mt-3 border-t border-background-300/60 pt-3">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        className="flex w-full cursor-pointer items-center justify-between gap-2 rounded-lg border border-background-300/60 bg-background-200/50 px-3 py-2 transition-colors hover:border-primary-500/40"
      >
        <span className="flex items-center gap-2">
          <i className="ri-terminal-box-line text-xs text-primary-300" />
          <span className="font-label text-[10px] uppercase tracking-[0.18em] text-foreground-700">
            Developer diagnostics
          </span>
        </span>
        <i className={`${open ? "ri-arrow-up-s-line" : "ri-arrow-down-s-line"} text-sm text-foreground-500`} />
      </button>

      {open && (
        <div className="mt-2 flex flex-col gap-1.5 rounded-lg border border-background-300/50 bg-background-200/30 p-2.5 atlas-rise">
          {rows.map((row) => (
            <div key={row.label} className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-1.5 font-label text-[10px] uppercase tracking-[0.14em] text-foreground-500">
                <i className={`${row.icon} text-[11px]`} />
                {row.label}
              </span>
              <span className="truncate font-label text-[10px] text-foreground-800">{row.value}</span>
            </div>
          ))}
          <p className="mt-1 font-label text-[9px] uppercase leading-relaxed tracking-[0.14em] text-foreground-500">
            Safe frontend values only · no secrets are ever shown
          </p>
        </div>
      )}
    </div>
  );
}