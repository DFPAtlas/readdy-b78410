"""Central configuration for the Atlas Voice Gateway.

Every live-infrastructure value comes from the environment (see `.env.example`).
Nothing here is a hard requirement: the defaults are convenience fallbacks for
the current Atlas LAN and can always be overridden.

No secrets belong in this file. Authentication (if any) happens at the gateway
layer later; this phase assumes a trusted Atlas network.
"""

from __future__ import annotations

import os
from dataclasses import dataclass

# Default directory for Piper voice model files. It sits next to the application
# source by default so a checkout "just works" once voices are downloaded there.
_PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_DEFAULT_VOICES_DIR = os.path.join(_PROJECT_ROOT, "voices")


def _env_str(name: str, default: str = "") -> str:
    value = os.getenv(name)
    if value is None or value.strip() == "":
        return default
    return value.strip()


def _env_int(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw is None or raw.strip() == "":
        return default
    try:
        return int(raw)
    except ValueError:
        return default


def _env_float(name: str, default: float) -> float:
    raw = os.getenv(name)
    if raw is None or raw.strip() == "":
        return default
    try:
        return float(raw)
    except ValueError:
        return default


def _env_bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None or raw.strip() == "":
        return default
    return raw.strip().lower() in ("1", "true", "yes", "on")


@dataclass(frozen=True)
class Settings:
    """Immutable settings snapshot loaded once at process start."""

    host: str
    port: int
    hal_ollama_url: str
    tron_ollama_url: str
    hal_default_model: str
    tron_default_model: str
    request_timeout_ms: int
    health_interval_ms: int
    heartbeat_interval_ms: int
    allowed_origins: tuple[str, ...]
    max_message_chars: int
    max_concurrent_per_agent: int
    max_concurrent_total: int

    # --- Speech-to-text (faster-whisper, runs locally on HAL) ---------------
    stt_enabled: bool
    stt_model: str
    stt_device: str
    stt_compute_type: str
    stt_cpu_compute_type: str
    stt_allow_cpu_fallback: bool
    stt_language: str
    stt_auto_detect_language: bool
    stt_beam_size: int
    stt_vad: bool
    stt_min_audio_ms: int
    stt_silence_rms: int
    stt_max_upload_mb: int
    stt_max_duration_s: int
    stt_timeout_ms: int
    stt_max_concurrency: int
    stt_temp_dir: str

    # --- Text-to-speech (Piper, runs locally on HAL) ------------------------
    tts_enabled: bool
    tts_engine: str
    tts_device: str
    tts_voices_dir: str
    tts_hal_voice: str
    tts_tron_voice: str
    tts_hal_length_scale: float
    tts_tron_length_scale: float
    tts_hal_volume: float
    tts_tron_volume: float
    tts_max_chars: int
    tts_timeout_ms: int
    tts_max_concurrency: int
    tts_audio_ttl_s: int

    # --- TRON retrieval-augmented generation (RAG) --------------------------
    # Server-side only. The base URL is never exposed to the browser and is never
    # a Vite variable. Empty URL => retrieval is inert (TRON behaves as before).
    tron_rag_api_url: str
    tron_rag_enabled: bool
    tron_rag_limit: int
    tron_rag_min_similarity: float
    tron_rag_timeout_ms: int
    tron_rag_max_excerpt_chars: int
    tron_rag_max_total_chars: int

    @property
    def request_timeout_s(self) -> float:
        return self.request_timeout_ms / 1000.0

    @property
    def health_interval_s(self) -> float:
        return self.health_interval_ms / 1000.0

    @property
    def heartbeat_interval_s(self) -> float:
        return self.heartbeat_interval_ms / 1000.0

    @property
    def stt_timeout_s(self) -> float:
        return self.stt_timeout_ms / 1000.0

    @property
    def tts_timeout_s(self) -> float:
        return self.tts_timeout_ms / 1000.0

    @property
    def tron_rag_timeout_s(self) -> float:
        return self.tron_rag_timeout_ms / 1000.0

    @property
    def stt_max_upload_bytes(self) -> int:
        return self.stt_max_upload_mb * 1024 * 1024


def load_settings() -> Settings:
    """Read all configuration from the process environment."""

    origins_raw = _env_str("ATLAS_ALLOWED_ORIGINS", "")
    origins = tuple(origin.strip() for origin in origins_raw.split(",") if origin.strip())

    return Settings(
        # Bind to the minimum necessary interface. Override to the LAN/Tailscale
        # address only when the browser must reach it directly.
        host=_env_str("ATLAS_VOICE_GATEWAY_HOST", "127.0.0.1"),
        port=_env_int("ATLAS_VOICE_GATEWAY_PORT", 8787),
        # The gateway runs ON HAL, so HAL's Ollama is local by default.
        hal_ollama_url=_env_str("HAL_OLLAMA_URL", "http://127.0.0.1:11434").rstrip("/"),
        tron_ollama_url=_env_str("TRON_OLLAMA_URL", "http://192.168.1.169:11434").rstrip("/"),
        # Empty means "pick the first available model reported by Ollama".
        # Never assume a model exists: if the configured one is missing the
        # agent is reported as degraded instead of the gateway inventing one.
        hal_default_model=_env_str("HAL_DEFAULT_MODEL", ""),
        tron_default_model=_env_str("TRON_DEFAULT_MODEL", ""),
        request_timeout_ms=_env_int("REQUEST_TIMEOUT_MS", 120_000),
        health_interval_ms=_env_int("OLLAMA_HEALTH_INTERVAL_MS", 15_000),
        heartbeat_interval_ms=_env_int("ATLAS_HEARTBEAT_INTERVAL_MS", 15_000),
        allowed_origins=origins,
        max_message_chars=_env_int("ATLAS_MAX_MESSAGE_CHARS", 8_000),
        max_concurrent_per_agent=_env_int("ATLAS_MAX_CONCURRENT_PER_AGENT", 2),
        max_concurrent_total=_env_int("ATLAS_MAX_CONCURRENT_TOTAL", 4),
        # STT-related settings
        stt_enabled=_env_bool("STT_ENABLED", True),
        stt_model=_env_str("STT_MODEL", "medium.en"),
        stt_device=_env_str("STT_DEVICE", "cuda"),
        stt_compute_type=_env_str("STT_COMPUTE_TYPE", "float16"),
        stt_cpu_compute_type=_env_str("STT_CPU_COMPUTE_TYPE", "int8"),
        stt_allow_cpu_fallback=_env_bool("STT_ALLOW_CPU_FALLBACK", True),
        stt_language=_env_str("STT_LANGUAGE", "en"),
        stt_auto_detect_language=_env_bool("STT_AUTO_DETECT_LANGUAGE", False),
        stt_beam_size=_env_int("STT_BEAM_SIZE", 5),
        stt_vad=_env_bool("STT_VAD", True),
        stt_min_audio_ms=_env_int("STT_MIN_AUDIO_MS", 300),
        stt_silence_rms=_env_int("STT_SILENCE_RMS", 80),
        stt_max_upload_mb=_env_int("STT_MAX_UPLOAD_MB", 25),
        stt_max_duration_s=_env_int("STT_MAX_DURATION_S", 120),
        stt_timeout_ms=_env_int("STT_TIMEOUT_MS", 60_000),
        stt_max_concurrency=_env_int("STT_MAX_CONCURRENCY", 1),
        stt_temp_dir=_env_str("STT_TEMP_DIR", ""),
        # TTS-related settings
        tts_enabled=_env_bool("TTS_ENABLED", True),
        tts_engine=_env_str("TTS_ENGINE", "piper"),
        # Piper is CPU-friendly and deliberately NOT GPU-coupled: the RTX A2000
        # is shared with faster-whisper and Ollama. Keep TTS on CPU unless asked.
        tts_device=_env_str("TTS_DEVICE", "cpu"),
        tts_voices_dir=_env_str("TTS_VOICES_DIR", _DEFAULT_VOICES_DIR),
        # Distinct en-GB voices: HAL deeper/measured, TRON brighter/clearer.
        tts_hal_voice=_env_str("TTS_HAL_VOICE", "en_GB-alan-medium"),
        tts_tron_voice=_env_str("TTS_TRON_VOICE", "en_GB-cori-high"),
        tts_hal_length_scale=_env_float("TTS_HAL_LENGTH_SCALE", 1.08),
        tts_tron_length_scale=_env_float("TTS_TRON_LENGTH_SCALE", 0.97),
        tts_hal_volume=_env_float("TTS_HAL_VOLUME", 1.0),
        tts_tron_volume=_env_float("TTS_TRON_VOLUME", 1.0),
        tts_max_chars=_env_int("TTS_MAX_CHARS", 1200),
        tts_timeout_ms=_env_int("TTS_TIMEOUT_MS", 20_000),
        tts_max_concurrency=_env_int("TTS_MAX_CONCURRENCY", 1),
        tts_audio_ttl_s=_env_int("TTS_AUDIO_TTL_S", 30),
        # TRON RAG settings (server-side only; empty URL means retrieval is inert)
        tron_rag_api_url=_env_str("TRON_RAG_API_URL", "").rstrip("/"),
        tron_rag_enabled=_env_bool("TRON_RAG_ENABLED", True),
        tron_rag_limit=_env_int("TRON_RAG_LIMIT", 4),
        # 0.4 matches the verified /search call on atlas-tron.
        tron_rag_min_similarity=_env_float("TRON_RAG_MIN_SIMILARITY", 0.4),
        tron_rag_timeout_ms=_env_int("TRON_RAG_TIMEOUT_MS", 4_000),
        tron_rag_max_excerpt_chars=_env_int("TRON_RAG_MAX_EXCERPT_CHARS", 1_200),
        tron_rag_max_total_chars=_env_int("TRON_RAG_MAX_TOTAL_CHARS", 6_000),
    )