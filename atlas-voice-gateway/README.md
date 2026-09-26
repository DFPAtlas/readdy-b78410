# Atlas Voice Gateway

The single backend entry point for the **Readdy Atlas Voice Console**.

```
Atlas Voice Console  ──HTTP/WS──►  Atlas Voice Gateway  ──HTTP──►  HAL Ollama
                                          │                └─HTTP──►  TRON Ollama
                                          └──►  faster-whisper (local STT on HAL)
```

The browser **never** talks to HAL or TRON directly. It only ever talks to this
gateway, which (a) turns audio into text locally, (b) decides which agent/model
handles each request, and (c) turns the answer back into HAL/TRON speech.

This build adds **local text-to-speech** using **Piper**, on top of the existing
local **speech-to-text** (faster-whisper). The complete local loop is now:

```
Martin speaks
  -> Console
  -> Atlas Voice Gateway
  -> faster-whisper (STT)
  -> HAL / TRON routing
  -> Ollama response
  -> Piper local TTS (agent voice)
  -> audio back to the Console
```

It intentionally does **not** include wake-word support, Supabase memory or n8n
tools.

> **Important:** This source was written without access to the live HAL/TRON
> machines. Every address, model, port, GPU/CUDA state and firewall value must
> be **verified on the machine** before the service is enabled. Nothing here is
> assumed, and no test result in this repository is a substitute for running the
> checks in section 13 on real hardware.

---

## 1. Layout

```
/opt/atlas-voice-gateway/
├── app/
│   ├── __init__.py        # package + version
│   ├── config.py          # environment-driven settings (incl. STT)
│   ├── models.py          # request/response schemas
│   ├── events.py          # WebSocket event helper
│   ├── ws.py              # single WebSocket fan-out manager
│   ├── ollama_client.py   # reusable Ollama client (health/list/chat/stream)
│   ├── agents.py          # agent registry + health monitor + concurrency
│   ├── router.py          # deterministic AUTO routing (isolated module)
│   ├── sessions.py        # in-memory session/request state
│   ├── audio.py           # audio intake/validation/conversion + temp hygiene
│   ├── stt.py             # reusable faster-whisper STT service
│   ├── voices.py          # stable HAL/TRON voice identities (agent -> voice)
│   ├── speech_text.py     # reusable speech-text sanitizer (markdown/code/URLs)
│   ├── tts.py             # reusable Piper TTS service (voices, cancel, limits)
│   ├── audio_store.py     # short-lived in-memory synthesized-audio resources
│   ├── rag.py             # TRON-only retrieval (Atlas RAG API /search client)
│   └── main.py            # FastAPI app, routes, request flow
├── tests/                 # mocked gateway tests (pytest; no LAN service needed)
├── requirements.txt
├── requirements-dev.txt
├── .env.example
└── README.md
```

Configuration lives outside the source (env file). Logs go to stdout so
`journalctl` captures them. No secrets are stored in source files.

---

## 2. Install (on HAL)

```bash
sudo mkdir -p /opt/atlas-voice-gateway
# copy the project files into /opt/atlas-voice-gateway
cd /opt/atlas-voice-gateway

python3 -m venv .venv
.venv/bin/pip install --upgrade pip
.venv/bin/pip install -r requirements.txt

# GPU: align torch with the driver. Check `nvidia-smi` first, then e.g.
# .venv/bin/pip install torch --index-url https://download.pytorch.org/whl/cu121

# System dependency for WebM/Opus decoding (browser audio capture)
sudo apt-get install -y ffmpeg

# TTS voices (Piper). Download the two .onnx voice models (+ their .onnx.json
# config) for HAL and TRON into the voices directory.
mkdir -p /opt/atlas-voice-gateway/voices
#   en_GB-alan-medium.onnx / .onnx.json   -> HAL voice
#   en_GB-cori-high.onnx   / .onnx.json   -> TRON voice
# Piper publishes voices at https://huggingface.co/rhasspy/piper-voices
# (verify the exact file paths for the chosen voices on the machine first).

# environment file (root-owned, not world readable)
sudo mkdir -p /etc/atlas-voice-gateway
sudo cp .env.example /etc/atlas-voice-gateway/atlas-voice-gateway.env
sudo chmod 640 /etc/atlas-voice-gateway/atlas-voice-gateway.env
sudo nano /etc/atlas-voice-gateway/atlas-voice-gateway.env
```

### Pre-checks (do these on HAL before enabling)

```bash
python3 --version                     # target 3.10+
nvidia-smi                            # driver + RTX A2000 visibility
python3 -c "import torch; print(torch.cuda.is_available())"  # after install
df -h /opt /tmp                       # free disk for models + temp audio

# HAL Ollama
curl -s http://127.0.0.1:11434/api/tags
# TRON Ollama (from HAL, over LAN or Tailscale)
curl -s http://192.168.1.169:11434/api/tags

ss -ltnp | grep 8787 || echo "8787 is free"
sudo ufw status verbose               # or firewall-cmd --list-all

systemctl status atlas-voice-gateway  # current service status (if already installed)
```

