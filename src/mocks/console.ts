/**
 * Shared frontend data model for the Atlas Voice Console.
 *
 * Everything here is a *display* model: plain data shapes plus placeholder
 * values. No network calls, no database, no Ollama / n8n endpoints live in
 * this file. When live HAL / TRON connectivity is added later, the same
 * shapes are what a WebSocket / API layer should return.
 */

export type AgentId = "hal" | "tron";

/** Lifecycle state of an agent as shown in the UI. */
export type AgentStatus = "online" | "degraded" | "offline" | "connecting" | "busy";

/** Health of an individual subsystem (model runtime, voice, RAG, n8n...). */
export type HealthState = "ok" | "busy" | "idle" | "degraded" | "offline" | "na";

/** Normalised tone used by status badges so colour is never the only signal. */
export type IndicatorTone = "ok" | "busy" | "warn" | "error" | "idle";

export interface AgentMetric {
  label: string;
  value: number;
  display: string;
}

export interface AgentService {
  label: string;
  value: string;
  state: HealthState;
}

/** A single reusable agent record. HAL and TRON both use this exact shape. */
export interface Agent {
  id: AgentId;
  name: string;
  role: string;
  status: AgentStatus;
  model: string;
  gpuUsage: number;
  ramUsage: number;
  ollamaStatus: HealthState;
  voiceStatus: HealthState;
  ragStatus: HealthState;
  n8nStatus: HealthState;
  latency: number;
  isSpeaking: boolean;
  isMuted: boolean;
  /**
   * Frontend availability flag. Drives the simulated failover states only —
   * live connectivity would set this from real agent health.
   */
  available: boolean;
  /** Display-only extras, safe for live data to replace later. */
  runtime: string;
  host: string;
  uptime: string;
  tasksToday: number;
  summary: string;
  metrics: AgentMetric[];
  services: AgentService[];
  /**
   * Field labels the gateway did not supply for a live status update. Anything
   * listed here renders as "Unknown" instead of a placeholder value.
   */
  unknownFields?: string[];
}

export type MessageSenderType = "user" | "hal" | "tron" | "system";

export type MessageStatus = "sending" | "processing" | "complete" | "interrupted" | "failed";

export interface MessageTool {
  label: string;
  kind: "tool" | "route" | "vector" | "voice";
}

export interface ChatMessage {
  id: string;
  sender: string;
  senderType: MessageSenderType;
  text: string;
  timestamp: string;
  model?: string;
  latency?: number;
  status: MessageStatus;
  tools?: MessageTool[];
  /** Set when one agent hands the request to the other (simulated). */
  handoff?: { from: AgentId; to: AgentId };
}

export type ActivityStatus = "pending" | "active" | "complete" | "failed";

export type ActivityAgent = "hal" | "tron" | "system";

export interface ActivityEvent {
  id: string;
  type: string;
  label: string;
  detail: string;
  timestamp: string;
  status: ActivityStatus;
  agent: ActivityAgent;
}

export type ConnectionState = "connected" | "connecting" | "degraded" | "disconnected";

export interface ConnectionNode {
  id: string;
  label: string;
  state: ConnectionState;
  detail: string;
}

export const mockOperator = {
  name: "Martin",
  handle: "M",
  role: "Operator",
  clearance: "Level 3",
};

export const mockAgents: Record<AgentId, Agent> = {
  hal: {
    id: "hal",
    name: "HAL",
    role: "Infrastructure & Operations",
    status: "online",
    model: "llama3.1:70b-instruct-q4_K_M",
    gpuUsage: 68,
    ramUsage: 54,
    ollamaStatus: "ok",
    voiceStatus: "idle",
    ragStatus: "na",
    n8nStatus: "ok",
    latency: 42,
    isSpeaking: false,
    isMuted: false,
    available: true,
    runtime: "Ollama 0.3.12",
    host: "atlas-core-01",
    uptime: "18d 04h 22m",
    tasksToday: 142,
    summary:
      "Container supervision, host telemetry, backup windows and deployment gating across the local fleet.",
    metrics: [
      { label: "GPU", value: 68, display: "68%" },
      { label: "RAM", value: 54, display: "54%" },
      { label: "VRAM", value: 41, display: "41.2 GB" },
    ],
    services: [
      { label: "Ollama", value: "READY", state: "ok" },
      { label: "n8n", value: "ACTIVE", state: "ok" },
      { label: "Voice", value: "IDLE", state: "idle" },
      { label: "Telemetry", value: "STREAMING", state: "ok" },
    ],
  },
  tron: {
    id: "tron",
    name: "TRON",
    role: "Engineering & RAG",
    status: "online",
    model: "mistral-nemo:12b-instruct-2407",
    gpuUsage: 47,
    ramUsage: 62,
    ollamaStatus: "ok",
    voiceStatus: "idle",
    ragStatus: "ok",
    n8nStatus: "na",
    latency: 51,
    isSpeaking: false,
    isMuted: false,
    available: true,
    runtime: "Ollama 0.3.12",
    host: "atlas-core-02",
    uptime: "18d 03h 58m",
    tasksToday: 96,
    summary:
      "Vector index maintenance, document retrieval, code review and change impact analysis across repositories.",
    metrics: [
      { label: "GPU", value: 47, display: "47%" },
      { label: "RAM", value: 62, display: "62%" },
      { label: "INDEX", value: 78, display: "12.4k docs" },
    ],
    services: [
      { label: "RAG", value: "INDEXED", state: "ok" },
      { label: "Ollama", value: "READY", state: "ok" },
      { label: "Voice", value: "IDLE", state: "idle" },
      { label: "Vector DB", value: "SYNCED", state: "ok" },
    ],
  },
};

