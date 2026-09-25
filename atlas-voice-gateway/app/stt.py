"""Reusable speech-to-text service built on faster-whisper.

Design goals (this phase):
  * transcription logic never lives inside a route handler;
  * the gateway stays available while the model loads (loading -> ready);
  * the RTX A2000 GPU is the primary device, with an optional CPU fallback;
  * overlapping transcriptions are bounded so the GPU cannot be exhausted;
  * timeouts and cancellation are supported, not faked.

This is a BATCH-first integration. faster-whisper does not stream partial
transcripts for a single short clip in a way the frontend can consume, so we do
NOT emit fake ``transcript_partial`` events. Only a real ``transcript_final`` is
produced. Partial support can be layered on later without changing the contract.
"""

from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass
from typing import Optional

from .audio import AudioError, PreparedAudio, _safe_remove
from .config import Settings

logger = logging.getLogger("atlas.voice.gateway.stt")

# Service states exposed to health/status and status events.
STT_DISABLED = "disabled"
STT_LOADING = "loading"
STT_READY = "ready"
STT_DEGRADED = "degraded"
STT_ERROR = "error"


class STTError(Exception):
    """Speech service failure with a stable code for the API/event layer."""

    def __init__(self, code: str, message: str, status_code: int = 500) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code


@dataclass
class TranscriptResult:
    transcript: str
    language: Optional[str]
    duration_s: Optional[float]
    processing_ms: int
    model: str