Set `HAL_DEFAULT_MODEL` / `TRON_DEFAULT_MODEL` to models that actually appear in
the `api/tags` output. Leave them empty to auto-select the first model.

---

## 3. Run

```bash
cd /opt/atlas-voice-gateway
set -a; . /etc/atlas-voice-gateway/atlas-voice-gateway.env; set +a
.venv/bin/uvicorn app.main:app --host "$ATLAS_VOICE_GATEWAY_HOST" --port "$ATLAS_VOICE_GATEWAY_PORT"
```

### systemd (you own this step)

Store the env file at `/etc/atlas-voice-gateway/atlas-voice-gateway.env` and use
a unit similar to:

```ini
[Unit]
Description=Atlas Voice Gateway
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=atlas
WorkingDirectory=/opt/atlas-voice-gateway
EnvironmentFile=/etc/atlas-voice-gateway/atlas-voice-gateway.env
ExecStart=/opt/atlas-voice-gateway/.venv/bin/uvicorn app.main:app --host ${ATLAS_VOICE_GATEWAY_HOST} --port ${ATLAS_VOICE_GATEWAY_PORT}
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now atlas-voice-gateway.service
systemctl status atlas-voice-gateway.service
journalctl -u atlas-voice-gateway -f
```

STT is integrated **inside** the gateway, so no separate `atlas-whisper.service`
is required. The model loads in the background, so the gateway never fails to
start just because model loading is slow. This uses a dedicated environment file
and does **not** embed any credentials in the unit file. It does not touch any
existing DFP runtime service.

---

## 4. Endpoints

| Method | Path                                   | Purpose                                     |
|--------|----------------------------------------|---------------------------------------------|
| GET    | `/health`                              | Gateway/HAL/TRON + STT + TTS health, uptime |
| GET    | `/api/agents`                          | Public-safe HAL/TRON status (incl. `muted`) |
| POST   | `/api/agents/{agentId}/mute`           | Set gateway-side mute for HAL or TRON       |
| GET    | `/api/status`                          | Diagnostics (no env vars / secrets)         |
| POST   | `/api/chat`                            | Complete **text** interaction               |
| POST   | `/api/transcribe`                      | **Audio → transcript only**                 |
| POST   | `/api/voice`                           | **Audio → transcript → response → speech**  |
| POST   | `/api/speech`                          | **Text → synthesized agent voice (WAV)**    |
| GET    | `/api/speech/audio/{audioId}`          | Fetch a short-lived synthesized clip        |
| POST   | `/api/speech/{requestId}/playback`     | Frontend playback acknowledgement           |
| POST   | `/api/requests/{requestId}/cancel`     | Cancel an in-flight request / synthesis     |
| WS     | `/ws`                                  | Single live event stream                    |

### `POST /api/chat`

Request:

```json
{ "sessionId": "abc", "message": "check the loft switch", "routingMode": "AUTO", "preferredAgent": null }
```

Response:

```json
{ "requestId": "req_...", "sessionId": "abc", "selectedAgent": "atlas-hal",
  "response": "...", "model": "the-actual-model", "latency": 1234, "status": "complete" }
```

Validation rejects empty messages, invalid routing modes, oversized messages and
malformed bodies. Frontend input can never specify arbitrary backend URLs or
model names.

**Routing rules**

* `HAL`  → HAL only. If HAL is unavailable, returns a clear agent-unavailable error. Never silently switches.
* `TRON` → TRON only. Same rule.
* `AUTO` → deterministic keyword router. Infrastructure keywords (network, server, switch, storage, monitoring, uptime, infrastructure, n8n, docker, systemd, firewall, dns) → HAL. Engineering keywords (code, repository, github, typescript, javascript, python, build, compile, debug, database, sql, supabase, rag) → TRON. No match → **alternates** HAL/TRON. If neither is available → "Local AI unavailable".

Routing lives only in `router.py` so it can be replaced later. `/api/voice`
reuses the exact same path (see below), so there is no duplicated routing logic.

---

## 5. Speech-to-text

### How the audio path works

```
browser mic (WAV or WebM/Opus)
   → POST /api/transcribe  or  POST /api/voice   (multipart/form-data)
   → audio.py: validate content type + size  →  ffmpeg decode to 16 kHz mono WAV
   → stt.py: faster-whisper (GPU, VAD)  →  transcript
   → (voice only) existing router → HAL/TRON → response
```

The frontend does **not** need to know anything about Whisper: it just uploads
whatever `MediaRecorder` produces.

### `POST /api/transcribe`

`multipart/form-data`:

| Field      | Required | Notes                          |
|------------|----------|--------------------------------|
| `audio`    | yes      | WAV or WebM/Opus (ffmpeg)      |
| `sessionId`| yes      | passthrough session id         |
| `language` | no       | defaults to `STT_LANGUAGE`     |

Response:

```json
{ "sessionId": "abc", "transcript": "check the network status on the loft switch",
  "language": "en", "duration": 3.42, "processingTime": 780,
  "status": "complete", "model": "medium.en" }
```

No confidence value is returned: faster-whisper does not supply a
meaningfully comparable confidence in this use, so we do not invent one.

### `POST /api/voice`

`multipart/form-data`:

| Field           | Required | Notes                            |
|-----------------|----------|----------------------------------|
| `audio`         | yes      | WAV or WebM/Opus                 |
| `sessionId`     | yes      | passthrough session id           |
| `routingMode`   | no       | `HAL` / `AUTO` / `TRON` (default `AUTO`) |
| `preferredAgent`| no       | hint used only in `AUTO`         |
| `language`      | no       | defaults to `STT_LANGUAGE`       |
| `speak`         | no       | `true`/`false`; default = speak unless muted |

Flow: audio → validate → transcribe → `transcript_final` → **[existing router]**
→ agent selected → response → **Piper speech in the selected agent's voice**.
The transcript is routed **exactly** like a typed message and does **not** create
a second user message.

Success response adds the AI metadata **and the speech fields** to the
transcription fields:

```json
{ "sessionId": "abc", "transcript": "...", "language": "en", "duration": 3.42,
  "processingTime": 780, "status": "complete",
  "requestId": "req_...", "selectedAgent": "atlas-hal", "response": "...",
  "model": "the-actual-model", "latency": 1231, "sttModel": "medium.en",
  "speechStatus": "synthesized", "selectedVoiceId": "atlas-hal-voice",
  "audioRef": "/api/speech/audio/<id>", "audioContentType": "audio/wav",
  "speechDurationMs": 1840 }
```

### Audio limits (all env-tunable)

* Allowed types: `audio/wav`, `audio/webm`, `video/webm`, `audio/ogg`,
  `audio/opus` (plus `.wav/.webm/.ogg/.oga/.opus/.mp3/.m4a` by extension).
* Max upload: `STT_MAX_UPLOAD_MB` (default 25 MB) → `413 too_large`.
* Max duration: `STT_MAX_DURATION_S` (default 120 s) → `413 audio_too_long`.
* Min duration: `STT_MIN_AUDIO_MS` (default 300 ms) → `400 audio_too_short`.
* Unsupported type → `415 unsupported_type`.

### No-speech handling

Near-silent audio (RMS below `STT_SILENCE_RMS`), empty audio, or an empty
transcription return a clean state instead of feeding nonsense to HAL/TRON:

```json
{ "status": "no_speech_detected", "transcript": "", "sessionId": "abc" }
```

The voice flow stops here — the transcript is **never** routed when no speech is
detected.

### GPU / CPU

* Primary device: `STT_DEVICE` (default `cuda`, `STT_COMPUTE_TYPE=float16`).
* If GPU init fails and `STT_ALLOW_CPU_FALLBACK=true`, the service falls back to
  `STT_CPU_COMPUTE_TYPE` (`int8`) and reports **`degraded`** (with last error
  category `gpu_unavailable`). The gateway and HAL/TRON text chat keep working.
* If no device loads, STT reports **`error`**; the gateway itself stays up.

### Concurrency

`STT_MAX_CONCURRENCY` (default 1) bounds overlapping transcriptions so GPU memory
cannot be exhausted. Excess requests are **rejected cleanly** with `429 stt_busy`
rather than queued unbounded.

### Batch-first, no fake partials

faster-whisper is used batch-first. We do **not** emit fake `transcript_partial`
events. Only a genuine `transcript_final` is produced. Partial streaming can be
added later without changing the contract.

### Temp files & privacy

* Uploads are written to a dedicated `atlas-voice-gateway/` subdir under
  `STT_TEMP_DIR` (or the system temp dir) with generated UUID names.
* The client filename is **never** trusted (no path traversal).
* The raw upload and the converted WAV are deleted after processing — on success
  **and** on failure.
* Audio is processed locally and is **not** retained. Transcripts are not
  persisted by this task. Logs contain metadata only: no raw audio, no full
  transcripts by default.

---

## 6. Text-to-speech (Piper)

HAL and TRON speak with two **genuinely distinct** en-GB voices — not the same
voice at a different speed.

| Agent | voiceId | Voice model (default) | Character |
|-------|---------|-----------------------|-----------|
| HAL   | `atlas-hal-voice`  | `en_GB-alan-medium` | calm, measured, slightly deeper |
| TRON  | `atlas-tron-voice` | `en_GB-cori-high`   | clear, technical, slightly faster / brighter |

Voices are addressed by **agent identity**, never by model filename, and the
models are configurable (`TTS_HAL_VOICE` / `TTS_TRON_VOICE`). Synthesis runs on
the **CPU** by default so it never competes with faster-whisper or Ollama for
the RTX A2000, and the code is portable to TRON when it gets its own GPU.

### `POST /api/speech`

Request (JSON):

```json
{ "sessionId": "abc", "requestId": "req_...", "agent": "atlas-hal", "text": "Hello Martin." }
```

`agent` accepts **only** `atlas-hal` or `atlas-tron`; the frontend can never pass
an arbitrary voice or model path. Response:

```json
{ "sessionId": "abc", "requestId": "req_...", "agent": "atlas-hal",
  "voiceId": "atlas-hal-voice", "engine": "piper",
  "audioRef": "/api/speech/audio/<id>", "contentType": "audio/wav",
  "durationMs": 1840, "synthesisMs": 260, "status": "complete",
  "expiresAt": "2026-09-24T12:00:30+00:00" }
```