export const mockConnections: ConnectionNode[] = [
  { id: "voice-gateway", label: "Voice Gateway", state: "connected", detail: "ch-1 · 48 kHz" },
  { id: "hal", label: "HAL", state: "connected", detail: "atlas-core-01" },
  { id: "tron", label: "TRON", state: "connected", detail: "atlas-core-02" },
  { id: "memory", label: "Memory", state: "degraded", detail: "recall store · 81%" },
  { id: "router", label: "Router", state: "connected", detail: "auto · 2 agents" },
];

export const mockMessages: ChatMessage[] = [
  {
    id: "seed-1",
    sender: "System",
    senderType: "system",
    text: "Session atlas-2043 initialised. Voice bridge ready on channel 1. 2 agents registered.",
    timestamp: "14:01:48",
    status: "complete",
  },
  {
    id: "seed-2",
    sender: "Martin",
    senderType: "user",
    text: "HAL, give me a quick status on the homelab before the deploy window opens.",
    timestamp: "14:02:03",
    status: "complete",
  },
  {
    id: "seed-3",
    sender: "System",
    senderType: "system",
    text: "Auto-router resolved intent: infrastructure & operations. Confidence 0.94.",
    timestamp: "14:02:04",
    status: "complete",
  },
  {
    id: "seed-4",
    sender: "HAL",
    senderType: "hal",
    text: "All twelve containers are responding. Prometheus scrape is healthy and rolling uptime sits at 99.98% over the last 72 hours. One flag: node-02 disk is at 81%, I would trim the log volume before 02:00 to stay clear of the backup window.",
    timestamp: "14:02:06",
    model: "llama3.1:70b-instruct-q4_K_M",
    latency: 842,
    status: "complete",
    tools: [
      { label: "ollama", kind: "tool" },
      { label: "n8n · health-check", kind: "route" },
    ],
  },
  {
    id: "seed-5",
    sender: "Martin",
    senderType: "user",
    text: "TRON, index the new firmware documentation and tell me what changed in the API surface.",
    timestamp: "14:03:12",
    status: "complete",
  },
  {
    id: "seed-6",
    sender: "System",
    senderType: "system",
    text: "Auto-router resolved intent: engineering & retrieval. Confidence 0.97.",
    timestamp: "14:03:13",
    status: "complete",
  },
  {
    id: "seed-7",
    sender: "TRON",
    senderType: "tron",
    text: "Indexed 128 documents into the vector store in 42 seconds. Breaking change: /v2/deploy now requires a signed payload header, and the legacy token field is marked as deprecated. I also picked up a new response envelope on /v2/status that drops the nested meta object.",
    timestamp: "14:03:19",
    model: "mistral-nemo:12b-instruct-2407",
    latency: 1284,
    status: "complete",
    tools: [
      { label: "ollama", kind: "tool" },
      { label: "rag-index", kind: "vector" },
      { label: "voice", kind: "voice" },
    ],
  },
  {
    id: "seed-8",
    sender: "Martin",
    senderType: "user",
    text: "Good catch. Can both of you stay in the loop for the rollback plan?",
    timestamp: "14:04:01",
    status: "complete",
  },
  {
    id: "seed-9",
    sender: "HAL",
    senderType: "hal",
    text: "Standing by. I will stream container events to the console and keep the rollback script staged and verified against the current compose revision.",
    timestamp: "14:04:03",
    model: "llama3.1:70b-instruct-q4_K_M",
    latency: 615,
    status: "complete",
    tools: [{ label: "ollama", kind: "tool" }],
  },
  {
    id: "seed-10",
    sender: "TRON",
    senderType: "tron",
    text: "Watching the index. If the schema drifts I will surface the diff here and attach the affected call sites so you can review before anything ships.",
    timestamp: "14:04:05",
    model: "mistral-nemo:12b-instruct-2407",
    latency: 907,
    status: "complete",
    tools: [
      { label: "rag-index", kind: "vector" },
      { label: "voice", kind: "voice" },
    ],
  },
  {
    id: "seed-11",
    sender: "HAL",
    senderType: "hal",
    text: "The deployment diff falls outside my scope, so I will ask TRON to inspect the repository and report the affected call sites back here.",
    timestamp: "14:05:10",
    model: "llama3.1:70b-instruct-q4_K_M",
    latency: 588,
    status: "complete",
    handoff: { from: "hal", to: "tron" },
    tools: [{ label: "ollama", kind: "tool" }],
  },
  {
    id: "seed-12",
    sender: "System",
    senderType: "system",
    text: "Handoff accepted · HAL → TRON. Control transferred for this request.",
    timestamp: "14:05:11",
    status: "complete",
  },
  {
    id: "seed-13",
    sender: "TRON",
    senderType: "tron",
    text: "Repository inspected. The deploy script still imports the legacy config loader; I have staged a patch and attached the two affected entry points for review.",
    timestamp: "14:05:16",
    model: "mistral-nemo:12b-instruct-2407",
    latency: 1163,
    status: "complete",
    tools: [
      { label: "ollama", kind: "tool" },
      { label: "rag-index", kind: "vector" },
    ],
  },
];

