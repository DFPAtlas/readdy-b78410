interface WaveformProps {
  bars?: number;
  active?: boolean;
  tone?: "primary" | "accent" | "secondary" | "foreground";
  height?: number;
  barWidth?: number;
  className?: string;
}

const toneStyles: Record<NonNullable<WaveformProps["tone"]>, string> = {
  primary: "bg-primary-400",
  accent: "bg-accent-400",
  secondary: "bg-secondary-400",
  foreground: "bg-foreground-600",
};

const PATTERN = [0.35, 0.68, 0.45, 0.92, 0.55, 0.78, 0.4, 0.86, 0.5, 0.72, 0.32, 0.62];

export default function Waveform({
  bars = 14,
  active = true,
  tone = "primary",
  height = 24,
  barWidth = 3,
  className = "",
}: WaveformProps) {
  return (
    <div
      className={`flex items-center justify-center gap-[3px] ${className}`}
      style={{ height }}
    >
      {Array.from({ length: bars }, (_, index) => {
        const scale = PATTERN[index % PATTERN.length];
        return (
          <span
            key={index}
            className={`rounded-full ${toneStyles[tone]} ${
              active ? "atlas-wave-bar" : ""
            }`}
            style={{
              width: barWidth,
              height: Math.max(4, height * (active ? scale : scale * 0.5)),
              opacity: active ? 0.95 : 0.35,
              animationDelay: `${(index % 7) * 0.11}s`,
              animationDuration: `${0.75 + (index % 5) * 0.12}s`,
            }}
          />
        );
      })}
    </div>
  );
}