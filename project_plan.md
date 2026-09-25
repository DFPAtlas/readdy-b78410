# Atlas Voice Console

## 1. Project Description
Atlas Voice Console is the main desktop interface for operating two local AI agents — **HAL** (Infrastructure & Operations) and **TRON** (Engineering & RAG).

- **Positioning**: A professional AI operations console, not a consumer chatbot. The feel is closer to a control room than a messaging app.
- **Target users**: A single operator (Martin) running local models on a home/lab server, who needs to talk to, monitor, route, and observe two specialised agents.
- **Core value**: One screen that shows agent health, live conversation, voice control, and system activity at the same time.

**Current scope: GUI only.** No APIs, no Ollama endpoints, no n8n workflows, no database, no auth. All values are placeholder/mock display data, but the layout and component boundaries are designed so live data can be swapped in later without a redesign.

## 2. Page Structure
- `/` — Atlas Voice Console (single full-screen application view)
- `*` — Not Found

## 3. Core Features
- [x] Top status bar: product title, system status, local AI status, live clock, settings, connection indicator
- [x] HAL agent panel: animated AI core, status, role, model, GPU, RAM, Ollama / n8n / voice status, speaking waveform, Talk / Mute / Details
- [x] TRON agent panel: distinct animated AI core, status, role, model, GPU, RAM, RAG / Ollama / voice status, speaking waveform, Talk / Mute / Details
- [x] Central conversation timeline with distinct styling for Martin, HAL, TRON and System, including model, latency and tool indicators
- [x] Voice control area: TALK TO HAL / AUTO / TALK TO TRON, large microphone with Idle / Listening / Processing / HAL speaking / TRON speaking states, animated waveform
- [x] Text input with routing target and SEND
- [x] System activity strip: request → routing → agent selected → RAG search → generation → voice synthesis → response complete
- [x] Agent details modal
- [x] Responsive collapse: side panels become compact cards on narrower screens, conversation stays central, mic always reachable
- [x] Live transcript panel above the voice controls (waiting / listening / partial / final / routing / agent selected / processing / speaking / error)
- [x] Push-to-talk (mouse down/up, click/tap fallback, Space to talk, Escape to cancel — ignored while typing in a field)
- [x] Interruption / barge-in: interrupt while an agent speaks, response is marked `interrupted` (never deleted)
- [x] Continuous Conversation toggle (off by default) — auto-returns to listening after a reply
- [x] Agent-to-agent handoff, shown in the timeline and the activity strip
- [x] AUTO routing UX with visible intent analysis and keyword-based agent selection
- [x] Failover UX: agent unavailable (route / cancel), auto failover, both offline with a disabled "Cloud fallback — Not configured" row
- [x] Inline voice error states with Retry / Cancel (no browser alerts)
- [x] Conversation controls: New, Clear transcript, Stop speaking, Mute HAL, Mute TRON, Continuous Conversation
- [x] Current-session header: mode, active agent, voice state, session duration, continuous on/off
- [x] Reduced-motion support for all console animations

## 4. Data Model Design
No database in this phase. All display data lives in `src/mocks/console.ts`, and the
shapes are re-exported from `src/pages/console/types.ts` so components import from one place.

**Model shapes (the contract for future live data):**
- **Agent** — id, name, role, status (`online | degraded | offline | connecting | busy`), model,
  gpuUsage, ramUsage, ollamaStatus, voiceStatus, ragStatus, n8nStatus, latency, isSpeaking, isMuted,
  plus display extras (runtime, host, uptime, tasksToday, summary, metrics, services).
  HAL and TRON are *both* instances of this one shape — `AgentPanel` renders either from the same component.
- **ChatMessage** — id, sender, senderType (`user | hal | tron | system`), text, timestamp, model,
  latency, status (`sending | processing | complete | failed`), tools.
- **ActivityEvent** — id, type, label, detail, timestamp, status (`pending | active | complete | failed`),
  agent (`hal | tron | system`).
- **ConnectionNode** — id, label, state (`connected | connecting | degraded | disconnected`), detail.

**Console UI state (owned by `useVoiceConsole`):**
- **RoutingMode** — `hal | auto | tron` (AUTO default). Selecting immediately updates the UI.
- **VoiceState** — `idle | listening | transcribing | routing | thinking | hal-speaking | tron-speaking | error`,
  each with its own microphone label + animation (labels shared via `session.ts`).