class STTService:
    """Owns the faster-whisper model lifecycle and transcription."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.state: str = STT_DISABLED if not settings.stt_enabled else STT_LOADING
        self.device: Optional[str] = None
        self.compute_type: Optional[str] = None
        self.model: Optional[str] = settings.stt_model or None
        self.last_error: Optional[str] = None
        self.load_ms: Optional[int] = None

        self._model = None
        self._load_attempted = False
        self._semaphore = asyncio.Semaphore(max(1, settings.stt_max_concurrency))
        self._load_lock = asyncio.Lock()
        self._on_change = None

    # ------------------------------------------------------------------ status

    def set_change_handler(self, handler) -> None:
        self._on_change = handler

    def public(self) -> dict:
        """Safe STT snapshot for /health, /api/status and status events."""

        return {
            "sttReady": self.state == STT_READY,
            "status": self.state,
            "model": self.model,
            "device": self.device,
            "computeType": self.compute_type,
            "loadMs": self.load_ms,
            "lastError": self.last_error,
        }

    async def _notify_change(self) -> None:
        if self._on_change is None:
            return
        try:
            await self._on_change(self.public())
        except Exception:  # noqa: BLE001 - broadcasting must never break STT
            logger.exception("STT change handler failed")

    # -------------------------------------------------------------------- load

    async def start(self) -> None:
        """Kick off model loading in the background so startup is not blocked."""

        if not self.settings.stt_enabled:
            self.state = STT_DISABLED
            logger.info("STT disabled (STT_ENABLED=false)")
            return
        asyncio.create_task(self.ensure_loaded())

    async def ensure_loaded(self) -> None:
        """Load the model once, with GPU-first and optional CPU fallback."""

        if self._model is not None:
            return
        async with self._load_lock:
            if self._model is not None:
                return
            if self._load_attempted:
                # A previous load already failed; do not hammer the GPU with retries.
                return
            self._load_attempted = True

            self.state = STT_LOADING
            await self._notify_change()

            try:
                from faster_whisper import WhisperModel  # imported lazily on purpose
            except Exception as exc:  # noqa: BLE001 - package not installed
                self.state = STT_ERROR
                self.last_error = "dependency_missing"
                logger.error("faster-whisper is not installed: %s", exc)
                await self._notify_change()
                return

            start = time.perf_counter()
            loaded = await asyncio.to_thread(self._load_model, WhisperModel)
            self.load_ms = int((time.perf_counter() - start) * 1000)

            if loaded:
                self.state = STT_READY
                logger.info(
                    "STT model %s ready on %s (%s) in %dms",
                    self.model,
                    self.device,
                    self.compute_type,
                    self.load_ms,
                )
            await self._notify_change()

    def _load_model(self, whisper_model_cls) -> bool:
        """Try GPU first, then CPU. Runs in a worker thread."""

        s = self.settings
        attempts: list[tuple[str, str]] = [(s.stt_device, s.stt_compute_type)]
        if s.stt_allow_cpu_fallback and s.stt_device != "cpu":
            attempts.append(("cpu", s.stt_cpu_compute_type))

        for device, compute_type in attempts:
            try:
                self._model = whisper_model_cls(
                    s.stt_model,
                    device=device,
                    compute_type=compute_type,
                )
                self.device = device
                self.compute_type = compute_type
                self.last_error = None
                if device != s.stt_device:
                    # GPU was requested but we ended up on CPU: degraded, not dead.
                    self.state = STT_DEGRADED
                    self.last_error = "gpu_unavailable"
                    logger.warning("STT fell back to CPU (%s)", compute_type)
                return True
            except Exception as exc:  # noqa: BLE001 - any load failure must not crash the gateway
                self.last_error = "gpu_init_failed" if device != "cpu" else "model_load_failed"
                logger.error("STT load failed on %s/%s: %s", device, compute_type, exc)

        self.state = STT_ERROR
        self.model = s.stt_model or None
        logger.error("STT model could not be loaded on any device")
        return False

    # ------------------------------------------------------------- transcribe

    async def transcribe(
        self,
        audio: PreparedAudio,
        session_id: Optional[str] = None,
        language: Optional[str] = None,
    ) -> TranscriptResult:
        """Transcribe a prepared audio file.

        The audio file is deleted on the way out, whether we succeed or not.
        """

        if self.state == STT_DISABLED:
            _safe_remove(audio.path)
            raise STTError("stt_unavailable", "Speech recognition is disabled.", 503)

        if self.state in (STT_LOADING, STT_DISABLED):
            # Give a slow cold start a bounded chance rather than failing instantly.
            await self.ensure_loaded()

        if self._model is None:
            _safe_remove(audio.path)
            raise STTError("stt_unavailable", "Speech recognition is unavailable.", 503)

        if audio.is_silent:
            _safe_remove(audio.path)
            raise STTError("no_speech_detected", "No speech was detected in the audio.", 200)

        if self._semaphore.locked():
            # Bounded concurrency: reject cleanly instead of exhausting GPU memory.
            _safe_remove(audio.path)
            raise STTError("stt_busy", "Speech service is busy. Try again shortly.", 429)

        resolved_language = None if self.settings.stt_auto_detect_language else (language or self.settings.stt_language)

        async with self._semaphore:
            start = time.perf_counter()
            try:
                text, detected, duration = await asyncio.wait_for(
                    asyncio.to_thread(self._run_model, audio.path, resolved_language),
                    timeout=self.settings.stt_timeout_s,
                )
            except asyncio.TimeoutError as exc:
                raise STTError("transcription_timeout", "Transcription timed out.", 504) from exc
            except STTError:
                raise
            except Exception as exc:  # noqa: BLE001 - a model error must not crash the gateway
                self.last_error = "transcription_failed"
                logger.exception("transcription failed")
                raise STTError("transcription_failed", "Speech recognition failed.", 500) from exc
            finally:
                _safe_remove(audio.path)

            processing_ms = int((time.perf_counter() - start) * 1000)
            text = text.strip()
            if not text:
                raise STTError("no_speech_detected", "No speech was detected in the audio.", 200)

            return TranscriptResult(
                transcript=text,
                language=detected,
                duration_s=duration if duration is not None else audio.duration_s,
                processing_ms=processing_ms,
                model=self.model or self.settings.stt_model,
            )

    def _run_model(self, wav_path: str, language: Optional[str]) -> tuple[str, Optional[str], Optional[float]]:
        """Run the blocking faster-whisper call. Executed in a worker thread."""

        assert self._model is not None
        segments, info = self._model.transcribe(
            wav_path,
            language=language,
            beam_size=self.settings.stt_beam_size,
            vad_filter=self.settings.stt_vad,
        )

        parts: list[str] = []
        for segment in segments:
            parts.append(segment.text)

        detected = getattr(info, "language", None) or language
        duration = getattr(info, "duration", None)
        return " ".join(p.strip() for p in parts if p and p.strip()), detected, duration


def stt_error_from_audio(exc: AudioError) -> STTError:
    """Adapter so the route layer can treat audio failures uniformly."""

    return STTError(exc.code, exc.message, exc.status_code)