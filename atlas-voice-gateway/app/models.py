"""Request/response schemas for the Atlas Voice Gateway HTTP API."""

from __future__ import annotations

from enum import Enum
from typing import Optional

from pydantic import BaseModel, ConfigDict, field_validator


class RoutingMode(str, Enum):
    """The three routing modes understood by the gateway."""

    HAL = "HAL"
    AUTO = "AUTO"
    TRON = "TRON"

    @classmethod
    def from_value(cls, value: object) -> "RoutingMode":
        if isinstance(value, RoutingMode):
            return value
        normalized = str(value).strip().upper()
        for mode in cls:
            if mode.value == normalized:
                return mode
        raise ValueError(f"Invalid routing mode: {value!r}")


class ChatRequest(BaseModel):
    """Body of ``POST /api/chat``.

    Only these fields are accepted. The frontend may never pass arbitrary model
    names or backend URLs.
    """

    model_config = ConfigDict(extra="ignore")

    sessionId: str
    message: str
    routingMode: RoutingMode = RoutingMode.AUTO
    preferredAgent: Optional[str] = None

    @field_validator("sessionId")
    @classmethod
    def _validate_session_id(cls, value: str) -> str:
        value = (value or "").strip()
        if not value:
            raise ValueError("sessionId is required")
        if len(value) > 128:
            raise ValueError("sessionId is too long")
        return value

    @field_validator("message")
    @classmethod
    def _validate_message(cls, value: str) -> str:
        if value is None or value.strip() == "":
            raise ValueError("message must not be empty")
        return value

    @field_validator("routingMode", mode="before")
    @classmethod
    def _validate_routing_mode(cls, value: object) -> RoutingMode:
        if value is None or value == "":
            return RoutingMode.AUTO
        return RoutingMode.from_value(value)


class ChatResponse(BaseModel):
    """Successful body of ``POST /api/chat``."""

    requestId: str
    sessionId: str
    selectedAgent: str
    response: str
    model: Optional[str] = None
    latency: Optional[int] = None
    status: str


class AgentPublic(BaseModel):
    """Public-safe agent information (never exposes internal URLs or secrets)."""

    id: str
    name: str
    role: str
    status: str
    model: Optional[str] = None
    ollamaReady: bool
    latency: Optional[int] = None
    busy: bool


class TranscribeResponse(BaseModel):
    """Successful body of ``POST /api/transcribe``.

    Mirrors the frontend contract exactly. ``language`` is either the requested
    language or the language faster-whisper detected. No confidence value is
    invented: the field is omitted because the model does not supply one that is
    meaningfully comparable across requests.
    """

    sessionId: str
    transcript: str
    language: Optional[str] = None
    duration: Optional[float] = None
    processingTime: Optional[int] = None
    status: str
    model: Optional[str] = None


class VoiceResponse(BaseModel):
    """Successful body of ``POST /api/voice``.

    Combines the transcription result with the routed AI response metadata, so
    the frontend gets the transcript and the answer in a single round-trip.
    """

    sessionId: str
    transcript: str
    language: Optional[str] = None
    duration: Optional[float] = None
    processingTime: Optional[int] = None
    status: str
    requestId: Optional[str] = None
    selectedAgent: Optional[str] = None
    response: Optional[str] = None
    model: Optional[str] = None
    latency: Optional[int] = None
    sttModel: Optional[str] = None
    # --- speech (TTS) additions ---
    selectedVoiceId: Optional[str] = None
    speechStatus: Optional[str] = None
    audioRef: Optional[str] = None
    audioContentType: Optional[str] = None
    speechDurationMs: Optional[int] = None


# Agents the speech endpoint accepts. Nothing else is ever valid, and the
# frontend can never pass an arbitrary voice or model path.
SPEECH_AGENTS: tuple[str, ...] = ("atlas-hal", "atlas-tron")


class SpeechRequest(BaseModel):
    """Body of ``POST /api/speech``.

    ``agent`` accepts ONLY ``atlas-hal`` or ``atlas-tron`` (case-insensitive).
    """

    model_config = ConfigDict(extra="ignore")

    sessionId: str
    requestId: Optional[str] = None
    agent: str
    text: str

    @field_validator("sessionId")
    @classmethod
    def _validate_session_id(cls, value: str) -> str:
        value = (value or "").strip()
        if not value:
            raise ValueError("sessionId is required")
        if len(value) > 128:
            raise ValueError("sessionId is too long")
        return value

    @field_validator("agent")
    @classmethod
    def _validate_agent(cls, value: str) -> str:
        normalized = (value or "").strip().lower()
        if normalized not in SPEECH_AGENTS:
            raise ValueError("agent must be atlas-hal or atlas-tron")
        return normalized

    @field_validator("text")
    @classmethod
    def _validate_text(cls, value: str) -> str:
        if value is None or value.strip() == "":
            raise ValueError("text must not be empty")
        return value


class SpeechResponse(BaseModel):
    """Successful body of ``POST /api/speech``.

    ``audioRef`` is a gateway-relative resource path (not a public URL and not a
    filesystem path). The frontend plays it by prefixing the gateway base URL.
    """

    sessionId: str
    requestId: Optional[str] = None
    agent: str
    voiceId: str
    engine: str
    audioRef: str
    contentType: str
    durationMs: int
    synthesisMs: int
    status: str
    expiresAt: Optional[str] = None


class MuteRequest(BaseModel):
    """Body of ``POST /api/agents/{agentId}/mute``.

    Sets the gateway-side mute state for an agent. A muted agent still produces a
    text answer; speech is skipped unless explicitly requested.
    """

    model_config = ConfigDict(extra="ignore")

    muted: bool


class PlaybackReport(BaseModel):
    """Body of ``POST /api/speech/{requestId}/playback``.

    The frontend confirms playback so the gateway can emit ``speech_started`` /
    ``speech_ended``. The gateway never fabricates ``speech_started`` on its own:
    it only knows the audio is *ready*, not that it is playing.
    """

    model_config = ConfigDict(extra="ignore")

    sessionId: Optional[str] = None
    requestId: Optional[str] = None
    agent: Optional[str] = None
    state: str

    @field_validator("state")
    @classmethod
    def _validate_state(cls, value: str) -> str:
        normalized = (value or "").strip().lower()
        if normalized not in ("started", "ended", "stopped"):
            raise ValueError("state must be started, ended or stopped")
        return normalized