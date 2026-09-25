interface MetricDisplayProps {
  label: string;
  value: number;
  display: string;
  tone?: "primary" | "accent" | "secondary";
  /** When true the gateway supplied no value — show text, not a bar. */
  unknown?: boolean;
}

const toneStyles: Record<NonNullable<MetricDisplayProps["tone"]>, string> = {
  primary: "bg-primary-400",
  accent: "bg-accent-400",
  secondary: "bg-secondary-400",
};

export default function MetricDisplay({
  label,
  value,
  display,
  tone = "primary",
  unknown = false,
}: MetricDisplayProps) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="font-label text-[10px] uppercase tracking-[0.16em] text-foreground-500">
          {label}
        </span>
        <span
          className={`font-label text-[11px] ${
            unknown ? "uppercase tracking-[0.14em] text-foreground-500" : "text-foreground-800"
          }`}
        >
          {display}
        </span>
      </div>
      {unknown ? (
        <div className="h-1.5 w-full rounded-full border border-dashed border-background-400/60" />
      ) : (
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-background-300/70">
          <div
            className={`h-full rounded-full transition-all duration-700 ${toneStyles[tone]}`}
            style={{ width: `${clamped}%` }}
          />
        </div>
      )}
    </div>
  );
}