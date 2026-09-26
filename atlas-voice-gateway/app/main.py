"""Atlas Voice Gateway - FastAPI application.

The gateway is the ONLY component that talks to HAL and TRON Ollama instances.
The browser talks exclusively to this service over HTTP + a single WebSocket.

This build adds **local text-to-speech** (Piper) so HAL and TRON can speak with
distinct voices. The complete loop is now:

    Console -> Gateway -> faster-whisper -> transcript -> router -> HAL/TRON
            -> response -> Piper TTS -> audio resource -> Console playback

Run (from the project directory):
    uvicorn app.main:app --host 127.0.0.1 --port 8787
"""

from __future__ import annotations

import asyncio
import logging
import threading
import time
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Optional

from fastapi import FastAPI, File, Form, HTTPException, Request, Response, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from . import __version__
from .agents import AGENT_HAL, AGENT_TRON, AgentRegistry
from .audio import AudioError, read_upload, prepare_audio
from .audio_store import AudioStore
from .config import Settings, load_settings
from .events import event
from .models import (
    ChatRequest,
    MuteRequest,
    PlaybackReport,
    RoutingMode,
    SpeechRequest,
    SpeechResponse,
    TranscribeResponse,
    VoiceResponse,
)
from .ollama_client import OllamaError, OllamaUnavailable
from .rag import RagClient, RagResult, compose_tron_messages, retrieve_context
from .router import AutoRouter
from .sessions import SessionStore
from .speech_text import sanitize_for_speech, truncate_for_speech
from .stt import STTError, STTService
from .tts import TTSCancelled, TTSError, TTSService
from .ws import ConnectionManager

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
logger = logging.getLogger("atlas.voice.gateway")

settings: Settings = load_settings()


class AppContext:
    """Process-wide state shared across requests."""

    def __init__(self, cfg: Settings) -> None:
        self.settings = cfg
        self.registry = AgentRegistry(cfg)
        self.sessions = SessionStore()
        self.router = AutoRouter()
        self.connections = ConnectionManager()
        self.stt = STTService(cfg)
        self.tts = TTSService(cfg)
        self.audio_store = AudioStore(cfg.tts_audio_ttl_s)
        # TRON-only retrieval against the Atlas RAG API (server-side; never the browser).
        self.rag = RagClient(
            cfg.tron_rag_api_url,
            enabled=cfg.tron_rag_enabled,
            limit=cfg.tron_rag_limit,
            min_similarity=cfg.tron_rag_min_similarity,
            timeout_s=cfg.tron_rag_timeout_s,
            max_excerpt_chars=cfg.tron_rag_max_excerpt_chars,
            max_total_chars=cfg.tron_rag_max_total_chars,
        )
        # requestId -> cancellation event for an in-flight synthesis job.
        self.speech_cancels: dict[str, threading.Event] = {}
        self.started_at = time.time()
        self.tasks: list[asyncio.Task] = []


# --------------------------------------------------------------------- helpers


def _agents_payload(state: AppContext) -> dict[str, dict]:
    return {aid: agent.public() for aid, agent in state.registry.agents.items()}


def _speech_ref(audio_id: str) -> str:
    """Gateway-relative resource path (never a public URL, never a fs path)."""

    return f"/api/speech/audio/{audio_id}"


def _rag_activity_label(result: RagResult) -> str:
    """Short, human-readable activity label for a TRON retrieval outcome."""

    if result.has_evidence:
        count = len(result.chunks)
        suffix = "" if count == 1 else "s"
        return f"Retrieved {count} indexed source excerpt{suffix}"
    if result.status == "empty":
        return "No relevant indexed matches"
    return "Repository retrieval unavailable"


def _iso(timestamp: float) -> str:
    return datetime.fromtimestamp(timestamp, tz=timezone.utc).isoformat()


def _resolve_route(state: AppContext, mode: RoutingMode, message: str, preferred_agent: Optional[str] = None) -> dict:
    """Decide which agent should handle the request.

    Explicit HAL/TRON selections never silently switch agents: if the chosen
    agent is unavailable a clear error is returned instead.
    """

    available = state.registry.available()

    if mode == RoutingMode.HAL:
        if AGENT_HAL not in available:
            return {"agent": None, "error": "agent_unavailable", "message": "HAL is currently unavailable"}
        return {"agent": AGENT_HAL, "reason": "explicit", "intent": "infrastructure"}

    if mode == RoutingMode.TRON:
        if AGENT_TRON not in available:
            return {"agent": None, "error": "agent_unavailable", "message": "TRON is currently unavailable"}
        return {"agent": AGENT_TRON, "reason": "explicit", "intent": "engineering"}

    # AUTO
    if not available:
        return {"agent": None, "error": "local_ai_unavailable", "message": "Local AI unavailable"}

    if preferred_agent:
        hint = preferred_agent.strip().lower()
        if hint in ("atlas-hal", "hal") and AGENT_HAL in available:
            return {"agent": AGENT_HAL, "reason": "preferred", "intent": "infrastructure"}
        if hint in ("atlas-tron", "tron") and AGENT_TRON in available:
            return {"agent": AGENT_TRON, "reason": "preferred", "intent": "engineering"}

    agent_id, reason, intent = state.router.pick(message, available)
    return {"agent": agent_id, "reason": reason, "intent": intent}


