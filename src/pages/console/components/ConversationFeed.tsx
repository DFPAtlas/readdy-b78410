import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import MessageBubble from "@/pages/console/components/MessageBubble";
import type { ChatMessage, ConversationFilter } from "@/pages/console/types";

interface ConversationFeedProps {
  messages: ChatMessage[];
  operatorName: string;
  /** Current-session indicator strip rendered above the toolbar. */
  sessionSlot?: ReactNode;
  /** Conversation controls rendered inside the toolbar (New / Stop / Options). */
  controlsSlot?: ReactNode;
  /** True when the console is in LIVE mode — changes the empty state only. */
  liveMode?: boolean;
}

const filters: { id: ConversationFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "hal", label: "HAL" },
  { id: "tron", label: "TRON" },
  { id: "system", label: "System" },
];

const activeFilterStyles: Record<ConversationFilter, string> = {
  all: "bg-foreground-900 text-background-50",
  hal: "bg-accent-500 text-background-900",
  tron: "bg-secondary-500 text-background-900",
  system: "bg-background-400 text-background-950",
};

/**
 * The dominant centre conversation panel. One slim toolbar carries the title,
 * the sender filter and the conversation controls; the message list then reads
 * top-to-bottom with a comfortable measure.
 *
 * Only the session strip and the scroll area clip their corners, so the toolbar
 * menu can overlay the message list instead of being cut off.
 */
export default function ConversationFeed({
  messages,
  operatorName,
  sessionSlot,
  controlsSlot,
  liveMode = false,
}: ConversationFeedProps) {
  const [filter, setFilter] = useState<ConversationFilter>("all");
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const visible = useMemo(
    () =>
      filter === "all" ? messages : messages.filter((message) => message.senderType === filter),
    [filter, messages],
  );

  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [visible.length, filter, messages]);

  return (
    <section className="flex min-h-0 flex-1 flex-col rounded-xl border border-background-300/60 bg-background-100/70">
      {sessionSlot && <div className="overflow-hidden rounded-t-xl">{sessionSlot}</div>}

      <div className="relative z-20 flex flex-wrap items-center gap-x-4 gap-y-2.5 border-b border-background-300/60 px-4 py-2.5">
        <div className="flex min-w-0 items-baseline gap-2">
          <h2 className="font-heading text-sm font-semibold uppercase tracking-[0.24em] text-foreground-950">
            Conversation
          </h2>
          <span className="whitespace-nowrap font-label text-[10px] uppercase tracking-[0.16em] text-foreground-500">
            {visible.length} {visible.length === 1 ? "entry" : "entries"}
          </span>
        </div>

        <div className="flex items-center gap-1 rounded-full border border-background-300/60 bg-background-200/50 px-1 py-1">
          {filters.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setFilter(item.id)}
              className={`cursor-pointer whitespace-nowrap rounded-full px-3 py-1 font-label text-[10px] uppercase tracking-[0.16em] transition-colors ${
                filter === item.id
                  ? activeFilterStyles[item.id]
                  : "text-foreground-600 hover:text-foreground-900"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        {controlsSlot && <div className="ml-auto">{controlsSlot}</div>}
      </div>

      <div
        ref={scrollRef}
        className="console-scroll flex min-h-0 flex-1 flex-col overflow-y-auto rounded-b-xl px-4 py-4"
      >
        <div className="mx-auto flex w-full max-w-[860px] flex-col gap-4">
          {visible.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-14 text-center">
              <span className="flex h-10 w-10 items-center justify-center rounded-full border border-background-300/60 bg-background-200/50">
                <i
                  className={`${
                    liveMode ? "ri-mic-line" : "ri-chat-3-line"
                  } text-lg text-foreground-500`}
                />
              </span>
              <p className="font-heading text-[11px] font-semibold uppercase tracking-[0.18em] text-foreground-700">
                {liveMode ? "No live messages yet" : "No entries yet"}
              </p>
              <p className="max-w-[360px] text-xs text-foreground-600">
                {liveMode
                  ? "This is a live session. Hold the mic or type a message to talk to HAL or TRON — real replies appear here."
                  : "Start a new conversation or talk to an agent to see messages here."}
              </p>
            </div>
          ) : (
            visible.map((message) => (
              <MessageBubble key={message.id} message={message} operatorName={operatorName} />
            ))
          )}
        </div>
      </div>
    </section>
  );
}