- **VoiceSession** — sessionId, mode, targetAgent, state, partialTranscript, finalTranscript,
  selectedAgent, startedAt, responseStartedAt, canInterrupt, error. Shaped for a backend to replace later.
- **TranscriptLine** — id, kind (`status | partial | final | agent | error`), text, timestamp.
  Partial lines render lighter/italic, final lines solid, status lines small and muted.
- **VoiceError** — `microphone-unavailable | transcription-failed | synthesis-failed | agent-unavailable | response-timeout | connection-lost`,
  with labels + hints and inline Retry / Cancel.
- **FailoverState** — kind (`agent-unavailable | all-offline`), message, unavailable agents, suggested agent.
- Turn simulation, activity feed updates and message status transitions all live in this one hook,
  so it is the single seam where real routing / WebSocket events plug in.

**Demonstration routing** lives in `src/pages/console/routing.ts` — pure local keyword matching
(`routingKeywords` in the mock file). It never calls a model or an endpoint and is clearly marked as
the function to replace with the real router.

**Simulation controls** (the `Sim` menu in the session header, plus the availability toggle in the agent
details modal) only flip frontend state: agent availability, voice gateway online, and error triggers.
No live service is touched.

When live data is added later, these become the shapes returned by the backend.

## 5. Backend / Third-party Integration Plan
- **Atlas Voice Gateway**: the single integration seam. The browser talks only to the gateway — never directly
  to HAL, TRON, Ollama, n8n, speech or memory services. Configured via `VITE_ATLAS_VOICE_GATEWAY_URL`.
  - HTTP: `POST /api/chat` (sessionId, message, routingMode, preferredAgent → requestId, sessionId,
    selectedAgent, response, model, latency, status). Contract only — the route exists once the gateway supplies it.
  - Backend also exposes `POST /api/transcribe` (audio → transcript) and `POST /api/voice`
    (audio → transcript → routed response) for the local speech-to-text path, and
    `POST /api/speech` (text → synthesized agent voice) for local text-to-speech.
  - WebSocket: `/ws` for live events, handled by one frontend event router.
  - NOT configured → console stays fully usable in DEMO mode and shows "Voice Gateway not configured".
- Database: **not now** — placeholder display data only
- Ollama / local model runtime: **not connected directly** — reachable only through the gateway
- n8n: **not connected directly** — reachable only through the gateway
- Shopify / Stripe / payments: not applicable
- Auth: not applicable yet — assumed to be added at the gateway layer later; no secrets live in the frontend

## 6. Development Phase Plan

### Phase 1: Console shell and design system
- Goal: Establish the dark operations-console visual language and the full-screen app shell
- Deliverable: colour/typography tokens, console background, top status bar, page frame
- Status: **complete**

### Phase 2: Agent panels
- Goal: Give HAL and TRON visually distinct, recognisable identity
- Deliverable: animated AI cores, agent panels with metrics, service status, mute and details actions
- Status: **complete**

### Phase 3: Conversation, voice control and activity
- Goal: The interactive core of the console
- Deliverable: conversation timeline, voice control bar with microphone states and waveform, activity strip, turn simulation
- Status: **complete**

### Phase 4: Responsive and polish
- Goal: Usable on laptop screens and below
- Deliverable: collapsed agent cards, layout adaptation, animation polish
- Status: **complete**

### Phase 5: Frontend data model for live connectivity
- Goal: Make the frontend structurally ready for real HAL / TRON connectivity without any live services
- Deliverable: shared `Agent` model for both agents, agent status states, full voice state model, routing mode state,
  typed chat message + activity models, connection status section, reusable components (AgentPanel, ConversationFeed,
  MessageBubble, VoiceControl, RoutingSelector, ActivityStrip, ConnectionStatus, StatusBadge, MetricDisplay)
- Status: **complete**

### Phase 6: Voice interaction experience (simulation)
- Goal: Behave like a real two-agent voice console using local simulation only
- Deliverable: live transcript, push-to-talk, interruption/barge-in, continuous conversation, agent handoff,
  AUTO routing UX, failover UX, inline voice errors, conversation controls, session header, reduced motion
- Status: **complete**