async def _execute_chat(
    state: AppContext,
    session_id: str,
    message: str,
    routing_mode: RoutingMode,
    preferred_agent: Optional[str] = None,
) -> tuple[int, dict]:
    """Run the full routing + generation pipeline.

    Shared by ``POST /api/chat`` and ``POST /api/voice`` so routing lives in
    exactly one place. Returns ``(http_status, body)``.
    """

    cfg = state.settings
    message = message.strip()

    if len(message) > cfg.max_message_chars:
        return 413, {"status": "error", "code": "message_too_large", "message": "Message is too long."}

    if state.sessions.active_request_count() >= cfg.max_concurrent_total:
        return 429, {"status": "error", "code": "too_many_requests", "message": "Too many active requests."}

    decision = _resolve_route(state, routing_mode, message, preferred_agent)
    if decision["agent"] is None:
        await state.connections.broadcast(
            event(
                "error",
                sessionId=session_id,
                payload={"code": decision["error"], "message": decision["message"]},
            )
        )
        return 503, {"status": "error", "code": decision["error"], "message": decision["message"]}

    agent_id: str = decision["agent"]
    agent = state.registry.get(agent_id)
    assert agent is not None  # registry always contains both agents

    if agent.semaphore.locked():
        return 429, {"status": "error", "code": "agent_busy", "message": f"{agent.name} is busy. Try again shortly."}

    session = state.sessions.touch_session(session_id)
    req = state.sessions.create_request(session_id, agent_id)
    session.selected_agent = agent_id

    await state.connections.broadcast(
        event(
            "routing_started",
            sessionId=session_id,
            requestId=req.request_id,
            payload={"mode": routing_mode.value, "reason": decision.get("reason")},
        )
    )
    await state.connections.broadcast(
        event("agent_selected", sessionId=session_id, requestId=req.request_id, agent=agent_id, payload={"intent": decision.get("intent")})
    )
    await state.connections.broadcast(
        event("activity", sessionId=session_id, requestId=req.request_id, agent=agent_id,
              payload={"status": "active", "type": "routing", "label": f"Routing request to {agent.name}"})
    )
    await state.connections.broadcast(
        event("agent_thinking", sessionId=session_id, requestId=req.request_id, agent=agent_id)
    )

    model = agent.model

    # TRON only: retrieve indexed repository context before generation. HAL is
    # never augmented. This is the single shared execution point, so the text
    # path (POST /api/chat) and the voice path (POST /api/voice, which passes the
    # transcribed text as ``message``) retrieve identically. Retrieval never
    # raises: a failure is carried in-band so the model can distinguish
    # "evidence unavailable" from "no relevant matches".
    messages: list[dict] = [{"role": "user", "content": message}]
    rag_result = await retrieve_context(state.rag, agent_id, message)
    if rag_result is not None:
        messages = compose_tron_messages(message, rag_result)
        await state.connections.broadcast(
            event(
                "activity",
                sessionId=session_id,
                requestId=req.request_id,
                agent=agent_id,
                payload={
                    "status": "active" if rag_result.has_evidence else "complete",
                    "type": "rag",
                    "label": _rag_activity_label(rag_result),
                },
            )
        )
        # Concise diagnostic only: never the transcript text and never source chunks.
        logger.info(
            "rag retrieval request=%s agent=%s status=%s results=%d in %dms%s",
            req.request_id,
            agent_id,
            rag_result.status,
            len(rag_result.chunks),
            rag_result.elapsed_ms,
            f" error={rag_result.error}" if rag_result.error else "",
        )

    await state.connections.broadcast(
        event("response_started", sessionId=session_id, requestId=req.request_id, agent=agent_id, payload={"model": model})
    )

    start = time.perf_counter()
    chunks: list[str] = []

    try:
        async with agent.semaphore:
            agent.active_requests += 1
            try:
                async for delta in agent.client.chat_stream(model, messages):
                    if req.cancelled:
                        break
                    chunks.append(delta)
                    await state.connections.broadcast(
                        event("response_delta", sessionId=session_id, requestId=req.request_id, agent=agent_id, payload={"delta": delta})
                    )
            finally:
                agent.active_requests -= 1
    except asyncio.CancelledError:
        req.cancelled = True
        raise
    except OllamaUnavailable:
        state.sessions.complete(req.request_id, "failed")
        await state.connections.broadcast(
            event("error", sessionId=session_id, requestId=req.request_id, agent=agent_id,
                  payload={"code": "agent_unreachable", "message": "Selected agent is unreachable"})
        )
        logger.warning("request %s failed: agent %s unreachable", req.request_id, agent_id)
        return 503, {"status": "error", "requestId": req.request_id, "code": "agent_unreachable", "message": "Selected agent is unreachable"}
    except OllamaError as exc:
        state.sessions.complete(req.request_id, "failed")
        await state.connections.broadcast(
            event("error", sessionId=session_id, requestId=req.request_id, agent=agent_id,
                  payload={"code": "agent_error", "message": str(exc)})
        )
        logger.warning("request %s failed: %s", req.request_id, exc)
        return 504, {"status": "error", "requestId": req.request_id, "code": "agent_error", "message": "The agent did not respond in time"}
    except Exception:  # noqa: BLE001
        state.sessions.complete(req.request_id, "failed")
        logger.exception("request %s unexpected error", req.request_id)
        return 500, {"status": "error", "requestId": req.request_id, "code": "internal_error", "message": "Gateway error"}

    latency = int((time.perf_counter() - start) * 1000)
    text = "".join(chunks)

    if req.cancelled:
        result_status = "interrupted"
        state.sessions.complete(req.request_id, result_status)
        await state.connections.broadcast(
            event("response_complete", sessionId=session_id, requestId=req.request_id, agent=agent_id,
                  payload={"response": text, "model": model, "latency": latency, "status": result_status})
        )
        await state.connections.broadcast(
            event("activity", sessionId=session_id, requestId=req.request_id, agent=agent_id,
                  payload={"status": "failed", "type": "cancel", "label": "Request cancelled"})
        )
        logger.info("request %s interrupted after %dms", req.request_id, latency)
    else:
        result_status = "complete"
        state.sessions.complete(req.request_id, result_status)
        await state.connections.broadcast(
            event("response_complete", sessionId=session_id, requestId=req.request_id, agent=agent_id,
                  payload={"response": text, "model": model, "latency": latency, "status": result_status})
        )
        await state.connections.broadcast(
            event("activity", sessionId=session_id, requestId=req.request_id, agent=agent_id,
                  payload={"status": "complete", "type": "response", "label": f"{agent.name} responded"})
        )
        logger.info("request %s handled by %s model=%s in %dms", req.request_id, agent_id, model, latency)

    return 200, {
        "requestId": req.request_id,
        "sessionId": session_id,
        "selectedAgent": agent_id,
        "response": text,
        "model": model,
        "latency": latency,
        "status": result_status,
    }


