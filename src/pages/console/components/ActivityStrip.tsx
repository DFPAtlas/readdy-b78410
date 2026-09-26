import { useState } from "react";
import StatusBadge, { type BadgeState } from "@/components/base/StatusBadge";
import type { ActivityEvent, ActivityStatus, ActivityAgent } from "@/pages/console/types";

interface ActivityStripProps {
  events: ActivityEvent[];
}

const typeIcon: Record<string, string> = {
  voice: "ri-mic-line",
  route: "ri-route-line",
  request: "ri-inbox-unarchive-line",
  search: "ri-search-eye-line",
  generate: "ri-cpu-line",
  done: "ri-check-line",
  system: "ri-information-line",
  handoff: "ri-exchange-line",
  failover: "ri-shuffle-line",
  interrupt: "ri-stop-circle-line",
  error: "ri-error-warning-line",
};

const agentTone: Record<ActivityAgent, string> = {
  hal: "text-accent-400 border-accent-500/35 bg-accent-500/10",
  tron: "text-secondary-400 border-secondary-500/35 bg-secondary-500/10",
  system: "text-primary-400 border-primary-500/30 bg-primary-500/10",
};

const kindTone: Record<string, string> = {
  request: "text-foreground-600",
  route: "text-primary-400",
  search: "text-secondary-400",
  generate: "text-primary-400",
  voice: "text-accent-400",
  done: "text-secondary-400",
  system: "text-foreground-600",
  handoff: "text-primary-400",
  failover: "text-accent-400",
  interrupt: "text-accent-400",
  error: "text-accent-400",
};

const statusBadge: Record<ActivityStatus, BadgeState> = {
  pending: "idle",
  active: "busy",
  complete: "ok",
  failed: "error",
};

/**
 * Compact, expandable system activity feed. Collapsed it shows only the latest
 * meaningful event plus the running count, so it stops competing with the voice
 * dock; expanded it preserves the full scrollable event feed.
 */
export default function ActivityStrip({ events }: ActivityStripProps) {
  const [open, setOpen] = useState(false);
  const visible = events.slice(-14);
  const latest = events.length > 0 ? events[events.length - 1] : null;

  return (
    <section className="border-t border-background-300/60 bg-background-200/50 px-4 py-2 md:px-6">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        className="flex w-full cursor-pointer items-center gap-3 text-left"
      >
        <span className="flex shrink-0 items-center gap-2">
          <span className="relative flex h-2 w-2 items-center justify-center">
            <span className="absolute h-2 w-2 rounded-full bg-secondary-400 atlas-blink" />
          </span>
          <span className="font-heading text-[10px] font-semibold uppercase tracking-[0.22em] text-foreground-800">
            System activity
          </span>
        </span>

        <span className="flex min-w-0 flex-1 items-center gap-2">
          {!open && latest && (
            <span
              className={`flex min-w-0 items-center gap-2 rounded-lg border px-2.5 py-1 ${agentTone[latest.agent]}`}
            >
              <i
                className={`${typeIcon[latest.type] ?? "ri-information-line"} text-[11px] ${
                  kindTone[latest.type] ?? "text-foreground-600"
                }`}
              />
              <span className="truncate font-label text-[10px] uppercase tracking-[0.12em] text-foreground-800">
                {latest.label}
              </span>
              <span className="hidden shrink-0 font-label text-[9px] tabular-nums text-foreground-500 sm:block">
                {latest.timestamp}
              </span>
            </span>
          )}
          {!open && !latest && (
            <span className="font-label text-[10px] uppercase tracking-[0.16em] text-foreground-500">
              No events yet
            </span>
          )}
        </span>

        <span className="flex shrink-0 items-center gap-2">
          <span className="hidden font-label text-[10px] uppercase tracking-[0.16em] text-foreground-500 sm:block">
            {events.length} events
          </span>
          <i
            className={`${open ? "ri-arrow-down-s-line" : "ri-arrow-up-s-line"} text-sm text-foreground-500`}
          />
        </span>
      </button>

      {open && (
        <div className="console-scroll mt-2 flex items-center gap-2 overflow-x-auto pb-0.5 atlas-rise">
          {visible.length === 0 ? (
            <span className="font-label text-[10px] uppercase tracking-[0.16em] text-foreground-500">
              No events yet
            </span>
          ) : (
            visible.map((event) => (
              <div
                key={event.id}
                className={`flex shrink-0 items-center gap-2 rounded-lg border px-2.5 py-1.5 ${agentTone[event.agent]}`}
              >
                <i
                  className={`${typeIcon[event.type] ?? "ri-information-line"} text-[11px] ${
                    kindTone[event.type] ?? "text-foreground-600"
                  }`}
                />
                <span className="flex flex-col leading-tight">
                  <span className="whitespace-nowrap font-label text-[10px] uppercase tracking-[0.12em] text-foreground-800">
                    {event.label}
                  </span>
                  <span className="hidden whitespace-nowrap font-label text-[9px] uppercase tracking-[0.12em] text-foreground-500 xl:block">
                    {event.detail}
                  </span>
                </span>
                <StatusBadge state={statusBadge[event.status]} showLabel={false} />
                <span className="font-label text-[9px] tabular-nums text-foreground-500">
                  {event.timestamp}
                </span>
              </div>
            ))
          )}
        </div>
      )}
    </section>
  );
}