### Audio delivery

`audioRef` is a **gateway-relative resource path** — not a filesystem path and
not a public URL. The frontend fetches it with the gateway base URL prefixed:

```
GET {GATEWAY}/api/speech/audio/{audioId}   ->  audio/wav bytes
```

Clips live **only in memory** under an opaque random id with a short TTL
(`TTS_AUDIO_TTL_S`, default 30 s). They are purged on a timer, dropped when a
request is cancelled, and the whole store is cleared on restart. Nothing is
written to disk and spoken responses are not retained permanently.

### Playback acknowledgement

The gateway never fakes `speech_started`: it only knows the audio is **ready**,
not that it is playing. The frontend confirms playback:

```
POST {GATEWAY}/api/speech/{requestId}/playback
  { "sessionId": "abc", "requestId": "req_...", "agent": "atlas-hal", "state": "started" }
```

| `state` | Gateway emits | Meaning |
|---------|---------------|---------|
| `started` | `speech_started` | browser playback began |
| `ended`   | `speech_ended`   | browser playback finished |
| `stopped` | `speech_cancelled` | user interrupted playback; synthesis is cancelled too |

### Mute behaviour

`POST /api/agents/{agentId}/mute` with `{ "muted": true }` sets gateway-side
mute. A **muted** agent still produces its **text** answer, but speech is
**skipped** unless explicitly requested. `/api/voice` accepts an optional
`speak` field:

* omitted → speak unless the selected agent is muted
* `speak=true` → speak even if muted (explicit request)
* `speak=false` → never speak

The response reports `speechStatus`: `synthesized`, `skipped_muted`,
`skipped_disabled`, `skipped_interrupted`, `interrupted` or `failed`, and a
`speech` activity event is emitted when speech is skipped because of mute.

### Code in responses

TRON often returns source code. A reusable sanitizer (`speech_text.py`) strips
Markdown and code fences from the **spoken** text only — the visible chat
response is untouched. A substantial code block is replaced with the natural
phrase *"I've included the code in the console."*; raw URLs become *"a link"*.

### Interruption & cancellation

Interrupting playback calls the playback endpoint with `state: "stopped"`, or
`POST /api/requests/{requestId}/cancel`. Both cancel any in-flight synthesis,
drop the audio resource, emit `speech_cancelled`, and preserve the text
response. The same answer is **not** regenerated automatically.

### Streaming

Piper can stream raw PCM; we consume it streaming *internally* so cancellation
is honoured between chunks, then deliver a complete, browser-reliable WAV. We do
**not** chop a finished file to simulate streaming.

### TTS health

`GET /health` and `GET /api/status` expose safe TTS info: `ttsReady`, `status`,
`engine`, `device`, `halVoiceReady`, `tronVoiceReady`, a per-agent `voices` map
(`voiceId`, `language`, `style`, `ready`, `status`, `lastError`) and `lastError`.
Only the voice **filename** is shown; full model paths are never exposed.

---

## 6.1 TRON retrieval-augmented generation (RAG)

TRON can ground its answers in the indexed source repositories exposed by the
**Atlas RAG API** on `atlas-tron`. This is a **gateway-side** integration only:
the browser never calls the RAG service, and the LAN address is never shipped to
the frontend.

### Where retrieval happens in the request flow

Text and voice share exactly one routing + generation pipeline, `_execute_chat`.
Retrieval is inserted there, immediately after the agent is selected and before
generation starts:

```
POST /api/chat   (typed message)
POST /api/voice  (audio -> STT -> transcript)   <- same _execute_chat call
        |
        v
_resolve_route -> agent = atlas-tron ?  --no-->  HAL: unchanged (user message only)
        |                                    \--yes--> retrieve_context()
        |                                                 |  POST /search (TRON_RAG_API_URL)
        v                                                 v
   messages = [system(grounded prompt + outcome), user message]
        |
        v
   Ollama chat_stream -> response_delta / response_complete (unchanged contracts)
```

* **TRON only.** HAL is never augmented (its messages stay exactly
  `[{role: user, content: <message>}]`).
* **Voice uses the transcript.** `/api/voice` transcribes first and passes the
  transcript to `_execute_chat`, so the search query is the spoken text.
* **No second bubble, no new contracts.** Only the prompt changes; streaming,
  cancellation, push-to-talk, playback and failover are untouched. One
  `activity` event (`type: "rag"`) is emitted for visibility.

### The RAG API call

```
GET  {TRON_RAG_API_URL}/repos
  -> indexed repository catalogue (name metadata per repository)

POST {TRON_RAG_API_URL}/search
{ "query": "...", "limit": 4, "min_similarity": 0.4, "repository": "readdy-5650b0"? }
  -> { "results": [ { "content", "repository", "path", "similarity", "evidence", "metadata" } ] }
```

`repository` is included **only** when one is identified - either explicitly
(`repository: readdy-5650b0`, `repo=<slug>`, or a bare indexed slug like
`readdy-5650b0`) or by resolving a project name via the catalogue (below). A
generic question is searched **unfiltered** - GarageFlow (or any repository) is
never silently assumed to be the subject.