# ------------------------------------------------------------------- speech


def _cancel_speech(state: AppContext, request_id: str) -> bool:
    """Signal an in-flight synthesis job to stop and drop its audio."""

    cancel_event = state.speech_cancels.get(request_id)
    removed = state.audio_store.remove_by_request(request_id)
    if cancel_event is None:
        return removed > 0
    cancel_event.set()
    return True


async def _synthesize_and_store(
    state: AppContext,
    agent_id: str,
    text: str,
    session_id: Optional[str],
    request_id: str,
    cancel_event: threading.Event,
) -> dict:
    """Sanitize, synthesize and store audio, emitting the speech events.

    Raises ``TTSError`` (failure) or ``TTSCancelled`` (interrupted).
    """

    spoken = truncate_for_speech(sanitize_for_speech(text), state.settings.tts_max_chars)
    if not spoken:
        raise TTSError("empty_speech", "There is nothing to speak.", 400)

    voice_id = state.tts.voice_id_for(agent_id) or agent_id
    await state.connections.broadcast(
        event("speech_synthesis_started", sessionId=session_id, requestId=request_id, agent=agent_id,
              payload={"voiceId": voice_id, "engine": state.settings.tts_engine})
    )

    result = await state.tts.synthesize(agent_id, spoken, cancel_event=cancel_event)

    if cancel_event.is_set():
        raise TTSCancelled()

    resource = state.audio_store.put(
        data=result.wav_bytes,
        content_type=result.content_type,
        duration_s=result.duration_s,
        sample_rate=result.sample_rate,
        session_id=session_id,
        request_id=request_id,
        agent_id=agent_id,
    )
    audio_ref = _speech_ref(resource.audio_id)
    duration_ms = int(result.duration_s * 1000)

    await state.connections.broadcast(
        event("speech_ready", sessionId=session_id, requestId=request_id, agent=agent_id,
              payload={"voiceId": result.voice_id, "audioRef": audio_ref, "contentType": result.content_type,
                       "duration": result.duration_s, "durationMs": duration_ms, "synthesisMs": result.synthesis_ms,
                       "expiresAt": _iso(resource.expires_at)})
    )
    logger.info(
        "speech ready request=%s agent=%s voice=%s synth=%dms audio=%dms",
        request_id, agent_id, result.voice_id, result.synthesis_ms, duration_ms,
    )

    return {
        "voiceId": result.voice_id,
        "engine": result.engine,
        "audioRef": audio_ref,
        "contentType": result.content_type,
        "durationMs": duration_ms,
        "synthesisMs": result.synthesis_ms,
        "expiresAt": _iso(resource.expires_at),
    }


