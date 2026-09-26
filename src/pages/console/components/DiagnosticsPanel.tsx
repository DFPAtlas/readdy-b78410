import { useState } from "react";
import type { GatewayDiagnostics } from "@/pages/console/gateway/client";
import { GATEWAY_MODE_LABELS } from "@/pages/console/gateway/contracts";
import type { MicCaptureDiagnostics } from "@/pages/console/hooks/useMicCapture";

interface DiagnosticsPanelProps {
  diagnostics: GatewayDiagnostics;
  configured: boolean;
  /** Live microphone diagnostics — safe metadata only, never raw audio. */
  mic?: MicCaptureDiagnostics;
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

/** Tenths-of-a-second duration, e.g. `9.4s`. */
const formatMs = (value: number): string => {
  const total = Math.max(0, Math.floor(value));
  return `${Math.floor(total / 1000)}.${Math.floor((total % 1000) / 100)}s`;
};

/** Human clip size, or an em dash when no clip was produced yet. */
const formatBytes = (value: number | null): string => {
  if (value === null) return "—";
  if (value < 1024) return `${value} B`;
  return `${(value / 1024).toFixed(1)} KB`;
};

const TRACK_STATE_LABELS: Record<MicCaptureDiagnostics["trackState"], string> = {
  live: "Live",
  muted: "Muted",
  ended: "Ended",
  unknown: "Unknown",
};

interface Row {
  label: string;
  value: string;
  icon: string;
}

/**
 * Collapsible developer diagnostics. Frontend-safe values only — never any
 * secret, credential, token, raw audio or transcript.
 */
export default function DiagnosticsPanel({ diagnostics, configured, mic }: DiagnosticsPanelProps) {
  const [open, setOpen] = useState(false);

  const rows: Row[] = [
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

  const micRows: Row[] = mic
    ? [
        { label: "Microphone", value: mic.deviceLabel, icon: "ri-mic-line" },
        { label: "Recording duration", value: formatMs(mic.durationMs), icon: "ri-timer-line" },
        { label: "Clip size", value: formatBytes(mic.clipSizeBytes), icon: "ri-file-music-line" },
        {
          label: "Audio track",
          value: mic.levelAvailable
            ? `${TRACK_STATE_LABELS[mic.trackState]} · meter live`
            : TRACK_STATE_LABELS[mic.trackState],
          icon: "ri-plug-2-line",
        },
        {
          label: "Input level (peak)",
          value: mic.levelAvailable ? `${Math.round(mic.peakLevel * 100)}%` : "unavailable",
          icon: "ri-bar-chart-2-line",
        },
      ]
    : [];

  const renderRow = (row: Row) => (
    <div key={row.label} className="flex items-center justify-between gap-3">
      <span className="flex items-center gap-1.5 font-label text-[10px] uppercase tracking-[0.14em] text-foreground-500">
        <i className={`${row.icon} text-[11px]`} />
        {row.label}
      </span>
      <span className="truncate font-label text-[10px] text-foreground-800">{row.value}</span>
    </div>
  );

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
          {rows.map(renderRow)}

          {micRows.length > 0 && (
            <>
              <div className="mt-1 flex items-center gap-2 border-t border-background-300/50 pt-2">
                <i className="ri-mic-line text-[11px] text-secondary-300" />
                <span className="font-label text-[9px] uppercase tracking-[0.18em] text-foreground-500">
                  Microphone capture
                </span>
              </div>
              {micRows.map(renderRow)}
            </>
          )}

          <p className="mt-1 font-label text-[9px] uppercase leading-relaxed tracking-[0.14em] text-foreground-500">
            Safe frontend values only · no secrets and no raw audio are ever shown or stored
          </p>
        </div>
      )}
    </div>
  );
}