### Repository name resolution (spoken project names)

A speaker should not have to pronounce a repository slug. When the message has no
explicit reference, the client resolves a **project name** against
`GET {TRON_RAG_API_URL}/repos`, which advertises each indexed repository's name
metadata:

* The catalogue body is parsed defensively (several envelope keys and per-entry
  identifier/name keys are accepted) - no repository name is hardcoded, and the
  catalogue and LAN URL are never sent to the browser.
* Names are compared **normalised** (lowercased, alphanumerics only), so the STT
  spacing variant `"Garage Flow"` matches an indexed `"GarageFlow"`.
* Priority is: **explicit** reference > **unique** project-name match > otherwise
  no filter. An **ambiguous** name (matching several repositories) is never
  guessed - the search stays unfiltered and no repository is claimed.
* The catalogue is **cached briefly** (`TRON_RAG_REPOS_CACHE_MS`) with its own
  bounded timeout (`TRON_RAG_REPOS_TIMEOUT_MS`). A catalogue timeout, error or
  missing endpoint logs a metadata-only reason and **degrades to the existing
  unfiltered search** - it can never break a conversation.
* The resolved repository travels in the JSON `repository` field, not the query;
  the v20 complementary-query, dedup, ranking and context bounds are unchanged.

The resolution reason (`explicit` / `name` / `ambiguous` / `none` /
`catalogue_unavailable`) is reported in the metadata-only `rag retrieval` log
line - never the transcript.

### Query construction (relevance)

The raw user message is a poor search query. Sending
`"In repository readdy-5650b0, how does GarageFlow handle workshop bookings? Cite
the source file"` verbatim makes the retriever rank closing components and
`index.html` above real booking documentation. So the message is decomposed:

* `clean_query()` strips only **retrieval boilerplate** - repository identifiers
  (which travel as the separate JSON `repository` field instead), citation
  instructions (`cite the source file`, `with citations`, ...) and conversational
  filler (`please`, `can you`, `tell me`). Technical terms, file names and the
  user's meaning are preserved.
* `build_search_queries()` then adds **at most one** complementary, concise topic
  query (interrogatives / auxiliaries / filler removed), so both broad workflow
  questions and specific file questions get a good lexical match. A simple
  question with no boilerplate issues exactly one request.
* Results from every query are **merged, de-duplicated** by chunk/document
  identity (falling back to repository/path/content) and **re-ranked**: chunks
  whose *path* is the file the user asked about are boosted, chunks that merely
  *mention* that file are mildly demoted, and marketing/CTA pages are demoted
  unless the user explicitly asked for them. Source attribution is preserved per
  chunk.

The number of queries per turn is bounded by `TRON_RAG_MAX_QUERIES`, and the
overall context is bounded by `TRON_RAG_MAX_TOTAL_CHARS` *after* merging, so
request count and total retrieval time stay small.

### Safety and failure handling

* Retrieved text is treated as **untrusted reference material**: it is fenced
  between `BEGIN/END RETRIEVED REFERENCE MATERIAL` markers and the system prompt
  tells TRON to treat it as data, never instructions.
* Each excerpt is truncated to `TRON_RAG_MAX_EXCERPT_CHARS` and the whole block
to `TRON_RAG_MAX_TOTAL_CHARS` (the total cap is applied after merging).
* Source attribution is per chunk: the prompt forbids attributing one file's
  contents to another, forbids citing a file merely because another document
  mentions its path, and forbids assuming the omitted part of a mid-file chunk is
  known.
* **Timeouts, HTTP errors, unreachable service or empty results never break the
  turn.** The model is told the outcome explicitly so its answer can distinguish
  "evidence unavailable" from "no relevant matches", and it is instructed never
  to invent a repository/file citation or claim it searched when it did not.
* Logs are metadata-only (`status`, result count, elapsed ms, error code) - the
transcript text and source chunks are never logged.

### Configuration (server-side only)

| Variable | Default | Purpose |
|----------|---------|---------|
| `TRON_RAG_API_URL` | *(empty)* | RAG base URL. Empty = retrieval inert (TRON behaves as before). |
| `TRON_RAG_ENABLED` | `true` | Master switch (must also have a URL). |
| `TRON_RAG_LIMIT` | `4` | Bounded result count per search. |
| `TRON_RAG_MIN_SIMILARITY` | `0.4` | Similarity threshold (matches the verified call). |
| `TRON_RAG_TIMEOUT_MS` | `4000` | Retrieval timeout before degrading to ungrounded. |
| `TRON_RAG_MAX_EXCERPT_CHARS` | `1200` | Per-excerpt cap. |
| `TRON_RAG_MAX_TOTAL_CHARS` | `6000` | Whole-context cap (applied after merging). |
| `TRON_RAG_MAX_QUERIES` | `2` | Complementary queries per turn (request-count bound). |
| `TRON_RAG_REPOS_PATH` | `/repos` | Repository catalogue path used for project-name resolution. |
| `TRON_RAG_REPOS_CACHE_MS` | `60000` | How long the fetched catalogue is cached. |
| `TRON_RAG_REPOS_TIMEOUT_MS` | `2000` | Bounded catalogue fetch timeout before degrading to unfiltered. |