async def _run_speech(
    state: AppContext,
    agent_id: str,
    text: str,
    session_id: Optional[str],
    request_id: str,
) -> dict:
    """Wrap synthesis with a cancellation event registered for ``request_id``."""

    cancel_event = threading.Event()
    state.speech_cancels[request_id] = cancel_event
    try:
        return await _synthesize_and_store(state, agent_id, text, session_id, request_id, cancel_event)
    finally:
        state.speech_cancels.pop(request_id, None)


async def _maybe_speak_voice_reply(
    state: AppContext,
    agent_id: str,
    text: str,
    session_id: str,
    request_id: str,
    speak: Optional[bool],
) -> dict:
    """Decide whether to speak a voice-flow reply, respecting mute + status.

    Returns a dict of response fields to merge into ``VoiceResponse``.
    """

    agent = state.registry.get(agent_id)
    muted = bool(agent.muted) if agent is not None else False

    if speak is False:
        return {"speechStatus": "skipped_disabled"}
    if muted and speak is not True:
        # Muted agents still answer in text; speech is skipped unless explicitly asked.
        await state.connections.broadcast(
            event("activity", sessionId=session_id, requestId=request_id, agent=agent_id,
                  payload={"status": "skipped", "type": "speech", "label": f"{agent.name} is muted - speech skipped"})
        )
        return {"speechStatus": "skipped_muted"}

    try:
        result = await _run_speech(state, agent_id, text, session_id, request_id)
    except TTSCancelled:
        await state.connections.broadcast(
            event("speech_cancelled", sessionId=session_id, requestId=request_id, agent=agent_id)
        )
        return {"speechStatus": "interrupted"}
    except TTSError as exc:
        await state.connections.broadcast(
            event("speech_failed", sessionId=session_id, requestId=request_id, agent=agent_id,
                  payload={"code": exc.code, "message": exc.message})
        )
        logger.info("speech failed request=%s code=%s", request_id, exc.code)
        return {"speechStatus": "failed"}

    return {
        "speechStatus": "synthesized",
        "selectedVoiceId": result.get("voiceId"),
        "audioRef": result.get("audioRef"),
        "audioContentType": result.get("contentType"),
        "speechDurationMs": result.get("durationMs"),
    }


def _parse_speak_flag(raw: Optional[str]) -> Optional[bool]:
    if raw is None or raw.strip() == "":
        return None
    return raw.strip().lower() in ("1", "true", "yes", "on")


# Agent ids the gateway understands as a caller-supplied routing hint. This
# mirrors the ids ``_resolve_route`` accepts so an unknown id is never silently
# dropped on the voice path.
KNOWN_AGENT_HINTS: frozenset[str] = frozenset({"atlas-hal", "hal", "atlas-tron", "tron"})


def _unknown_preferred_agent(preferred_agent: Optional[str]) -> Optional[str]:
    """Return the offending id when an explicit preferred agent is unrecognised.

    ``None`` means "no explicit agent requested" or "a valid one" - both of which
    the router handles normally. An unrecognised id is returned verbatim so the
    caller can reject the request explicitly instead of falling through.
    """

    if preferred_agent is None:
        return None
    candidate = preferred_agent.strip()
    if not candidate:
        return None
    if candidate.lower() in KNOWN_AGENT_HINTS:
        return None
    return candidate


# ---------------------------------------------------------------------- loops


async def _heartbeat_loop(state: AppContext) -> None:
    while True:
        await asyncio.sleep(state.settings.heartbeat_interval_s)
        await state.connections.broadcast(
            event("heartbeat", payload={"uptime": int(time.time() - state.started_at)})
        )


async def _maintenance_loop(state: AppContext) -> None:
    while True:
        await asyncio.sleep(30)
        state.sessions.prune()
        state.audio_store.purge_expired()


# ---------------------------------------------------------------------- lifespan


