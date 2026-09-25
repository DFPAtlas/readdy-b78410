"""Reusable local text-to-speech service built on Piper.

Design goals (this phase):
  * synthesis logic never lives inside a route handler;
  * the gateway stays available while voices load (loading -> ready);
  * HAL and TRON are addressed by agent identity, never by model filename;
  * synthesis runs on the CPU by default so it never fights faster-whisper or
    Ollama for the RTX A2000 (portable to TRON when it gets its own GPU);
  * overlapping jobs are bounded, and timeouts/cancellation are real, not faked.

Output is a complete 16-bit mono WAV (browser-friendly and reliable). Piper can
stream raw PCM, and we consume it streaming *internally* so cancellation is
honoured between chunks, but we do not chop a finished file to fake streaming.
"""

from __future__ import annotations

import asyncio
import inspect
import io
import logging
import os
import tempfile
import time
import wave
from dataclasses import dataclass
from typing import Optional

from .config import Settings
from .voices import VoiceIdentity, build_voice_identities, resolve_voice_model

logger = logging.getLogger("atlas.voice.gateway.tts")

# Service states exposed to health/status and status events.
TTS_DISABLED = "disabled"
TTS_LOADING = "loading"
TTS_READY = "ready"
TTS_DEGRADED = "degraded"
TTS_ERROR = "error"

_WAV_CONTENT_TYPE = "audio/wav"


class TTSError(Exception):
    """Speech-synthesis failure with a stable code for the API/event layer."""

    def __init__(self, code: str, message: str, status_code: int = 500) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code


class TTSCancelled(Exception):
    """Raised when synthesis is cancelled between chunks."""


@dataclass
class SpeechResult:
    agent_id: str
    voice_id: str
    engine: str
    wav_bytes: bytes
    duration_s: float
    sample_rate: int
    synthesis_ms: int
    content_type: str = _WAV_CONTENT_TYPE


@dataclass
class VoiceRuntime:
    """Loaded (or failed) voice for one agent."""

    identity: VoiceIdentity
    model_path: str
    voice: object = None
    ready: bool = False
    loaded: bool = False
    last_error: Optional[str] = None


def _safe_remove(path: str) -> None:
    try:
        os.remove(path)
    except FileNotFoundError:
        pass
    except OSError:
        logger.warning("could not remove temp file %s", path)


def _pcm_to_wav(pcm: bytes, sample_rate: int, channels: int = 1, sample_width: int = 2) -> bytes:
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as wav_file:
        wav_file.setnchannels(channels)
        wav_file.setsampwidth(sample_width)
        wav_file.setframerate(sample_rate)
        wav_file.writeframes(pcm)
    return buffer.getvalue()


def _wav_info(wav_bytes: bytes) -> tuple[int, float]:
    with wave.open(io.BytesIO(wav_bytes), "rb") as wav_file:
        rate = wav_file.getframerate() or 0
        frames = wav_file.getnframes()
    duration = frames / float(rate) if rate else 0.0
    return int(rate), duration


