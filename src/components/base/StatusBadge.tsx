import type {
  AgentStatus,
  ConnectionState,
  HealthState,
  IndicatorTone,
} from "@/pages/console/types";

export type BadgeState = AgentStatus | ConnectionState | HealthState | IndicatorTone;

interface StatusBadgeProps {
  state: BadgeState;
  label?: string;
  showLabel?: boolean;
  size?: "sm" | "md";
  pill?: boolean;
  pulse?: boolean;
  className?: string;
}

interface BadgeMeta {
  tone: IndicatorTone;
  label: string;
  icon: string;
  spin?: boolean;
}

/**
 * Every badge resolves to an icon + a readable label, so the status is never
 * communicated by colour alone.
 */
const badgeMeta: Record<BadgeState, BadgeMeta> = {
  online: { tone: "ok", label: "Online", icon: "ri-checkbox-circle-fill" },
  connected: { tone: "ok", label: "Connected", icon: "ri-link" },
  ok: { tone: "ok", label: "OK", icon: "ri-checkbox-circle-fill" },
  busy: { tone: "busy", label: "Busy", icon: "ri-loader-3-line", spin: true },
  connecting: { tone: "busy", label: "Connecting", icon: "ri-loader-4-line", spin: true },
  degraded: { tone: "warn", label: "Degraded", icon: "ri-error-warning-fill" },
  idle: { tone: "idle", label: "Idle", icon: "ri-pause-circle-fill" },
  offline: { tone: "error", label: "Offline", icon: "ri-close-circle-fill" },
  disconnected: { tone: "error", label: "Disconnected", icon: "ri-link-unlink" },
  na: { tone: "idle", label: "N/A", icon: "ri-subtract-fill" },
  warn: { tone: "warn", label: "Warning", icon: "ri-alert-fill" },
  error: { tone: "error", label: "Error", icon: "ri-close-circle-fill" },
};

const toneText: Record<IndicatorTone, string> = {
  ok: "text-secondary-300",
  busy: "text-primary-300",
  warn: "text-accent-300",
  error: "text-accent-400",
  idle: "text-foreground-500",
};

const tonePill: Record<IndicatorTone, string> = {
  ok: "border-secondary-500/35 bg-secondary-500/10",
  busy: "border-primary-500/35 bg-primary-500/10",
  warn: "border-accent-500/35 bg-accent-500/10",
  error: "border-accent-500/50 bg-accent-500/15",
  idle: "border-background-300/60 bg-background-200/50",
};

export default function StatusBadge({
  state,
  label,
  showLabel = true,
  size = "sm",
  pill = false,
  pulse = false,
  className = "",
}: StatusBadgeProps) {
  const meta = badgeMeta[state];
  const text = label ?? meta.label;
  const iconSize = size === "sm" ? "text-[10px]" : "text-xs";
  const labelSize = size === "sm" ? "text-[10px]" : "text-[11px]";

  return (
    <span
      className={`inline-flex items-center gap-1.5 ${
        pill ? `rounded-full border px-2 py-0.5 ${tonePill[meta.tone]}` : ""
      } ${className}`}
    >
      <i
        className={`${meta.icon} ${iconSize} ${toneText[meta.tone]} ${
          meta.spin ? "animate-spin" : pulse ? "atlas-blink" : ""
        }`}
        aria-hidden="true"
      />
      {showLabel ? (
        <span
          className={`whitespace-nowrap font-label uppercase tracking-[0.16em] ${labelSize} ${toneText[meta.tone]}`}
        >
          {text}
        </span>
      ) : (
        <span className="sr-only">{text}</span>
      )}
    </span>
  );
}