@asynccontextmanager
async def lifespan(app: FastAPI):
    state = AppContext(settings)
    app.state.ctx = state

    async def on_agent_change(public: dict) -> None:
        await state.connections.broadcast(event("agent_status", agent=public["id"], payload=public))

    async def on_stt_change(public: dict) -> None:
        await state.connections.broadcast(
            event(
                "activity",
                payload={
                    "type": "stt",
                    "status": "active" if public["sttReady"] else public["status"],
                    "label": f"Speech service {public['status']}",
                    "stt": public,
                },
            )
        )

    async def on_tts_change(public: dict) -> None:
        await state.connections.broadcast(
            event(
                "activity",
                payload={
                    "type": "tts",
                    "status": "active" if public["ttsReady"] else public["status"],
                    "label": f"Voice synthesis {public['status']}",
                    "tts": public,
                },
            )
        )

    state.registry.set_change_handler(on_agent_change)
    state.stt.set_change_handler(on_stt_change)
    state.tts.set_change_handler(on_tts_change)

    await state.registry.refresh_once()
    # Loading STT/TTS must NOT block gateway startup: text chat is available
    # immediately, and both speech services transition loading -> ready later.
    await state.stt.start()
    await state.tts.start()
    state.audio_store.clear()

    state.tasks.append(asyncio.create_task(state.registry.monitor(settings.health_interval_s)))
    state.tasks.append(asyncio.create_task(_heartbeat_loop(state)))
    state.tasks.append(asyncio.create_task(_maintenance_loop(state)))

    logger.info("Atlas Voice Gateway %s starting", __version__)
    logger.info("HAL Ollama endpoint: %s", settings.hal_ollama_url)
    logger.info("TRON Ollama endpoint: %s", settings.tron_ollama_url)
    logger.info(
        "TRON RAG API: %s (enabled=%s, limit=%d, minSimilarity=%.2f)",
        settings.tron_rag_api_url or "not configured",
        settings.tron_rag_enabled,
        settings.tron_rag_limit,
        settings.tron_rag_min_similarity,
    )
    logger.info(
        "STT: enabled=%s model=%s device=%s compute=%s",
        settings.stt_enabled, settings.stt_model, settings.stt_device, settings.stt_compute_type,
    )
    logger.info(
        "TTS: enabled=%s engine=%s device=%s hal=%s tron=%s",
        settings.tts_enabled, settings.tts_engine, settings.tts_device,
        settings.tts_hal_voice, settings.tts_tron_voice,
    )
    if not settings.allowed_origins:
        logger.warning("ATLAS_ALLOWED_ORIGINS is empty - browser cross-origin requests will be rejected")

    try:
        yield
    finally:
        for task in state.tasks:
            task.cancel()
        await asyncio.gather(*state.tasks, return_exceptions=True)
        state.audio_store.clear()
        logger.info("Atlas Voice Gateway stopped")


app = FastAPI(title="Atlas Voice Gateway", version=__version__, lifespan=lifespan)

if settings.allowed_origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(settings.allowed_origins),
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )


# ----------------------------------------------------------------------- routes


@app.get("/")
async def root() -> dict:
    return {
        "service": "Atlas Voice Gateway",
        "version": __version__,
        "endpoints": [
            "/health", "/api/agents", "/api/status", "/api/chat",
            "/api/transcribe", "/api/voice", "/api/speech",
            "/api/speech/audio/{audioId}", "/ws",
        ],
    }


@app.get("/health")
async def health(request: Request) -> dict:
    state: AppContext = request.app.state.ctx
    agents = _agents_payload(state)
    reachable = [a for a in agents.values() if a["status"] in ("online", "busy")]
    if len(reachable) == len(agents):
        overall = "ok"
    elif reachable:
        overall = "degraded"
    else:
        overall = "error"

    return {
        "status": overall,
        "uptime": int(time.time() - state.started_at),
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "gateway": {"version": __version__, "status": "ok"},
        "stt": state.stt.public(),
        "tts": state.tts.public(),
        "agents": {
            aid: {"status": a["status"], "model": a["model"], "ollamaReady": a["ollamaReady"], "latency": a["latency"], "muted": a["muted"]}
            for aid, a in agents.items()
        },
    }


@app.get("/api/agents")
async def agents_endpoint(request: Request) -> dict:
    state: AppContext = request.app.state.ctx
    return {"agents": list(_agents_payload(state).values())}


@app.get("/api/status")
async def status_endpoint(request: Request) -> dict:
    state: AppContext = request.app.state.ctx
    return {
        "version": __version__,
        "uptime": int(time.time() - state.started_at),
        "activeSessions": state.sessions.active_session_count(),
        "activeRequests": state.sessions.active_request_count(),
        "websocketClients": state.connections.count,
        "stt": state.stt.public(),
        "tts": state.tts.public(),
        "speechAudioResources": state.audio_store.count,
        "speechAudioBytes": state.audio_store.byte_size,
        "agents": _agents_payload(state),
    }


@app.post("/api/agents/{agent_id}/mute")
async def set_mute(agent_id: str, payload: MuteRequest, request: Request) -> dict:
    """Set the gateway-side mute state for an agent (respects HAL/TRON mute)."""

    state: AppContext = request.app.state.ctx
    agent = state.registry.get(agent_id)
    if agent is None:
        raise HTTPException(status_code=404, detail="unknown_agent")

    agent.muted = bool(payload.muted)
    await state.connections.broadcast(event("agent_status", agent=agent.id, payload=agent.public()))
    logger.info("agent %s mute set to %s", agent.id, agent.muted)
    return {"agent": agent.public()}