> These values (including the LAN URL) are read from the process environment by
the gateway. **Do not** put the RAG URL in frontend code or in any
`VITE_*` variable.

### Rollback

Revert the `rag.py` / `config.py` / `main.py` changes and remove the
`TRON_RAG_*` variables. Nothing is stored, migrated or deleted by this
integration - the index lives entirely in the RAG service.

### Tests

Mocked tests (no LAN service required) live in `tests/`:

```bash
cd atlas-voice-gateway
.venv/bin/pip install -r requirements.txt -r requirements-dev.txt
.venv/bin/python -m pytest tests -q
```

They cover: query cleaning (repository ids, `cite the source file`, filler),
complementary search-query construction, repository filtering, de-duplication and
re-ranking (including the booking-workflow and `WorkshopClosing.tsx` cases),
source attribution, TRON text retrieval, TRON voice retrieval (transcript query),
HAL bypass, empty results, API failure/timeout, and bounded context. They also
cover repository-name resolution: unique project name, STT spacing variant
(`Garage Flow`), explicit-slug precedence, ambiguous name, unknown name, missing
catalogue, catalogue cache/expiry, and the natural GarageFlow booking question on
both the typed and voice paths (`tests/test_rag_repos.py`).

## 7. WebSocket events

One socket, no per-agent sockets. Each event has `type` + `timestamp` and, where
relevant, `sessionId`, `requestId`, `agent`, `payload`.

On connect: `connected`, then one `agent_status` per agent and one STT status
`activity` event.

Supported: `connected`, `heartbeat`, `agent_status`, `routing_started`,
`agent_selected`, `agent_thinking`, `response_started`, `response_delta`,
`response_complete`, `activity`, `error`.

**Speech-to-text additions:** `audio_received`, `transcription_started`,
`transcript_final`, `transcription_failed`. (`transcript_partial` is intentionally
omitted this phase — see batch-first note above.)

**Text-to-speech additions:** `speech_synthesis_started`, `speech_ready`,
`speech_started`, `speech_ended`, `speech_cancelled`, `speech_failed`.

**Retrieval (RAG) addition:** when TRON retrieval runs, one `activity` event
with `type: "rag"` is emitted - no dedicated new event type. Its `label` is
`Retrieved N indexed source excerpts`, `No relevant indexed matches`, or
`Repository retrieval unavailable`. Nothing else in the stream changes.

Regarding the careful distinction between the last two pairs:

* `speech_ready` = the **server** generated the audio (audio is available at `audioRef`).
* `speech_started` / `speech_ended` = the **frontend** confirmed playback
  (via the playback-ack endpoint). The gateway never fabricates these.
* `speech_cancelled` = playback was interrupted or synthesis was cancelled.
* `speech_failed` = synthesis failed (readable error, no fake audio).

Live **voice** request order (complete talk -> think -> speak):

```
audio_received → transcription_started → transcript_final
→ routing_started → agent_selected → agent_thinking → response_started
→ response_delta… → response_complete
→ speech_synthesis_started → speech_ready
   (→ speech_started → speech_ended once the browser confirms playback)
```

If transcription fails: `transcription_failed` and **no** routing events follow.
If synthesis fails: `speech_failed`; the **text** answer is still returned.

`response_delta` contains **only** the incremental text.

---

## 8. Cancellation

`POST /api/requests/{requestId}/cancel` flags the request. The streaming loop
stops on the next chunk, which closes the Ollama stream and aborts generation.
The partial text is preserved, the request is marked `interrupted`, and a
`response_complete` (status `interrupted`) plus an `activity` event are emitted.

*(Because the loop checks the cancel flag per chunk, cancellation during a long
first-token wait takes effect once the next chunk arrives.)*

Transcription cancellation is bounded by `STT_TIMEOUT_MS`; because the blocking
model call runs in a worker thread, a timeout aborts the *wait* and the file is
cleaned up.

Synthesis cancellation is handled the same way: the cancel flag is checked
between Piper chunks, the audio resource is dropped, and `speech_cancelled` is
emitted. Interrupting playback (playback ack `state: "stopped"`) also cancels
synthesis, and the already-received **text** response is always preserved.

---

## 9. Session state

In-memory only: active request, selected agent, cancellation, WebSocket events.
**A gateway restart clears all session state.** This is intentional for this
phase and is not permanent memory.

---

## 10. Health monitoring & concurrency

* HAL and TRON are probed on an interval (`OLLAMA_HEALTH_INTERVAL_MS`).
* `agent_status` is emitted only when an agent's state changes.
* If one agent is down, the other continues working normally.
* Per-agent concurrency is capped (`ATLAS_MAX_CONCURRENT_PER_AGENT`); exceeding
  it returns `429 agent_busy`. A global cap (`ATLAS_MAX_CONCURRENT_TOTAL`) guards
  against accidental repeated requests.
* STT readiness is reported in `/health`, `/api/status` and status events as
  `sttReady`, `status`, `model`, `device`, `computeType`, `loadMs`, `lastError`.
