import type {
  Agent,
  AgentMetric,
  AgentService,
  HealthState,
} from "@/pages/console/types";
import type { AgentStatusPayload } from "@/pages/console/gateway/contracts";

/** Shown whenever the gateway did not supply a value. Never invented. */
export const UNKNOWN = "Unknown";

const healthFromFlag = (flag: boolean | undefined): HealthState => {
  if (flag === undefined) return "na";
  return flag ? "ok" : "offline";
};

const flagText = (flag: boolean | undefined): string => {
  if (flag === undefined) return UNKNOWN;
  return flag ? "READY" : "OFFLINE";
};

/**
 * Merge a live `agent_status` event into an existing agent record.
 *
 * Any field the gateway omits is rendered as "Unknown" rather than reusing a
 * stale or invented value — this is the single place that rule is applied.
 */
export const agentStatusToAgent = (base: Agent, status: AgentStatusPayload): Agent => {
  const unknownFields: string[] = [];

  const model = status.model?.trim() ? status.model : UNKNOWN;
  if (!status.model?.trim()) unknownFields.push("model");

  const hasGpu = typeof status.gpuUsage === "number";
  const hasRam = typeof status.ramUsage === "number";
  const hasLatency = typeof status.latency === "number";
  if (!hasGpu) unknownFields.push("GPU");
  if (!hasRam) unknownFields.push("RAM");
  if (!hasLatency) unknownFields.push("latency");

  const extras = base.metrics.filter((metric) => metric.label !== "GPU" && metric.label !== "RAM");
  const metrics: AgentMetric[] = [
    {
      label: "GPU",
      value: hasGpu ? (status.gpuUsage as number) : 0,
      display: hasGpu ? `${status.gpuUsage}%` : UNKNOWN,
    },
    {
      label: "RAM",
      value: hasRam ? (status.ramUsage as number) : 0,
      display: hasRam ? `${status.ramUsage}%` : UNKNOWN,
    },
    ...extras,
  ];

  const services: AgentService[] = [
    {
      label: "Ollama",
      value: status.model ? "READY" : UNKNOWN,
      state: status.model ? "ok" : "na",
    },
    { label: "Voice", value: flagText(status.voiceReady), state: healthFromFlag(status.voiceReady) },
    { label: "RAG", value: flagText(status.ragReady), state: healthFromFlag(status.ragReady) },
    { label: "n8n", value: flagText(status.n8nReady), state: healthFromFlag(status.n8nReady) },
  ];

  const available = typeof status.online === "boolean" ? status.online : base.available;
  const busy = status.busy === true;
  const statusValue = available ? (busy ? "busy" : "online") : "offline";

  return {
    ...base,
    status: statusValue,
    available,
    model,
    gpuUsage: hasGpu ? (status.gpuUsage as number) : 0,
    ramUsage: hasRam ? (status.ramUsage as number) : 0,
    voiceStatus: healthFromFlag(status.voiceReady),
    ragStatus: healthFromFlag(status.ragReady),
    n8nStatus: healthFromFlag(status.n8nReady),
    latency: hasLatency ? (status.latency as number) : 0,
    metrics,
    services,
    unknownFields,
  };
};