@app.post("/api/chat")
async def chat(payload: ChatRequest, request: Request):
    state: AppContext = request.app.state.ctx

    # An explicitly requested agent id the gateway does not recognise is a real
    # request error: return a structured 400 instead of silently dropping the
    # hint and letting AUTO routing pick a different agent. This mirrors the
    # /api/voice guard and reuses the same canonical id rules
    # (``KNOWN_AGENT_HINTS`` / ``_unknown_preferred_agent``). Omitting
    # preferredAgent and valid HAL/TRON hints are unaffected.
    unknown_agent = _unknown_preferred_agent(payload.preferredAgent)
    if unknown_agent is not None:
        await state.connections.broadcast(
            event(
                "error",
                sessionId=payload.sessionId,
                payload={"code": "unknown_agent", "message": f"Unknown preferred agent: {unknown_agent}"},
            )
        )
        return JSONResponse(
            status_code=400,
            content={
                "status": "error",
                "code": "unknown_agent",
                "message": f"Unknown preferred agent: {unknown_agent}",
            },
        )

    status_code, body = await _execute_chat(
        state,
        payload.sessionId,
        payload.message,
        payload.routingMode,
        payload.preferredAgent,
    )
    return JSONResponse(status_code=status_code, content=body)


@app.post("/api/transcribe")
async def transcribe_endpoint(
    request: Request,
    audio: UploadFile = File(...),
    sessionId: str = Form(...),
    language: Optional[str] = Form(None),
):
    """Transcribe an uploaded clip. No routing, no generation."""

    state: AppContext = request.app.state.ctx
    session_id = (sessionId or "").strip()
    if not session_id:
        raise HTTPException(status_code=400, detail="sessionId is required")

    state.sessions.touch_session(session_id)

    try:
        raw = await read_upload(audio, state.settings)
    except AudioError as exc:
        await state.connections.broadcast(
            event("transcription_failed", sessionId=session_id, payload={"code": exc.code, "message": exc.message})
        )
        return JSONResponse(status_code=exc.status_code, content={"status": "error", "code": exc.code, "message": exc.message})

    await state.connections.broadcast(
        event("audio_received", sessionId=session_id, payload={"bytes": len(raw), "contentType": audio.content_type})
    )

    try:
        prepared = await prepare_audio(raw, audio.content_type, audio.filename, state.settings)
    except AudioError as exc:
        await state.connections.broadcast(
            event("transcription_failed", sessionId=session_id, payload={"code": exc.code, "message": exc.message})
        )
        return JSONResponse(status_code=exc.status_code, content={"status": "error", "code": exc.code, "message": exc.message})

    await state.connections.broadcast(
        event("transcription_started", sessionId=session_id, payload={"model": state.stt.model, "device": state.stt.device})
    )

    try:
        result = await state.stt.transcribe(prepared, session_id=session_id, language=language)
    except STTError as exc:
        logger.info("transcription failed session=%s code=%s", session_id, exc.code)
        await state.connections.broadcast(
            event("transcription_failed", sessionId=session_id, payload={"code": exc.code, "message": exc.message})
        )
        if exc.code == "no_speech_detected":
            return JSONResponse(
                status_code=200,
                content=TranscribeResponse(
                    sessionId=session_id, transcript="", language=None, duration=None, processingTime=None,
                    status="no_speech_detected", model=state.stt.model,
                ).model_dump(),
            )
        return JSONResponse(status_code=exc.status_code, content={"status": "error", "code": exc.code, "message": exc.message})

    logger.info("transcribed session=%s lang=%s in %dms", session_id, result.language, result.processing_ms)

    await state.connections.broadcast(
        event("transcript_final", sessionId=session_id, payload={"transcript": result.transcript, "language": result.language, "duration": result.duration_s, "processingTime": result.processing_ms})
    )

    return TranscribeResponse(
        sessionId=session_id,
        transcript=result.transcript,
        language=result.language,
        duration=result.duration_s,
        processingTime=result.processing_ms,
        status="complete",
        model=result.model,
    )


