import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import MessageBubble from "@/pages/console/components/MessageBubble";
import type { ChatMessage, ConversationFilter } from "@/pages/console/types";

interface ConversationFeedProps {
  messages: ChatMessage[];
  operatorName: string;
  /** Current-session indicator strip rendered above the title row. */
  sessionSlot?: ReactNode;
  /** Compact conversation controls rendered under the title row. */
  controlsSlot?: ReactNode;
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

export default function ConversationFeed({
  messages,
  operatorName,
  sessionSlot,
  controlsSlot,
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
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-background-300/60 bg-background-100/70">
      {sessionSlot}

      <div className="flex flex-wrap items-center gap-3 border-b border-background-300/60 px-4 py-3">
        <div className="flex flex-col">
          <h2 className="font-heading text-sm font-semibold uppercase tracking-[0.24em] text-foreground-950">
            Conversation
          </h2>
          <span className="font-label text-[10px] uppercase tracking-[0.18em] text-foreground-500">
            {visible.length} entries · live transcript
          </span>
        </div>

        <div className="ml-auto flex items-center gap-1 rounded-full border border-background-300/60 bg-background-200/50 px-1 py-1">
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
      </div>

      {controlsSlot}

      <div
        ref={scrollRef}
        className="console-scroll flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-4"
      >
        {visible.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 py-10 text-center">
            <i className="ri-chat-3-line text-2xl text-foreground-500" />
            <p className="text-xs text-foreground-600">
              No entries yet. Start a new conversation or talk to an agent.
            </p>
          </div>
        ) : (
          visible.map((message) => (
            <MessageBubble key={message.id} message={message} operatorName={operatorName} />
          ))
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-background-300/60 px-4 py-2.5">
        <span className="flex items-center gap-2 font-label text-[10px] uppercase tracking-[0.16em] text-foreground-500">
          <span className="h-1.5 w-1.5 rounded-full bg-accent-400" />
          HAL
        </span>
        <span className="flex items-center gap-2 font-label text-[10px] uppercase tracking-[0.16em] text-foreground-500">
          <span className="h-1.5 w-1.5 rounded-full bg-secondary-400" />
          TRON
        </span>
        <span className="flex items-center gap-2 font-label text-[10px] uppercase tracking-[0.16em] text-foreground-500">
          <span className="h-1.5 w-1.5 rounded-full bg-background-500" />
          System
        </span>
        <span className="ml-auto font-label text-[10px] uppercase tracking-[0.16em] text-foreground-500">
          Clearing keeps stored memory intact
        </span>
      </div>
    </section>
  );
}