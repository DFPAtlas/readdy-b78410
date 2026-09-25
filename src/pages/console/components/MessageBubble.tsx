import { agentTheme } from "@/pages/console/agentTheme";
import type { ChatMessage, MessageStatus, MessageTool } from "@/pages/console/types";

interface MessageBubbleProps {
  message: ChatMessage;
  operatorName: string;
}

const toolIcon: Record<MessageTool["kind"], string> = {
  tool: "ri-flashlight-line",
  route: "ri-route-line",
  vector: "ri-stack-line",
  voice: "ri-mic-line",
};

const agentIcon: Record<string, string> = {
  hal: "ri-server-line",
  tron: "ri-code-s-slash-line",
};

interface StatusMeta {
  label: string;
  icon: string;
  tone: string;
  spin?: boolean;
}

const statusMeta: Record<MessageStatus, StatusMeta | null> = {
  sending: { label: "Sending", icon: "ri-loader-4-line", tone: "text-foreground-500", spin: true },
  processing: {
    label: "Generating",
    icon: "ri-loader-4-line",
    tone: "text-primary-400",
    spin: true,
  },
  complete: null,
  interrupted: { label: "Interrupted", icon: "ri-stop-circle-line", tone: "text-accent-300" },
  failed: { label: "Failed", icon: "ri-error-warning-line", tone: "text-accent-400" },
};

function StatusChip({ status }: { status: MessageStatus }) {
  const meta = statusMeta[status];
  if (!meta) return null;
  return (
    <span
      className={`flex items-center gap-1 rounded border border-background-300/60 bg-background-200/60 px-1.5 py-0.5 font-label text-[10px] uppercase tracking-[0.14em] ${meta.tone}`}
    >
      <i className={`${meta.icon} text-[10px] ${meta.spin ? "animate-spin" : ""}`} />
      {meta.label}
    </span>
  );
}

export default function MessageBubble({ message, operatorName }: MessageBubbleProps) {
  if (message.senderType === "system") {
    return (
      <div className="flex justify-center atlas-rise">
        <div className="flex max-w-[80%] items-center gap-2 rounded-full border border-background-300/60 bg-background-200/50 px-3.5 py-1.5">
          <i className="ri-information-line text-[11px] text-foreground-500" />
          <span className="font-label text-[10px] uppercase tracking-[0.16em] text-foreground-600">
            {message.text}
          </span>
          <span className="font-label text-[10px] tabular-nums text-foreground-500">
            {message.timestamp}
          </span>
        </div>
      </div>
    );
  }

  if (message.senderType === "user") {
    return (
      <div className="flex justify-end atlas-rise">
        <div className="flex max-w-[78%] items-start gap-3">
          <div className="flex flex-col items-end gap-1">
            <div className="flex items-center gap-2">
              <StatusChip status={message.status} />
              <span className="font-label text-[10px] tabular-nums text-foreground-500">
                {message.timestamp}
              </span>
              <span className="font-heading text-[11px] font-semibold uppercase tracking-[0.2em] text-foreground-800">
                {message.sender || operatorName}
              </span>
            </div>
            <div className="rounded-xl rounded-tr-sm border border-background-300/70 bg-background-200/70 px-4 py-3">
              <p className="text-[13px] leading-relaxed text-foreground-900">{message.text}</p>
            </div>
          </div>
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-background-300/70 bg-background-300/50 font-heading text-[11px] font-semibold text-foreground-800">
            {(message.sender || operatorName).slice(0, 1).toUpperCase()}
          </div>
        </div>
      </div>
    );
  }

  const theme = agentTheme[message.senderType];

  return (
    <div className="flex justify-start atlas-rise">
      <div className="flex max-w-[82%] items-start gap-3">
        <div
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border ${theme.border} ${theme.bgSoft}`}
        >
          <i className={`${agentIcon[message.senderType]} text-sm ${theme.text}`} />
        </div>
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`font-heading text-[11px] font-semibold uppercase tracking-[0.2em] ${theme.text}`}
            >
              {message.sender}
            </span>
            <span className="font-label text-[10px] tabular-nums text-foreground-500">
              {message.timestamp}
            </span>
            {message.model && (
              <span className="rounded border border-background-300/60 bg-background-200/60 px-1.5 py-0.5 font-label text-[10px] text-foreground-600">
                {message.model}
              </span>
            )}
            {typeof message.latency === "number" && (
              <span
                className={`rounded border ${theme.border} ${theme.bgSoft} px-1.5 py-0.5 font-label text-[10px] ${theme.textSoft}`}
              >
                {message.latency} ms
              </span>
            )}
            {message.handoff && (
              <span className="flex items-center gap-1 rounded border border-primary-500/40 bg-primary-500/10 px-1.5 py-0.5 font-label text-[10px] uppercase tracking-[0.14em] text-primary-300">
                <i className="ri-exchange-line text-[10px]" />
                Handoff → {message.handoff.to.toUpperCase()}
              </span>
            )}
            <StatusChip status={message.status} />
          </div>

          <div
            className={`rounded-xl rounded-tl-sm border ${theme.border} ${theme.bgSoft} px-4 py-3 ${
              message.handoff ? "border-dashed" : ""
            } ${message.status === "interrupted" ? "opacity-70" : ""}`}
          >
            <p className="text-[13px] leading-relaxed text-foreground-900">{message.text}</p>
            {message.tools && message.tools.length > 0 && (
              <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-background-300/40 pt-2.5">
                {message.tools.map((tool) => (
                  <span
                    key={`${message.id}-${tool.label}`}
                    className="flex items-center gap-1.5 rounded border border-background-300/60 bg-background-100/70 px-1.5 py-0.5 font-label text-[10px] text-foreground-600"
                  >
                    <i className={`${toolIcon[tool.kind]} text-[10px] ${theme.text}`} />
                    {tool.label}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}