@app.post("/api/voice")
async def voice_endpoint(
    request: Request,
    audio: UploadFile = File(...),
    sessionId: str = Form(...),
    routingMode: str = Form("AUTO"),
    preferredAgent: Optional[str] = Form(None),
    language: Optional[str] = Form(None),
    speak: Optional[str] = Form(None),
):
    """Complete local talk -> think -> speak flow.

    transcribe -> route -> generate -> synthesize the selected agent's voice.
    Routing and generation reuse ``_execute_chat`` exactly, so there is no
    duplicated pipeline and no second user message downstream.
    """

    state: AppContext = request.app.state.ctx
    session_id = (sessionId or "").strip()
    if not session_id:
        raise HTTPException(status_code=400, detail="sessionId is required")

    try:
        mode = RoutingMode.from_value(routingMode)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="invalid_routing_mode") from exc

    explicit_speak = _parse_speak_flag(speak)

    # An explicitly requested agent id that the gateway does not recognise is a
    # real request error: return a structured 400 instead of silently ignoring
    # it and routing somewhere else (which could otherwise surface as a null or
    # unattributed reply). Valid HAL/TRON ids and the absence of a hint are
    # unaffected.
    unknown_agent = _unknown_preferred_agent(preferredAgent)
    if unknown_agent is not None:
        await state.connections.broadcast(
            event(
                "error",
                sessionId=session_id,
                payload={"code": "unknown_agent", "message": f"Unknown preferred agent: {unknown_agent}"},
            )
        )
        return JSONResponse(
            status_code=400,
            content={
                "status": "error",
                "code": "unknown_agent",
                "message": f"Unknown preferred agent: {unknown_agent}",
            },
        )

    try:
        raw = await read_upload(audio, state.settings)
    except AudioError as exc:
        await state.connections.broadcast(
            event("transcription_failed", sessionId=session_id, payload={"code": exc.code, "message": exc.message})
        )
        return JSONResponse(status_code=exc.status_code, content={"status": "error", "code": exc.code, "message": exc.message})

    await state.connections.broadcast(
        event("audio_received", sessionId=session_id, payload={"bytes": len(raw), "contentType": audio.content_type})
    )

    try:
        prepared = await prepare_audio(raw, audio.content_type, audio.filename, state.settings)
    except AudioError as exc:
        await state.connections.broadcast(
            event("transcription_failed", sessionId=session_id, payload={"code": exc.code, "message": exc.message})
        )
        return JSONResponse(status_code=exc.status_code, content={"status": "error", "code": exc.code, "message": exc.message})

    await state.connections.broadcast(
        event("transcription_started", sessionId=session_id, payload={"model": state.stt.model, "device": state.stt.device})
    )

    try:
        result = await state.stt.transcribe(prepared, session_id=session_id, language=language)
    except STTError as exc:
        logger.info("voice transcription failed session=%s code=%s", session_id, exc.code)
        await state.connections.broadcast(
            event("transcription_failed", sessionId=session_id, payload={"code": exc.code, "message": exc.message})
        )
        if exc.code == "no_speech_detected":
            # Never route a nonsense/empty transcript: stop here with a clear state.
            return JSONResponse(
                status_code=200,
                content=VoiceResponse(
                    sessionId=session_id, transcript="", language=None, duration=None, processingTime=None,
                    status="no_speech_detected", sttModel=state.stt.model,
                ).model_dump(),
            )
        return JSONResponse(status_code=exc.status_code, content={"status": "error", "code": exc.code, "message": exc.message})

    await state.connections.broadcast(
        event("transcript_final", sessionId=session_id, payload={"transcript": result.transcript, "language": result.language, "duration": result.duration_s, "processingTime": result.processing_ms})
    )

    status_code, chat_body = await _execute_chat(state, session_id, result.transcript, mode, preferredAgent)

    if status_code != 200:
        # Transcription succeeded but routing/generation failed: return both so the
        # frontend keeps the transcript while showing the real error.
        return JSONResponse(
            status_code=status_code,
            content={
                "sessionId": session_id,
                "transcript": result.transcript,
                "language": result.language,
                "duration": result.duration_s,
                "processingTime": result.processing_ms,
                "sttModel": result.model,
                **chat_body,
            },
        )

    agent_id = chat_body.get("selectedAgent")
    response_text = chat_body.get("response") or ""
    request_id = chat_body.get("requestId") or f"sp_{uuid.uuid4().hex[:12]}"
    chat_status = chat_body.get("status")

    speech_fields: dict = {}
    if chat_status != "complete" or not response_text.strip():
        speech_fields = {"speechStatus": "skipped_interrupted"}
    elif agent_id:
        speech_fields = await _maybe_speak_voice_reply(
            state, agent_id, response_text, session_id, request_id, explicit_speak
        )

    return VoiceResponse(
        sessionId=session_id,
        transcript=result.transcript,
        language=result.language,
        duration=result.duration_s,
        processingTime=result.processing_ms,
        status="complete",
        requestId=chat_body.get("requestId"),
        selectedAgent=agent_id,
        response=response_text,
        model=chat_body.get("model"),
        latency=chat_body.get("latency"),
        sttModel=result.model,
        **speech_fields,
    )


