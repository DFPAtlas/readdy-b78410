import type { AgentId } from "@/pages/console/types";

interface AiCoreProps {
  variant: AgentId;
  size?: number;
  speaking?: boolean;
  active?: boolean;
}

const coreTheme = {
  hal: {
    glow: "bg-accent-500/25",
    ringOuter: "border-accent-500/35",
    ringMid: "border-accent-500/55",
    ringInner: "border-accent-300/50",
    tick: "bg-accent-400/70",
    core: "from-accent-200 via-accent-500 to-accent-700",
    iris: "bg-background-950",
    scan: "border-accent-500/40",
  },
  tron: {
    glow: "bg-secondary-500/25",
    ringOuter: "border-secondary-500/35",
    ringMid: "border-secondary-500/55",
    ringInner: "border-secondary-300/50",
    tick: "bg-secondary-400/70",
    core: "from-secondary-200 via-secondary-500 to-secondary-700",
    iris: "bg-background-950",
    scan: "border-secondary-500/40",
  },
};

const TICKS = Array.from({ length: 24 }, (_, index) => index);

export default function AiCore({
  variant,
  size = 128,
  speaking = false,
  active = false,
}: AiCoreProps) {
  const theme = coreTheme[variant];
  const isLive = speaking || active;

  return (
    <div
      className="relative flex items-center justify-center"
      style={{ width: size, height: size }}
    >
      <div
        className={`absolute rounded-full blur-2xl ${theme.glow} ${
          isLive ? "atlas-breathe" : ""
        }`}
        style={{ width: size * 0.9, height: size * 0.9 }}
      />

      {/* tick ring */}
      <div className="absolute inset-0 atlas-spin" style={{ animationDuration: "40s" }}>
        {TICKS.map((index) => (
          <span
            key={index}
            className={`absolute left-1/2 top-1/2 rounded-full ${theme.tick}`}
            style={{
              width: index % 6 === 0 ? 2 : 1,
              height: index % 6 === 0 ? Math.max(6, size * 0.07) : Math.max(3, size * 0.035),
              opacity: index % 6 === 0 ? 0.9 : 0.5,
              transform: `translate(-50%, -50%) rotate(${index * 15}deg) translateY(-${
                size / 2 - 2
              }px)`,
            }}
          />
        ))}
      </div>

      {/* outer ring */}
      <div
        className={`absolute rounded-full border-2 border-dashed ${theme.ringOuter} atlas-spin`}
        style={{ width: size, height: size }}
      />

      {/* mid ring */}
      <div
        className={`absolute rounded-full border ${theme.ringMid} atlas-spin-reverse`}
        style={{ width: size * 0.82, height: size * 0.82 }}
      />

      {variant === "hal" ? (
        <div
          className={`absolute rounded-full border ${theme.ringInner} atlas-spin-fast`}
          style={{ width: size * 0.68, height: size * 0.68 }}
        />
      ) : (
        <>
          <div
            className={`absolute border ${theme.ringInner} atlas-spin`}
            style={{
              width: size * 0.6,
              height: size * 0.6,
              animationDuration: "9s",
              borderRadius: size * 0.12,
            }}
          />
          <div
            className={`absolute border ${theme.ringInner} atlas-spin-reverse`}
            style={{
              width: size * 0.74,
              height: size * 0.74,
              borderRadius: size * 0.12,
              transform: "rotate(45deg)",
              animationDuration: "14s",
            }}
          />
        </>
      )}

      {/* reactive pulse rings */}
      {isLive && (
        <>
          <span
            className={`absolute rounded-full border ${theme.scan} atlas-pulse-ring`}
            style={{ width: size * 0.62, height: size * 0.62 }}
          />
          <span
            className={`absolute rounded-full border ${theme.scan} atlas-pulse-ring`}
            style={{ width: size * 0.62, height: size * 0.62, animationDelay: "1.1s" }}
          />
        </>
      )}

      {/* core sphere */}
      <div
        className={`relative flex items-center justify-center rounded-full bg-gradient-to-br ${theme.core}`}
        style={{ width: size * 0.52, height: size * 0.52 }}
      >
        <div
          className={`rounded-full ${theme.iris} ${isLive ? "atlas-blink" : ""}`}
          style={{ width: size * 0.2, height: size * 0.2 }}
        />
      </div>
    </div>
  );
}