"""Audio intake, validation and server-side conversion for the STT pipeline.

The browser never needs to understand Whisper internals. It uploads whatever the
browser ``MediaRecorder`` produces (WebM/Opus) or a plain WAV, and this module
turns it into the 16 kHz mono PCM WAV that faster-whisper expects.

Guarantees:
  * the uploaded filename is NEVER trusted (no path traversal);
  * every temporary file gets a unique generated name;
  * every temporary file is deleted after processing, including on failure.

Decoding non-WAV containers (WebM/Opus) requires ``ffmpeg`` on the machine. If it
is missing we fail cleanly with ``conversion_unavailable`` rather than
pretending we can transcribe.
"""

from __future__ import annotations

import array
import asyncio
import logging
import os
import shutil
import tempfile
import uuid
import wave
from dataclasses import dataclass
from typing import Optional

from .config import Settings

logger = logging.getLogger("atlas.voice.gateway.audio")

# Content types we accept. Browser WebM/Opus reports "audio/webm" (or
# "video/webm" in some engines); WAV reports one of the wav variants.
ALLOWED_CONTENT_TYPES: dict[str, str] = {
    "audio/wav": "wav",
    "audio/x-wav": "wav",
    "audio/wave": "wav",
    "audio/webm": "webm",
    "video/webm": "webm",
    "audio/ogg": "ogg",
    "audio/opus": "ogg",
    "audio/mpeg": "mp3",
    "audio/mp4": "m4a",
}

# Fallback classification by extension when the content type is generic.
ALLOWED_EXTENSIONS: dict[str, str] = {
    ".wav": "wav",
    ".webm": "webm",
    ".ogg": "ogg",
    ".oga": "ogg",
    ".opus": "ogg",
    ".mp3": "mp3",
    ".m4a": "m4a",
}

# Target format for faster-whisper.
TARGET_SAMPLE_RATE = 16_000
TARGET_CHANNELS = 1


class AudioError(Exception):
    """Audio intake/validation failure with a stable machine-readable code."""

    def __init__(self, code: str, message: str, status_code: int = 400) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code


@dataclass
class PreparedAudio:
    """A validated, converted, ready-to-transcribe audio file."""

    path: str
    duration_s: Optional[float]
    source_format: str
    sample_rate: int
    is_silent: bool


def ffmpeg_available() -> bool:
    return shutil.which("ffmpeg") is not None


def _classify(content_type: Optional[str], filename: Optional[str]) -> str:
    """Determine the source container, or raise ``unsupported_type``."""

    ctype = (content_type or "").split(";")[0].strip().lower()
    if ctype in ALLOWED_CONTENT_TYPES:
        return ALLOWED_CONTENT_TYPES[ctype]

    # Only look at the extension portion of a client-supplied name; never use
    # the name itself as a path.
    ext = os.path.splitext(os.path.basename(filename or ""))[1].lower()
    if ext in ALLOWED_EXTENSIONS:
        return ALLOWED_EXTENSIONS[ext]

    raise AudioError(
        "unsupported_type",
        "Unsupported audio format. Use WAV or WebM/Opus.",
        status_code=415,
    )


def _make_temp_dir(settings: Settings) -> str:
    """Create (once) a dedicated runtime temp directory inside the temp root."""

    base = settings.stt_temp_dir.strip() or tempfile.gettempdir()
    path = os.path.join(base, "atlas-voice-gateway")
    os.makedirs(path, mode=0o700, exist_ok=True)
    return path


async def read_upload(upload, settings: Settings) -> bytes:
    """Read an upload into memory, enforcing the size limit as we go."""

    limit = settings.stt_max_upload_bytes
    chunks: list[bytes] = []
    total = 0
    while True:
        chunk = await upload.read(1024 * 256)
        if not chunk:
            break
        total += len(chunk)
        if total > limit:
            raise AudioError(
                "too_large",
                f"Audio exceeds the {settings.stt_max_upload_mb} MB limit.",
                status_code=413,
            )
        chunks.append(chunk)

    data = b"".join(chunks)
    if not data:
        raise AudioError("empty_audio", "No audio data was received.", status_code=400)
    return data


