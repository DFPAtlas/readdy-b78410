import type { AgentId } from "@/pages/console/types";
import { routingKeywords } from "@/mocks/console";

/**
 * DEMONSTRATION ROUTING ONLY.
 *
 * This module is pure, local, synchronous keyword matching. It does not call a
 * model, an intent service, Ollama, n8n or any endpoint. Its only job is to let
 * the frontend *visually* pick an agent and show the routing animation.
 *
 * Replace these functions with the real router when live HAL / TRON
 * connectivity lands — the return shapes are the only contract the UI needs.
 */

export type IntentKind = "infrastructure" | "development" | "unknown";

/** Score an utterance against the demo keyword tables. */
export const detectIntent = (text: string): IntentKind => {
  const value = text.toLowerCase();
  const halHit = routingKeywords.hal.some((keyword) => value.includes(keyword));
  const tronHit = routingKeywords.tron.some((keyword) => value.includes(keyword));
  if (halHit && !tronHit) return "infrastructure";
  if (tronHit && !halHit) return "development";
  return "unknown";
};

export const intentLabel = (intent: IntentKind): string => {
  switch (intent) {
    case "infrastructure":
      return "Infrastructure / network request";
    case "development":
      return "Development / repository request";
    default:
      return "Unclassified request";
  }
};

/**
 * Pick an agent for AUTO mode. Keyword match wins; when nothing matches the
 * caller-supplied `alternate` keeps the demo alternating between agents.
 */
export const agentForText = (
  text: string,
  alternate: AgentId,
): { agent: AgentId; intent: IntentKind } => {
  const intent = detectIntent(text);
  if (intent === "infrastructure") return { agent: "hal", intent };
  if (intent === "development") return { agent: "tron", intent };
  return { agent: alternate, intent };
};

export const otherAgent = (agent: AgentId): AgentId => (agent === "hal" ? "tron" : "hal");