export const mockActivity: ActivityEvent[] = [
  {
    id: "act-1",
    type: "request",
    label: "HAL received request",
    detail: "Wake word detected on channel 1",
    timestamp: "14:02:03",
    status: "complete",
    agent: "hal",
  },
  {
    id: "act-2",
    type: "route",
    label: "Routing request",
    detail: "Intent scored · infrastructure 0.94",
    timestamp: "14:02:04",
    status: "complete",
    agent: "system",
  },
  {
    id: "act-3",
    type: "generate",
    label: "Ollama generating response",
    detail: "llama3.1:70b · 14 tok/s",
    timestamp: "14:02:05",
    status: "complete",
    agent: "hal",
  },
  {
    id: "act-4",
    type: "voice",
    label: "Voice synthesis",
    detail: "piper · en-US · 1.1 s",
    timestamp: "14:02:06",
    status: "complete",
    agent: "hal",
  },
  {
    id: "act-5",
    type: "route",
    label: "TRON selected",
    detail: "Engineering intent · confidence 0.97",
    timestamp: "14:03:13",
    status: "complete",
    agent: "tron",
  },
  {
    id: "act-6",
    type: "search",
    label: "RAG search",
    detail: "Vector store · 128 chunks matched",
    timestamp: "14:03:14",
    status: "complete",
    agent: "tron",
  },
  {
    id: "act-7",
    type: "done",
    label: "Response complete",
    detail: "TRON → console",
    timestamp: "14:03:19",
    status: "complete",
    agent: "tron",
  },
  {
    id: "act-8",
    type: "handoff",
    label: "HAL → TRON",
    detail: "Handoff request · repository scope",
    timestamp: "14:05:10",
    status: "complete",
    agent: "tron",
  },
  {
    id: "act-9",
    type: "handoff",
    label: "TRON accepted handoff",
    detail: "Control transferred",
    timestamp: "14:05:11",
    status: "complete",
    agent: "tron",
  },
];

/**
 * DEMONSTRATION ROUTING ONLY.
 * Simple local keyword rules the frontend uses to *visually* pick an agent.
 * There is no intent service, no model call and no network request behind this.
 * Replace with the real router when live HAL / TRON connectivity lands.
 */
export const routingKeywords: Record<AgentId, string[]> = {
  hal: [
    "network",
    "server",
    "switch",
    "storage",
    "uptime",
    "monitoring",
    "n8n",
    "infrastructure",
  ],
  tron: ["code", "repository", "github", "build", "typescript", "database", "rag", "debug"],
};

/** Sample utterances the simulated listener cycles through. Display data only. */
export const demoUtterances: string[] = [
  "Check the network status on the loft switch",
  "Run a storage and uptime sweep across the fleet",
  "Review the repository build for typescript errors",
  "Search the rag index for the latest api changes",
  "Monitor the n8n workflow and report back",
  "Debug the database migration on core two",
];

/** Simulated handoff lines used when one agent forwards a request. */
export const handoffLines: Record<AgentId, string[]> = {
  hal: [
    "That is outside my scope — I will ask TRON to inspect the repository.",
    "This looks like an engineering task, handing it to TRON for analysis.",
  ],
  tron: [
    "This is infrastructure territory — routing it to HAL for the host view.",
    "I will ask HAL to check the fleet before I touch the index.",
  ],
};

export const mockHalReplies: string[] = [
  "Acknowledged. All containers are stable and the deployment gate is held open. I will hold host telemetry open on channel 1 for the duration of the window.",
  "Scan complete. Only node-02 is drifting and the delta is small. I have staged a log rotation job and I will report back once it clears the threshold.",
  "Understood, Martin. Backups are verified, the rollback script is staged against the current compose revision, and I will surface any container restart event here immediately.",
  "Telemetry shows a brief spike on the storage array during the last index pass. Nothing critical, but I will cap write concurrency so it does not collide with the next backup window.",
];

export const mockTronReplies: string[] = [
  "Index refreshed. 128 documents parsed and embedded, no broken references. The API diff surfaces two breaking changes and one deprecated field — details are attached to this turn.",
  "Retrieval complete. The closest matches converge on the same answer with high confidence, so I would treat the older documentation revision as superseded and archive it.",
  "Code scan finished. Four call sites still use the legacy payload shape. I can generate a patch set for review, but nothing will be written until you approve the diff.",
  "Vector store is synced and the drift check came back clean. I will keep monitoring the schema and raise a warning here if any new document shifts the shape of the API surface.",
];