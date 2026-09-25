import StatusBadge from "@/components/base/StatusBadge";
import {
  GATEWAY_CONNECTION_LABELS,
  GATEWAY_MODE_HINTS,
  GATEWAY_MODE_LABELS,
} from "@/pages/console/gateway/contracts";
import type {
  GatewayConnectionState,
  GatewayMode,
} from "@/pages/console/gateway/contracts";

interface ModeIndicatorProps {
  mode: GatewayMode;
  connection: GatewayConnectionState;
  detail: string;
  notice?: string | null;
}

interface ModeTone {
  icon: string;
  pill: string;
  text: string;
}

const modeTone: Record<GatewayMode, ModeTone> = {
  live: {
    icon: "ri-broadcast-line",
    pill: "border-secondary-500/45 bg-secondary-500/12",
    text: "text-secondary-300",
  },
  demo: {
    icon: "ri-flask-line",
    pill: "border-primary-500/40 bg-primary-500/10",
    text: "text-primary-300",
  },
  offline: {
    icon: "ri-cloud-off-line",
    pill: "border-accent-500/45 bg-accent-500/12",
    text: "text-accent-300",
  },
};

const connectionBadge: Record<GatewayConnectionState, string> = {
  disconnected: "disconnected",
  connecting: "connecting",
  connected: "connected",
  reconnecting: "connecting",
  degraded: "degraded",
  error: "offline",
};

/**
 * Small LIVE / DEMO / OFFLINE indicator. Colour is never the only signal — the
 * label and the connection badge always carry the meaning.
 */
export default function ModeIndicator({
  mode,
  connection,
  detail,
  notice,
}: ModeIndicatorProps) {
  const tone = modeTone[mode];

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span
        className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1 ${tone.pill}`}
        title={GATEWAY_MODE_HINTS[mode]}
      >
        <i className={`${tone.icon} text-xs ${tone.text}`} />
        <span className={`font-label text-[10px] uppercase tracking-[0.18em] ${tone.text}`}>
          {GATEWAY_MODE_LABELS[mode]}
        </span>
        <span className="hidden font-label text-[10px] uppercase tracking-[0.14em] text-foreground-500 xl:inline">
          · {detail}
        </span>
      </span>

      {mode !== "demo" && (
        <StatusBadge state={connectionBadge[connection]} label={GATEWAY_CONNECTION_LABELS[connection]} />
      )}

      {notice && mode !== "demo" && (
        <span className="flex items-center gap-1.5 rounded-lg border border-background-300/60 bg-background-200/50 px-2.5 py-1 font-label text-[10px] uppercase tracking-[0.14em] text-foreground-600">
          <i className="ri-loader-4-line animate-spin text-[11px]" />
          {notice}
        </span>
      )}
    </div>
  );
}