@app.post("/api/speech")
async def speech_endpoint(payload: SpeechRequest, request: Request):
    """Synthesize text in a specific agent voice. Explicitly requested speech is
    synthesized even if that agent is muted."""

    state: AppContext = request.app.state.ctx
    state.sessions.touch_session(payload.sessionId)

    request_id = (payload.requestId or "").strip() or f"sp_{uuid.uuid4().hex[:12]}"

    try:
        result = await _run_speech(state, payload.agent, payload.text, payload.sessionId, request_id)
    except TTSCancelled:
        await state.connections.broadcast(
            event("speech_cancelled", sessionId=payload.sessionId, requestId=request_id, agent=payload.agent)
        )
        return JSONResponse(
            status_code=200,
            content={"status": "cancelled", "code": "speech_cancelled", "message": "Speech was cancelled.", "requestId": request_id},
        )
    except TTSError as exc:
        await state.connections.broadcast(
            event("speech_failed", sessionId=payload.sessionId, requestId=request_id, agent=payload.agent,
                  payload={"code": exc.code, "message": exc.message})
        )
        logger.info("speech failed request=%s code=%s", request_id, exc.code)
        return JSONResponse(
            status_code=exc.status_code,
            content={"status": "error", "code": exc.code, "message": exc.message, "requestId": request_id},
        )

    return SpeechResponse(
        sessionId=payload.sessionId,
        requestId=request_id,
        agent=payload.agent,
        voiceId=result["voiceId"],
        engine=result["engine"],
        audioRef=result["audioRef"],
        contentType=result["contentType"],
        durationMs=result["durationMs"],
        synthesisMs=result["synthesisMs"],
        status="complete",
        expiresAt=result.get("expiresAt"),
    )


@app.get("/api/speech/audio/{audio_id}")
async def speech_audio(audio_id: str, request: Request):
    """Serve a synthesized clip. Gateway-relative, short-lived, never a fs path."""

    state: AppContext = request.app.state.ctx
    resource = state.audio_store.get(audio_id)
    if resource is None:
        raise HTTPException(status_code=404, detail="audio_not_found_or_expired")
    return Response(
        content=resource.data,
        media_type=resource.content_type,
        headers={"Cache-Control": "no-store", "Content-Length": str(len(resource.data))},
    )


@app.post("/api/speech/{request_id}/playback")
async def speech_playback(request_id: str, payload: PlaybackReport, request: Request) -> dict:
    """Playback acknowledgement from the frontend.

    ``started`` / ``ended`` become ``speech_started`` / ``speech_ended`` events;
    ``stopped`` means the user interrupted playback and cancels the job.
    """

    state: AppContext = request.app.state.ctx

    if payload.state == "stopped":
        _cancel_speech(state, request_id)
        await state.connections.broadcast(
            event("speech_cancelled", sessionId=payload.sessionId, requestId=request_id, agent=payload.agent)
        )
        logger.info("speech playback stopped request=%s", request_id)
        return {"requestId": request_id, "status": "cancelled"}

    event_type = "speech_started" if payload.state == "started" else "speech_ended"
    await state.connections.broadcast(
        event(event_type, sessionId=payload.sessionId, requestId=request_id, agent=payload.agent)
    )
    return {"requestId": request_id, "status": payload.state}


@app.post("/api/requests/{request_id}/cancel")
async def cancel_request(request_id: str, request: Request) -> dict:
    state: AppContext = request.app.state.ctx

    # Cancel any in-flight synthesis job for this request first.
    speech_cancelled = _cancel_speech(state, request_id)
    if speech_cancelled:
        await state.connections.broadcast(event("speech_cancelled", requestId=request_id))

    if not state.sessions.cancel(request_id):
        if speech_cancelled:
            return {"requestId": request_id, "status": "cancelling"}
        raise HTTPException(status_code=404, detail="request_not_found_or_finished")

    req = state.sessions.get_request(request_id)
    if req is not None:
        await state.connections.broadcast(
            event("activity", sessionId=req.session_id, requestId=request_id, agent=req.agent_id,
                  payload={"status": "active", "type": "cancel", "label": "Cancellation requested"})
        )
        logger.info("request %s cancellation requested", request_id)
    return {"requestId": request_id, "status": "cancelling"}


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket) -> None:
    state: AppContext = websocket.app.state.ctx
    await state.connections.connect(websocket)
    try:
        await state.connections.send(
            websocket,
            event("connected", payload={"version": __version__, "service": "Atlas Voice Gateway"}),
        )
        for agent in state.registry.agents.values():
            await state.connections.send(websocket, event("agent_status", agent=agent.id, payload=agent.public()))
        await state.connections.send(websocket, event("activity", payload={"type": "stt", "status": "active" if state.stt.state == "ready" else state.stt.state, "label": f"Speech service {state.stt.state}", "stt": state.stt.public()}))
        await state.connections.send(websocket, event("activity", payload={"type": "tts", "status": "active" if state.tts.state == "ready" else state.tts.state, "label": f"Voice synthesis {state.tts.state}", "tts": state.tts.public()}))

        while True:
            # Chat is sent over HTTP; the socket only needs keepalive here.
            raw = await websocket.receive_text()
            if raw.strip().lower() == "ping":
                await state.connections.send(websocket, event("heartbeat"))
    except WebSocketDisconnect:
        pass
    except Exception:  # noqa: BLE001
        logger.exception("websocket error")
    finally:
        state.connections.disconnect(websocket)