### Phase 7: Atlas Voice Gateway integration layer
- Goal: Replace the frontend-only simulation seam with a clean, typed integration layer for a single
  backend service — the **Atlas Voice Gateway** — without contacting HAL / TRON directly.
- Deliverable:
  - `src/pages/console/gateway/config.ts` — environment-based base URL (`VITE_ATLAS_VOICE_GATEWAY_URL`),
    HTTP + WebSocket URL derivation, safe host parsing. No hard-coded IPs.
  - `src/pages/console/gateway/contracts.ts` — HTTP contract (`POST /api/chat` request/response), the
    WebSocket event catalogue (connected, agent_status, routing_started, agent_selected, transcript_partial,
    transcript_final, agent_thinking, response_started, response_delta, response_complete, speech_started,
    speech_ended, handoff, activity, error, heartbeat), and typed, human-readable gateway errors.
  - `src/pages/console/gateway/client.ts` — the single `AtlasVoiceGateway` service owning all fetch + WebSocket
    logic: connect / disconnect / reconnect / sendMessage / sendTranscript / cancelRequest / interruptSpeech /
    setRoutingMode / requestAgentStatus, bounded exponential backoff, heartbeat watch, single event router and
    a diagnostics snapshot. All UI components stay free of network logic.
  - `src/pages/console/gateway/mappers.ts` — live `agent_status` → `Agent` merge; anything the gateway omits
    renders as **Unknown** (never invented).
  - `src/pages/console/hooks/useVoiceGateway.ts` — mode resolution (LIVE / DEMO / OFFLINE), connection state,
    reconnect notice, session id, diagnostics and the public gateway API.
  - Console hook now routes text and final voice transcripts through the gateway in LIVE mode, streams
    `response_delta` chunks into one assistant bubble, wires Cancel / Interrupt to the service layer, and never
    fabricates a reply on failure.
  - UI: `ModeIndicator` (LIVE / DEMO / OFFLINE), `DiagnosticsPanel` (collapsible, safe frontend values only),
    mode switch in Settings, gateway state in the Links strip, inline gateway error banner with Retry / Dismiss.
- Security: no secrets anywhere in the frontend; auth is assumed to be added at the gateway layer later.
- Status: **complete**

### Phase 8: Atlas Voice Gateway backend service (core)
- Goal: Provide the single backend entry point the frontend integration layer targets, without
  connecting the browser directly to HAL or TRON Ollama.
- Deliverable: standalone Python/FastAPI service source under `atlas-voice-gateway/` (deployed to HAL,
  not part of this frontend bundle):
  - reusable async Ollama client (health / model verification / chat / streaming / timeout / cancellation)
  - `agents.py` registry with shared HAL/TRON runtime, periodic health monitor and per-agent concurrency guard
  - isolated deterministic `router.py` for AUTO routing (keyword rules, alternating fallback, default HAL)
  - in-memory `sessions.py` (active request, selected agent, cancellation)
  - single `/ws` event fan-out (`ws.py`)
  - HTTP: `GET /health`, `GET /api/agents`, `GET /api/status`, `POST /api/chat`,
    `POST /api/requests/{requestId}/cancel`
  - env-driven configuration (`.env.example`): gateway host/port, HAL/TRON Ollama URLs, default models,
    request timeout, health interval, allowed origins, concurrency limits. No hard-coded IPs or models.
- Deployment (systemd, env file, firewall) is handled outside this repo.
- Note: written without live access to HAL/TRON — all addresses, models and ports must be verified on the machine.
- Status: **complete** (source delivered; live verification is out of scope for this agent)

### Phase 9: Local speech-to-text over the gateway (faster-whisper)
- Goal: Add a real, local STT pipeline — microphone audio → Atlas Voice Gateway → faster-whisper on HAL
  → transcript → the existing HAL/TRON routing flow. The browser still talks only to the gateway.