* TTS readiness is reported the same way as `ttsReady`, `status`, `engine`,
  `device`, `halVoiceReady`, `tronVoiceReady`, `voices`, `lastError`.
* Synthesis concurrency is capped (`TTS_MAX_CONCURRENCY`, default 1) so unbounded
  jobs cannot pile up; excess requests are rejected cleanly with `429 tts_busy`.
  TTS runs on CPU and does **not** starve faster-whisper or Ollama.

---

## 11. Logging

Logged: service start/stop, requestId, selected agent, model, duration,
cancellation, agent health changes, transcription metadata (session, language,
processing time), errors.
Never logged: secrets, credentials, auth headers, raw audio, full transcripts by
default.

---

## 12. Frontend wiring

Set the console's environment variable to the gateway URL the **browser** can
reach:

```
VITE_ATLAS_VOICE_GATEWAY_URL=http://<gateway-host>:<port>
```

The WebSocket path is `/ws` on the same host/port. Add the console's origin to
`ATLAS_ALLOWED_ORIGINS`; no wildcard CORS is used.

### Exact frontend request format required next (STT)

The console will later: capture mic audio → send to the gateway → receive
transcript events → display live/final transcript → receive routed response.

```ts
const form = new FormData();
form.append("audio", audioBlob, "clip.webm");   // WebM/Opus or WAV
form.append("sessionId", sessionId);
form.append("routingMode", routingMode);          // "HAL" | "AUTO" | "TRON"
form.append("language", "en");                    // optional

// Transcript only:
await fetch(`${GATEWAY}/api/transcribe`, { method: "POST", body: form });

// Transcript + routed AI response:
await fetch(`${GATEWAY}/api/voice`, { method: "POST", body: form });
```

Do **not** set a `Content-Type` header manually for `FormData` — the browser adds
the multipart boundary. Transcripts also arrive over `/ws` as `transcript_final`
for live display.

### Exact frontend contract required next (TTS)

The console will later implement the speaking half of the loop:

1. **Receive `speech_ready`** over `/ws` — captures `agent`, `audioRef`,
   `contentType`, `durationMs`. (Or read `audioRef` from the `/api/voice` response.)
2. **Obtain the audio** — `GET {GATEWAY}{audioRef}` (a relative gateway path; never
   a filesystem path, never a public URL). The resource is short-lived.
3. **Play it** with an `Audio` element / Web Audio, styled per agent identity.
4. **Report playback started** — `POST {GATEWAY}/api/speech/{requestId}/playback`
   with `state: "started"`.
5. **Report playback ended** — same endpoint, `state: "ended"`.
6. **Interrupt playback** — same endpoint, `state: "stopped"` (cancels synthesis
   and drops the audio), or `POST /api/requests/{requestId}/cancel`.
7. **Mute behaviour** — call `POST /api/agents/{agentId}/mute` with the desired
   `muted` state; muted agents still show text and their `speechStatus` is
   reported as `skipped_muted`.

```ts
// fetch + play one synthesized reply
const ref = "/api/speech/audio/<id>";                    // from speech_ready / /api/voice
const url = `${GATEWAY}${ref}`;
const audio = new Audio(url);
await audio.play();
await fetch(`${GATEWAY}/api/speech/${requestId}/playback`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ sessionId, requestId, agent, state: "started" }),
});
```

---

## 13. Security notes

* Intended for the trusted Atlas network. Bind to the minimum interface and do
  not expose the service publicly.
* No secrets in frontend code or in this service. No Supabase service-role keys,
  Ollama credentials, n8n credentials, API secrets or SSH credentials are used.
* Uploaded filenames are untrusted; temp files use generated names and are
  removed after processing.
* Authentication is expected to be added at the gateway layer later.

---

## 14. Verification checklist (run ON HAL)

These must be run on the machine — they cannot be verified from the source alone.

