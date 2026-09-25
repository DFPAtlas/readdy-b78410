import type { RoutingMode } from "@/pages/console/types";

interface RoutingSelectorProps {
  value: RoutingMode;
  onChange: (mode: RoutingMode) => void;
  className?: string;
}

interface RoutingOption {
  id: RoutingMode;
  label: string;
  icon: string;
  active: string;
}

const options: RoutingOption[] = [
  {
    id: "hal",
    label: "Talk to HAL",
    icon: "ri-server-line",
    active: "bg-accent-500 text-background-50 border-accent-400",
  },
  {
    id: "auto",
    label: "Auto",
    icon: "ri-git-branch-line",
    active: "bg-primary-500 text-background-50 border-primary-300",
  },
  {
    id: "tron",
    label: "Talk to TRON",
    icon: "ri-code-s-slash-line",
    active: "bg-secondary-500 text-background-50 border-secondary-400",
  },
];

export default function RoutingSelector({
  value,
  onChange,
  className = "",
}: RoutingSelectorProps) {
  return (
    <div
      role="group"
      aria-label="Routing mode"
      className={`flex items-center gap-1 rounded-full border border-background-300/60 bg-background-200/50 p-1 ${className}`}
    >
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          onClick={() => onChange(option.id)}
          aria-pressed={value === option.id}
          className={`flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1.5 font-label text-[10px] uppercase tracking-[0.18em] transition-colors ${
            value === option.id
              ? option.active
              : "border-transparent text-foreground-600 hover:text-foreground-900"
          }`}
        >
          <i className={`${option.icon} text-[11px]`} />
          {option.label}
        </button>
      ))}
    </div>
  );
}