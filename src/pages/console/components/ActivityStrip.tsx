import { useEffect, useRef } from "react";
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

export default function ActivityStrip({ events }: ActivityStripProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const visible = events.slice(-14);

  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    node.scrollLeft = node.scrollWidth;
  }, [events.length]);

  return (
    <section className="border-t border-background-300/60 bg-background-200/50 px-4 py-2.5 md:px-6">
      <div className="flex items-center gap-3">
        <div className="flex shrink-0 items-center gap-2">
          <span className="relative flex h-2 w-2 items-center justify-center">
            <span className="absolute h-2 w-2 rounded-full bg-secondary-400 atlas-blink" />
          </span>
          <span className="font-heading text-[10px] font-semibold uppercase tracking-[0.22em] text-foreground-800">
            System activity
          </span>
        </div>

        <div
          ref={scrollRef}
          className="console-scroll flex min-w-0 flex-1 items-center gap-2 overflow-x-auto pb-0.5"
        >
          {visible.map((event) => (
            <div
              key={event.id}
              className={`flex shrink-0 items-center gap-2 rounded-lg border px-2.5 py-1.5 ${agentTone[event.agent]} atlas-rise`}
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
          ))}
        </div>

        <span className="hidden shrink-0 font-label text-[10px] uppercase tracking-[0.16em] text-foreground-500 xl:block">
          Live event feed · placeholder
        </span>
      </div>
    </section>
  );
}