import type { ReactNode } from "react";
import type { GatewayErrorInfo } from "@/pages/console/gateway/contracts";
import type { AgentId, FailoverState, VoiceError } from "@/pages/console/types";
import { VOICE_ERROR_HINTS, VOICE_ERROR_LABELS } from "@/pages/console/types";

interface VoiceStatusBannerProps {
  voiceError: VoiceError | null;
  gatewayError: GatewayErrorInfo | null;
  failover: FailoverState | null;
  onRetry: () => void;
  onDismissError: () => void;
  onRetryGateway: () => void;
  onDismissGateway: () => void;
  onResolveFailover: (agent: AgentId) => void;
  onDismissFailover: () => void;
}

/**
 * Inline status banner that sits right above the voice controls. Renders voice
 * errors, gateway errors and simulated failover states — never a browser alert.
 */
export default function VoiceStatusBanner({
  voiceError,
  gatewayError,
  failover,
  onRetry,
  onDismissError,
  onRetryGateway,
  onDismissGateway,
  onResolveFailover,
  onDismissFailover,
}: VoiceStatusBannerProps) {
  if (voiceError) {
    return (
      <Banner
        tone="error"
        icon="ri-error-warning-line"
        title={VOICE_ERROR_LABELS[voiceError]}
        detail={VOICE_ERROR_HINTS[voiceError]}
        actions={
          <>
            <ActionButton icon="ri-refresh-line" label="Retry" onClick={onRetry} tone="error" />
            <ActionButton icon="ri-close-line" label="Cancel" onClick={onDismissError} />
          </>
        }
      />
    );
  }

  if (gatewayError) {
    return (
      <Banner
        tone="error"
        icon="ri-cloud-off-line"
        title={gatewayError.message}
        detail="No response was generated — the console never fabricates an answer when the gateway fails."
        codeBadge={gatewayError.code ? `code: ${gatewayError.code}` : undefined}
        actions={
          <>
            <ActionButton
              icon="ri-refresh-line"
              label="Retry"
              onClick={onRetryGateway}
              tone="error"
            />
            <ActionButton icon="ri-close-line" label="Dismiss" onClick={onDismissGateway} />
          </>
        }
      />
    );
  }

  if (failover && failover.kind === "agent-unavailable") {
    return (
      <Banner
        tone="warn"
        icon="ri-plug-line"
        title={failover.message}
        detail="The selected agent is not reachable. Route the request elsewhere or cancel."
        actions={
          <>
            {failover.suggested && (
              <ActionButton
                icon="ri-shuffle-line"
                label={`Route to ${failover.suggested.toUpperCase()}`}
                onClick={() => onResolveFailover(failover.suggested as AgentId)}
                tone="warn"
              />
            )}
            <ActionButton icon="ri-close-line" label="Cancel" onClick={onDismissFailover} />
          </>
        }
      />
    );
  }

  if (failover && failover.kind === "all-offline") {
    return (
      <Banner
        tone="error"
        icon="ri-cloud-off-line"
        title={failover.message}
        detail="Both local agents are offline. No cloud fallback is configured for this console."
        actions={<ActionButton icon="ri-close-line" label="Cancel" onClick={onDismissFailover} />}
        extra={
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-background-300/50 bg-background-200/40 px-3 py-2">
            <i className="ri-cloud-line text-sm text-foreground-500" />
            <span className="text-[11px] text-foreground-700">Cloud fallback</span>
            <span className="rounded border border-background-300/60 bg-background-100/60 px-2 py-0.5 font-label text-[10px] uppercase tracking-[0.14em] text-foreground-500">
              Not configured
            </span>
            <span className="font-label text-[10px] uppercase tracking-[0.14em] text-foreground-500">
              placeholder row
            </span>
          </div>
        }
      />
    );
  }

  return null;
}

interface BannerProps {
  tone: "error" | "warn";
  icon: string;
  title: string;
  detail: string;
  actions: ReactNode;
  extra?: ReactNode;
  codeBadge?: string;
}

const bannerTone: Record<BannerProps["tone"], string> = {
  error: "border-accent-500/45 bg-accent-500/10",
  warn: "border-primary-500/40 bg-primary-500/10",
};

const iconTone: Record<BannerProps["tone"], string> = {
  error: "text-accent-400",
  warn: "text-primary-300",
};

function Banner({ tone, icon, title, detail, actions, extra, codeBadge }: BannerProps) {
  return (
    <div
      role="status"
      className={`flex flex-col gap-2 rounded-lg border px-3 py-2.5 atlas-rise ${bannerTone[tone]}`}
    >
      <div className="flex flex-wrap items-start gap-3">
        <span className="flex min-w-0 flex-1 items-start gap-2.5">
          <i className={`${icon} mt-0.5 text-base ${iconTone[tone]}`} />
          <span className="flex min-w-0 flex-col">
            <span className="font-heading text-xs font-semibold uppercase tracking-[0.16em] text-foreground-950">
              {title}
            </span>
            <span className="text-[11px] leading-relaxed text-foreground-600">{detail}</span>
            {codeBadge && (
              <span className="mt-1 inline-flex w-fit items-center rounded border border-accent-500/40 bg-accent-500/10 px-1.5 py-0.5 font-label text-[9px] uppercase tracking-[0.16em] text-accent-300">
                {codeBadge}
              </span>
            )}
          </span>
        </span>
        <span className="flex flex-wrap items-center gap-2">{actions}</span>
      </div>
      {extra}
    </div>
  );
}

interface ActionButtonProps {
  icon: string;
  label: string;
  onClick: () => void;
  tone?: "default" | "error" | "warn";
}

const actionTone: Record<NonNullable<ActionButtonProps["tone"]>, string> = {
  default: "border-background-300/70 bg-background-200/60 text-foreground-700 hover:text-foreground-900",
  error: "border-accent-500/50 bg-accent-500/15 text-accent-300 hover:border-accent-500/80",
  warn: "border-primary-500/50 bg-primary-500/15 text-primary-300 hover:border-primary-500/80",
};

function ActionButton({ icon, label, onClick, tone = "default" }: ActionButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-lg border px-3 py-1.5 font-label text-[10px] uppercase tracking-[0.16em] transition-colors ${actionTone[tone]}`}
    >
      <i className={`${icon} text-xs`} />
      {label}
    </button>
  );
}