async def _run_ffmpeg(args: list[str], timeout_s: float) -> None:
    """Run ffmpeg as a controlled subprocess (no shell, no user input)."""

    try:
        process = await asyncio.create_subprocess_exec(
            *args,
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.PIPE,
        )
    except FileNotFoundError as exc:
        raise AudioError("conversion_unavailable", "ffmpeg is not installed on this host.", 503) from exc

    try:
        _, stderr = await asyncio.wait_for(process.communicate(), timeout=timeout_s)
    except asyncio.TimeoutError as exc:
        process.kill()
        await process.wait()
        raise AudioError("conversion_timeout", "Audio conversion timed out.", 408) from exc

    if process.returncode != 0:
        detail = (stderr or b"").decode("utf-8", "ignore").strip().splitlines()
        logger.warning("ffmpeg failed (%s): %s", process.returncode, detail[-1] if detail else "unknown")
        raise AudioError("conversion_failed", "Could not decode the supplied audio.", 400)


def _wav_duration_s(path: str) -> Optional[float]:
    try:
        with wave.open(path, "rb") as handle:
            rate = handle.getframerate() or TARGET_SAMPLE_RATE
            return handle.getnframes() / float(rate)
    except (wave.Error, OSError):
        return None


def _wav_rms(path: str) -> Optional[float]:
    """Rough RMS of a 16-bit PCM WAV, used only for near-silence screening."""

    try:
        with wave.open(path, "rb") as handle:
            if handle.getsampwidth() != 2:
                return None
            frames = handle.readframes(handle.getnframes())
    except (wave.Error, OSError):
        return None

    if not frames:
        return 0.0

    samples = array.array("h")
    samples.frombytes(frames[: len(frames) - (len(frames) % 2)])
    if not samples:
        return 0.0
    total = 0
    for sample in samples:
        total += sample * sample
    return (total / len(samples)) ** 0.5


async def prepare_audio(
    data: bytes,
    content_type: Optional[str],
    filename: Optional[str],
    settings: Settings,
) -> PreparedAudio:
    """Validate, convert and describe an uploaded audio payload.

    The caller is responsible for deleting ``PreparedAudio.path`` afterwards.
    """

    source_format = _classify(content_type, filename)

    temp_dir = _make_temp_dir(settings)
    token = uuid.uuid4().hex
    raw_path = os.path.join(temp_dir, f"{token}.{source_format}")
    wav_path = os.path.join(temp_dir, f"{token}.16k.wav")

    # Never trust the client filename: we only ever write our generated name.
    with open(raw_path, "wb") as handle:
        handle.write(data)

    try:
        if source_format == "wav":
            # Still normalise: ffmpeg gives us consistent 16 kHz mono, but if it
            # is unavailable a plain PCM WAV can be used as-is.
            if ffmpeg_available():
                await _run_ffmpeg(
                    [
                        "ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error",
                        "-y", "-i", raw_path,
                        "-ac", str(TARGET_CHANNELS), "-ar", str(TARGET_SAMPLE_RATE),
                        "-f", "wav", wav_path,
                    ],
                    settings.stt_timeout_s,
                )
            else:
                os.replace(raw_path, wav_path)
        else:
            if not ffmpeg_available():
                raise AudioError(
                    "conversion_unavailable",
                    "ffmpeg is required to decode this audio format and is not installed.",
                    503,
                )
            await _run_ffmpeg(
                [
                    "ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error",
                    "-y", "-i", raw_path,
                    "-ac", str(TARGET_CHANNELS), "-ar", str(TARGET_SAMPLE_RATE),
                    "-f", "wav", wav_path,
                ],
                settings.stt_timeout_s,
            )

        duration = _wav_duration_s(wav_path)
        if duration is not None:
            if duration * 1000 < settings.stt_min_audio_ms:
                raise AudioError("audio_too_short", "That clip is too short to transcribe.", 400)
            if duration > settings.stt_max_duration_s:
                raise AudioError(
                    "audio_too_long",
                    f"Audio exceeds the {settings.stt_max_duration_s}s limit.",
                    413,
                )

        rms = _wav_rms(wav_path)
        is_silent = rms is not None and rms < settings.stt_silence_rms

        return PreparedAudio(
            path=wav_path,
            duration_s=duration,
            source_format=source_format,
            sample_rate=TARGET_SAMPLE_RATE,
            is_silent=is_silent,
        )
    finally:
        # Always remove the raw upload; the converted WAV is the caller's to use.
        _safe_remove(raw_path)


def _safe_remove(path: str) -> None:
    try:
        os.remove(path)
    except FileNotFoundError:
        pass
    except OSError:
        logger.warning("could not remove temp file %s", path)