- Deliverable (inside `atlas-voice-gateway/`, deployed on HAL):
  - `app/audio.py` — audio intake: content-type + size + duration validation (WAV / WebM-Opus / OGG),
    server-side ffmpeg conversion to 16 kHz mono WAV, generated temp filenames (client name never trusted),
    always-delete temp files, crude RMS near-silence screening.
  - `app/stt.py` — reusable faster-whisper service: background lazy load (gateway stays up while the model
    loads), GPU-first with optional CPU fallback, batch-first transcription (no fake partials), bounded
    concurrency (reject with `429 stt_busy`), timeout, `no_speech_detected` handling, safe status snapshot.
  - HTTP: `POST /api/transcribe` (audio, sessionId, language → transcript, language, duration,
    processingTime, status) and `POST /api/voice` (audio, sessionId, routingMode, preferredAgent → transcript
    + routed AI response), reusing the same `_execute_chat` routing/generation pipeline as `/api/chat`.
  - WebSocket additions: `audio_received`, `transcription_started`, `transcript_final`, `transcription_failed`
    (no fabricated `transcript_partial`).
  - `/health` and `/api/status` extended with safe STT info (`sttReady`, model, device, computeType, loadMs, lastError).
  - Env-driven STT config (model, device, compute type, language, VAD, limits, concurrency, temp dir).
- Privacy: audio processed locally, not retained; temp files deleted on success and failure; metadata-only logs,
  no raw audio, no full transcripts.
- Note: written without live access to HAL — model/GPU/CUDA, ports and latency must be verified on the machine.
- Status: **complete** (source delivered; live verification is out of scope for this agent)

### Phase 10: Local text-to-speech over the gateway (Piper)
- Goal: Complete the local talk → think → speak loop. HAL and TRON speak with two genuinely
  distinct en-GB voices, while the browser still talks only to the gateway.
- Deliverable (inside `atlas-voice-gateway/`):
  - `app/voices.py` — stable voice identities: `atlas-hal-voice` (calm, measured, deeper) and
    `atlas-tron-voice` (clear, technical, brighter); agent → voice mapping + model resolver.
  - `app/speech_text.py` — reusable speech-text sanitizer: flattens Markdown, strips code fences,
    replaces substantial code blocks with a short phrase, and does not read raw URLs character-by-character.
  - `app/tts.py` — reusable Piper TTS service: background lazy load (gateway stays up while voices
    load), CPU-first (portable, never fights STT/Ollama for the GPU), per-agent voices, bounded
    concurrency (`429 tts_busy`), timeout, and real chunk-level cancellation.
  - `app/audio_store.py` — short-lived, in-memory synthesized-audio resources (opaque random ids,
    TTL, purged on a timer, dropped on cancel, cleared on restart; nothing written to disk, no public URLs).
  - HTTP: `POST /api/speech` (text → agent voice WAV), `GET /api/speech/audio/{audioId}`
    (short-lived clip), `POST /api/speech/{requestId}/playback` (playback ack), and
    `POST /api/agents/{agentId}/mute`. `POST /api/voice` extended to synthesize the selected
    agent's voice after generation, reusing the existing chat/routing/STT pipeline (no duplication).
  - WebSocket additions: `speech_synthesis_started`, `speech_ready`, `speech_started`,
    `speech_ended`, `speech_cancelled`, `speech_failed` — with `speech_ready` (server generated audio)
    clearly distinct from `speech_started` (frontend confirms playback).
  - `/health` and `/api/status` extended with safe TTS info (`ttsReady`, engine, device, per-agent
    voice readiness, last error) — never full model paths.
  - Env-driven TTS config (engine, device, voices, length scales, limits, timeout, concurrency, audio TTL).
- Privacy: all processing local, no cloud voice services, audio held in memory only and never retained.
- Note: written without live access to HAL — voice models, latency and resource usage must be verified on the machine.
- Status: **complete** (source delivered; live verification is out of scope for this agent)

### Next phase ideas (not started)
- Rolling telemetry charts for GPU / RAM history
- Keyboard shortcuts and command palette
- Boot / reconnect sequence overlay
- Browser microphone capture wired to `/api/voice` (replaces the frontend transcript simulation)
- Browser playback of synthesized audio + playback acknowledgement (completes the speak half)
- Wake words, Supabase memory, n8n tools (all behind the gateway)

## 7. Notes on replacing mock data with live values
- Agent health, service statuses and metrics are read from `mockAgents`; swap the source, keep the `Agent` shape.
- Conversation entries follow `ChatMessage`, activity entries follow `ActivityEvent`.
- The voice session / transcript shapes (`VoiceSession`, `TranscriptLine`, `FailoverState`) are ready for live values.
- Push-to-talk, interruption, continuous mode and the turn simulation inside the voice hook are the single seam
  where a real HAL / TRON request-response cycle would plug in — including `routing.ts` for the router.