class TTSService:
    """Owns the Piper voice lifecycle and synthesis for all agents."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.engine = settings.tts_engine
        self.state: str = TTS_DISABLED if not settings.tts_enabled else TTS_LOADING
        self.last_error: Optional[str] = None

        self._semaphore = asyncio.Semaphore(max(1, settings.tts_max_concurrency))
        self._load_lock = asyncio.Lock()
        self._load_attempted = False
        self._on_change = None

        self.voices: dict[str, VoiceRuntime] = {}
        for agent_id, identity in build_voice_identities(settings).items():
            self.voices[agent_id] = VoiceRuntime(
                identity=identity,
                model_path=resolve_voice_model(identity.voice_ref, settings.tts_voices_dir),
            )

    # ------------------------------------------------------------------ status

    def set_change_handler(self, handler) -> None:
        self._on_change = handler

    def _voice_public(self, runtime: VoiceRuntime) -> dict:
        status = "ready" if runtime.ready else ("loading" if not runtime.loaded else "unavailable")
        return {
            "voiceId": runtime.identity.voice_id,
            # Only the voice filename (never a directory path) is exposed.
            "voice": os.path.basename(runtime.identity.voice_ref) or None,
            "language": runtime.identity.language,
            "style": runtime.identity.style,
            "ready": runtime.ready,
            "status": status,
            "lastError": runtime.last_error,
        }

    def voice_id_for(self, agent_id: str) -> Optional[str]:
        runtime = self.voices.get(agent_id)
        return runtime.identity.voice_id if runtime else None

    def public(self) -> dict:
        """Safe TTS snapshot for /health, /api/status and status events."""

        voices = {agent_id: self._voice_public(rt) for agent_id, rt in self.voices.items()}
        return {
            "ttsReady": self.state == TTS_READY,
            "status": self.state,
            "engine": self.engine,
            "device": self.settings.tts_device,
            "lastError": self.last_error,
            "voices": voices,
            "halVoiceReady": voices.get("atlas-hal", {}).get("ready", False),
            "tronVoiceReady": voices.get("atlas-tron", {}).get("ready", False),
        }

    async def _notify_change(self) -> None:
        if self._on_change is None:
            return
        try:
            await self._on_change(self.public())
        except Exception:  # noqa: BLE001 - broadcasting must never break TTS
            logger.exception("TTS change handler failed")

    def _recompute_state(self) -> None:
        if not self.settings.tts_enabled:
            self.state = TTS_DISABLED
            return
        total = len(self.voices)
        ready = sum(1 for rt in self.voices.values() if rt.ready)
        attempted = total > 0 and all(rt.loaded for rt in self.voices.values())
        if total and ready == total:
            self.state = TTS_READY
        elif ready > 0:
            self.state = TTS_DEGRADED
        elif attempted:
            self.state = TTS_ERROR
        else:
            self.state = TTS_LOADING

    # -------------------------------------------------------------------- load

    async def start(self) -> None:
        """Load voices in the background so startup is never blocked by TTS."""

        if not self.settings.tts_enabled:
            self.state = TTS_DISABLED
            logger.info("TTS disabled (TTS_ENABLED=false)")
            return
        asyncio.create_task(self.ensure_loaded())

    async def ensure_loaded(self) -> None:
        """Load both voices once. A failure leaves the gateway fully operational."""

        if not self.settings.tts_enabled:
            return
        async with self._load_lock:
            if self._load_attempted:
                return
            self._load_attempted = True

            self.state = TTS_LOADING
            await self._notify_change()

            piper_voice_cls = self._import_piper()
            if piper_voice_cls is None:
                self.state = TTS_ERROR
                self.last_error = "dependency_missing"
                for runtime in self.voices.values():
                    runtime.loaded = True
                    runtime.ready = False
                    runtime.last_error = "dependency_missing"
                await self._notify_change()
                return

            for runtime in self.voices.values():
                await asyncio.to_thread(self._load_voice, runtime, piper_voice_cls)

            self._recompute_state()
            ready = [rt.identity.voice_id for rt in self.voices.values() if rt.ready]
            logger.info("TTS %s; ready voices: %s", self.state, ready or "none")
            await self._notify_change()

    def _import_piper(self):
        """Import PiperVoice across piper-tts versions, or return None."""

        try:
            from piper.voice import PiperVoice  # piper-tts 1.2.x
            return PiperVoice
        except Exception:  # noqa: BLE001
            pass
        try:
            from piper import PiperVoice  # piper-tts 1.3+
            return PiperVoice
        except Exception as exc:  # noqa: BLE001 - package not installed
            logger.error("piper is not installed: %s", exc)
            return None

    def _load_voice(self, runtime: VoiceRuntime, piper_voice_cls) -> None:
        """Load a single voice. Runs in a worker thread."""

        runtime.loaded = True
        if not runtime.model_path or not os.path.isfile(runtime.model_path):
            runtime.ready = False
            runtime.last_error = "voice_missing"
            logger.error("voice model not found: %s", runtime.model_path)
            return

        use_cuda = self.settings.tts_device.strip().lower() == "cuda"
        try:
            try:
                runtime.voice = piper_voice_cls.load(runtime.model_path, use_cuda=use_cuda)
            except TypeError:
                # Some builds do not accept use_cuda.
                runtime.voice = piper_voice_cls.load(runtime.model_path)
        except Exception as exc:  # noqa: BLE001 - a bad voice must not crash the gateway
            runtime.voice = None
            runtime.ready = False
            runtime.last_error = "voice_load_failed"
            logger.error("voice %s failed to load: %s", runtime.identity.voice_id, exc)
            return

        runtime.ready = True
        runtime.last_error = None
        logger.info("voice %s ready (%s)", runtime.identity.voice_id, os.path.basename(runtime.model_path))

    # ------------------------------------------------------------- synthesize

    async def synthesize(
        self,
        agent_id: str,
        text: str,
        cancel_event=None,
    ) -> SpeechResult:
        """Synthesize ``text`` in the agent's voice and return a complete WAV."""

        runtime = self.voices.get(agent_id)
        if runtime is None:
            raise TTSError("unknown_agent", "Unknown agent voice.", 400)

        if not self.settings.tts_enabled:
            raise TTSError("tts_unavailable", "Speech synthesis is disabled.", 503)

        if not runtime.ready:
            await self.ensure_loaded()

        if not runtime.ready or runtime.voice is None:
            raise TTSError("voice_unavailable", "The agent voice is unavailable.", 503)

        if self._semaphore.locked():
            # Bounded concurrency: reject cleanly instead of queueing unbounded.
            raise TTSError("tts_busy", "Speech service is busy. Try again shortly.", 429)

        start = time.perf_counter()
        async with self._semaphore:
            if cancel_event is not None and cancel_event.is_set():
                raise TTSCancelled()
            try:
                wav_bytes, sample_rate, duration = await asyncio.wait_for(
                    asyncio.to_thread(self._run_synthesis, runtime, text, cancel_event),
                    timeout=self.settings.tts_timeout_s,
                )
            except TTSCancelled:
                raise
            except asyncio.TimeoutError as exc:
                raise TTSError("synthesis_timeout", "Speech synthesis timed out.", 504) from exc
            except TTSError:
                raise
            except Exception as exc:  # noqa: BLE001 - synthesis error must not crash the gateway
                self.last_error = "synthesis_failed"
                logger.exception("synthesis failed for %s", agent_id)
                raise TTSError("synthesis_failed", "Speech synthesis failed.", 500) from exc

        synthesis_ms = int((time.perf_counter() - start) * 1000)
        return SpeechResult(
            agent_id=agent_id,
            voice_id=runtime.identity.voice_id,
            engine=self.engine,
            wav_bytes=wav_bytes,
            duration_s=duration,
            sample_rate=sample_rate,
            synthesis_ms=synthesis_ms,
        )

    def _run_synthesis(
        self,
        runtime: VoiceRuntime,
        text: str,
        cancel_event,
    ) -> tuple[bytes, int, float]:
        """Blocking synthesis. Executed in a worker thread."""

        voice = runtime.voice
        identity = runtime.identity

        if hasattr(voice, "synthesize_stream_raw"):
            try:
                return self._stream_to_wav(voice, identity, text, cancel_event)
            except TTSCancelled:
                raise
            except (NotImplementedError, TypeError, AttributeError):
                pass  # fall through to batch synthesis

        return self._batch_to_wav(voice, identity, text, cancel_event)

    def _sample_rate(self, voice, identity: VoiceIdentity) -> int:
        config = getattr(voice, "config", None)
        rate = getattr(config, "sample_rate", None)
        if not rate:
            raise TTSError("voice_config_invalid", "The voice configuration is missing a sample rate.", 500)
        return int(rate)

    def _engine_kwargs(self, method, identity: VoiceIdentity) -> dict:
        """Build synthesis kwargs that match the installed Piper version."""

        try:
            params = inspect.signature(method).parameters
        except (TypeError, ValueError):
            params = {}

        if "syn_config" in params:
            config = self._synthesis_config(identity)
            return {"syn_config": config} if config is not None else {}
        if "length_scale" in params:
            return {"length_scale": identity.length_scale}
        return {}

    def _synthesis_config(self, identity: VoiceIdentity):
        """Build a Piper SynthesisConfig when the installed version provides one."""

        try:
            from piper import SynthesisConfig  # piper-tts 1.3+
        except Exception:  # noqa: BLE001
            return None
        try:
            return SynthesisConfig(length_scale=identity.length_scale, volume=identity.volume)
        except TypeError:
            try:
                return SynthesisConfig(length_scale=identity.length_scale)
            except Exception:  # noqa: BLE001
                return None

    def _stream_to_wav(
        self,
        voice,
        identity: VoiceIdentity,
        text: str,
        cancel_event,
    ) -> tuple[bytes, int, float]:
        """Consume Piper's raw PCM stream, honouring cancellation per chunk."""

        sample_rate = self._sample_rate(voice, identity)
        kwargs = self._engine_kwargs(voice.synthesize_stream_raw, identity)
        frames: list[bytes] = []
        iterator = voice.synthesize_stream_raw(text, **kwargs)
        for chunk in iterator:
            if cancel_event is not None and cancel_event.is_set():
                raise TTSCancelled()
            if chunk:
                frames.append(chunk)

        if not frames:
            raise TTSError("synthesis_empty", "No speech was produced.", 500)

        pcm = b"".join(frames)
        wav_bytes = _pcm_to_wav(pcm, sample_rate)
        duration = (len(pcm) / 2.0) / sample_rate
        return wav_bytes, sample_rate, duration

    def _batch_to_wav(
        self,
        voice,
        identity: VoiceIdentity,
        text: str,
        cancel_event,
    ) -> tuple[bytes, int, float]:
        """Fallback for builds without a raw stream: synthesize a full WAV."""

        if cancel_event is not None and cancel_event.is_set():
            raise TTSCancelled()

        kwargs = self._engine_kwargs(voice.synthesize, identity)

        # Some builds write to a filesystem path...
        try:
            descriptor, temp_path = tempfile.mkstemp(suffix=".wav")
            os.close(descriptor)
            try:
                voice.synthesize(text, temp_path, **kwargs)
                with open(temp_path, "rb") as handle:
                    wav_bytes = handle.read()
            finally:
                _safe_remove(temp_path)
            sample_rate, duration = _wav_info(wav_bytes)
            return wav_bytes, sample_rate, duration
        except (TypeError, ValueError, AttributeError):
            pass

        # ...others expect an open wave.Wave_write object.
        buffer = io.BytesIO()
        with wave.open(buffer, "wb") as wav_file:
            voice.synthesize(text, wav_file, **kwargs)
        wav_bytes = buffer.getvalue()
        sample_rate, duration = _wav_info(wav_bytes)
        return wav_bytes, sample_rate, duration