```bash
# 1. STT model loads
journalctl -u atlas-voice-gateway | grep -i "STT"

# 2. GPU actually used
curl -s http://127.0.0.1:8787/api/status | jq '.stt'   # device should be "cuda"

# 3. Clear English sample transcribes correctly
curl -s -F "audio=@sample.wav" -F "sessionId=demo" http://127.0.0.1:8787/api/transcribe

# 4. Short silence → no_speech_detected
curl -s -F "audio=@silence.wav" -F "sessionId=demo" http://127.0.0.1:8787/api/transcribe

# 5. Invalid file type rejected
curl -s -F "audio=@notes.txt" -F "sessionId=demo" http://127.0.0.1:8787/api/transcribe

# 6. Oversized upload rejected
head -c 30000000 /dev/urandom > big.bin
curl -s -F "audio=@big.bin" -F "sessionId=demo" http://127.0.0.1:8787/api/transcribe

# 7. Temp audio deleted (after a request, this dir should be empty)
ls -la "${STT_TEMP_DIR:-/tmp}/atlas-voice-gateway"

# 8/9/10/11. Transcribe + route (infra → HAL, coding → TRON in AUTO)
curl -s -F "audio=@infra.wav" -F "sessionId=demo" -F "routingMode=AUTO" http://127.0.0.1:8787/api/voice
curl -s -F "audio=@coding.wav" -F "sessionId=demo" -F "routingMode=AUTO" http://127.0.0.1:8787/api/voice

# 12. WebSocket emits transcription events
websocat ws://127.0.0.1:8787/ws    # trigger an /api/voice request while connected

# 13. Text-only still works
curl -s -H 'content-type: application/json' -d '{"sessionId":"t","message":"hello","routingMode":"AUTO"}' http://127.0.0.1:8787/api/chat

# 14. STT failure does not crash the gateway
curl -s -F "audio=@notes.txt" -F "sessionId=demo" http://127.0.0.1:8787/api/transcribe
curl -s http://127.0.0.1:8787/health   # should still respond

# 15. Service survives restart
sudo systemctl restart atlas-voice-gateway && systemctl status atlas-voice-gateway

# 16. Both TTS voices initialise
curl -s http://127.0.0.1:8787/health | jq '.tts'

# 17. /api/speech works for HAL and TRON (then play the audioRef)
curl -s -H 'content-type: application/json' -d '{"sessionId":"t","agent":"atlas-hal","text":"HAL voice check."}' http://127.0.0.1:8787/api/speech
curl -s -H 'content-type: application/json' -d '{"sessionId":"t","agent":"atlas-tron","text":"TRON voice check."}' http://127.0.0.1:8787/api/speech
curl -s http://127.0.0.1:8787/api/speech/audio/<id> -o out.wav   # listen: voices must be distinct

# 18. Invalid agent rejected
curl -s -H 'content-type: application/json' -d '{"sessionId":"t","agent":"nope","text":"x"}' http://127.0.0.1:8787/api/speech

# 19. Full voice flow produces audio (HAL uses HAL voice, TRON uses TRON voice)
curl -s -F "audio=@hal.wav"  -F "sessionId=demo" -F "routingMode=HAL"  http://127.0.0.1:8787/api/voice
curl -s -F "audio=@tron.wav" -F "sessionId=demo" -F "routingMode=TRON" http://127.0.0.1:8787/api/voice

# 20. AUTO routes to the selected agent's correct voice
curl -s -F "audio=@coding.wav" -F "sessionId=demo" -F "routingMode=AUTO" http://127.0.0.1:8787/api/voice

# 21. A muted agent does not synthesize automatically (speechStatus=skipped_muted)
curl -s -H 'content-type: application/json' -d '{"muted":true}' http://127.0.0.1:8787/api/agents/atlas-hal/mute
curl -s -F "audio=@hal.wav" -F "sessionId=demo" -F "routingMode=HAL" http://127.0.0.1:8787/api/voice

# 22. Interruption / cancellation
curl -s -H 'content-type: application/json' -d '{"state":"stopped"}' http://127.0.0.1:8787/api/speech/<requestId>/playback

# 23. A very large code block is not read aloud (audio should only contain the short phrase)

# 24. TTS failure does not break text chat
curl -s -H 'content-type: application/json' -d '{"sessionId":"t","message":"hello","routingMode":"AUTO"}' http://127.0.0.1:8787/api/chat

# 25. STT still works and the gateway is healthy after several voice interactions
curl -s http://127.0.0.1:8787/health

# 26. Audio resources expire (a stale ref returns 404)
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8787/api/speech/audio/<id>

# 27. TRON RAG (requires TRON_RAG_API_URL to be set on the gateway machine)
#     A TRON question about an indexed feature should log a `rag retrieval`
#     line and return a grounded answer citing repository/path.
curl -s -H 'content-type: application/json' \
  -d '{"sessionId":"t","message":"In repository readdy-5650b0, how does GarageFlow handle workshop bookings? Cite the source file","routingMode":"TRON"}' \
  http://127.0.0.1:8787/api/chat
#     Expect a `rag retrieval ... status=ok results=N` line and an answer that
#     cites a real repository/path from the returned results (not a marketing page).
#     A HAL question must NOT produce a `rag retrieval` log line (HAL bypass).
curl -s -H 'content-type: application/json' \
  -d '{"sessionId":"t","message":"check the loft switch","routingMode":"HAL"}' \
  http://127.0.0.1:8787/api/chat

# 28. TRON RAG project-name resolution (requires TRON_RAG_API_URL on the machine)
#     A natural project name (no slug) must resolve via GET /repos and search
#     that repository. Expect a `rag retrieval ... repository=<slug> reason=name`
#     line, and a grounded answer citing repository/path.
curl -s -H 'content-type: application/json' \
  -d '{"sessionId":"t","message":"Tell me how GarageFlow makes a booking","routingMode":"TRON"}' \
  http://127.0.0.1:8787/api/chat
#     The same question spoken through the mic must resolve identically.
#     An unknown project name must log reason=none and search unfiltered.
```

Performance to record on real hardware: TTS init time, synthesis time and audio
duration (approximate real-time factor), time-to-audio-ready, CPU/RAM usage, plus
the earlier STT numbers (model load, transcription time) and gateway RSS.

---

## 15. Not in this phase

Wake-word support, Supabase memory, and n8n tools are deliberately excluded.
This stops once the complete local talk → think → speak path is verified
end-to-end.