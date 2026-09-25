import type { TranscriptLine } from "@/pages/console/types";

interface LiveTranscriptProps {
  lines: TranscriptLine[];
  className?: string;
}

const kindIcon: Record<TranscriptLine["kind"], string> = {
  status: "ri-more-line",
  partial: "ri-mic-line",
  final: "ri-check-line",
  agent: "ri-volume-up-line",
  error: "ri-error-warning-line",
};

const kindText: Record<TranscriptLine["kind"], string> = {
  status: "font-label text-[10px] uppercase tracking-[0.16em] text-foreground-500",
  partial: "text-[12px] italic text-foreground-700",
  final: "text-[12px] font-medium text-foreground-950",
  agent: "font-heading text-[11px] font-semibold uppercase tracking-[0.2em] text-primary-300",
  error: "text-[11px] text-accent-300",
};

/**
 * Compact live transcript. Partial lines read lighter and italic, confirmed
 * lines read solid, and system status lines stay small and muted — so the three
 * kinds are distinguishable at a glance.
 */
export default function LiveTranscript({ lines, className = "" }: LiveTranscriptProps) {
  const visible = lines.slice(-3);

  return (
    <section
      aria-live="polite"
      aria-label="Live voice transcript"
      className={`rounded-lg border border-background-300/60 bg-background-200/50 px-3 py-2 ${className}`}
    >
      <div className="mb-1.5 flex items-center gap-2">
        <span className="flex h-3 w-3 items-center justify-center">
          <span className="h-1.5 w-1.5 rounded-full bg-primary-400 atlas-blink" />
        </span>
        <span className="font-label text-[10px] uppercase tracking-[0.2em] text-foreground-500">
          Live transcript
        </span>
        <span className="ml-auto hidden font-label text-[10px] uppercase tracking-[0.16em] text-foreground-500 sm:block">
          simulated
        </span>
      </div>

      <div className="flex min-h-[42px] flex-col justify-end gap-1">
        {visible.length === 0 ? (
          <span className="font-label text-[11px] text-foreground-500">Waiting for speech...</span>
        ) : (
          visible.map((line) => (
            <div key={line.id} className="flex items-start gap-2 atlas-rise">
              <i
                className={`${kindIcon[line.kind]} mt-0.5 shrink-0 text-[11px] ${
                  line.kind === "error" ? "text-accent-400" : "text-foreground-500"
                }`}
              />
              <span className={`min-w-0 flex-1 break-words ${kindText[line.kind]}`}>
                {line.text}
                {line.kind === "partial" && (
                  <span className="ml-1 inline-block h-3 w-[2px] translate-y-[2px] bg-primary-400 atlas-blink" />
                )}
              </span>
              <span className="shrink-0 font-label text-[9px] tabular-nums text-foreground-500">
                {line.timestamp}
              </span>
            </div>
          ))
        )}
      </div>
    </section>
  );
}