import type { AgentId } from "@/pages/console/types";

export interface AgentTheme {
  text: string;
  textSoft: string;
  border: string;
  borderStrong: string;
  bgSoft: string;
  bgChip: string;
  solid: string;
  solidHover: string;
  glow: string;
  ring: string;
  core: string;
  track: string;
}

export const agentTheme: Record<AgentId, AgentTheme> = {
  hal: {
    text: "text-accent-400",
    textSoft: "text-accent-300",
    border: "border-accent-500/35",
    borderStrong: "border-accent-500/70",
    bgSoft: "bg-accent-500/10",
    bgChip: "bg-accent-500/15",
    solid: "bg-accent-500",
    solidHover: "hover:bg-accent-400",
    glow: "bg-accent-500/25",
    ring: "border-accent-400/60",
    core: "from-accent-400 via-accent-500 to-accent-800",
    track: "bg-accent-500/25",
  },
  tron: {
    text: "text-secondary-400",
    textSoft: "text-secondary-300",
    border: "border-secondary-500/35",
    borderStrong: "border-secondary-500/70",
    bgSoft: "bg-secondary-500/10",
    bgChip: "bg-secondary-500/15",
    solid: "bg-secondary-500",
    solidHover: "hover:bg-secondary-400",
    glow: "bg-secondary-500/25",
    ring: "border-secondary-400/60",
    core: "from-secondary-400 via-secondary-500 to-secondary-800",
    track: "bg-secondary-500/25",
  },
};