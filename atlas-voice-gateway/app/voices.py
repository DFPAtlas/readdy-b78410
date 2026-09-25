"""Stable voice identities for HAL and TRON.

The rest of the gateway addresses voices by *agent identity*, never by raw model
filename. This module is the single place that maps an agent id to a voice.

HAL and TRON use two genuinely distinct en-GB voices (not the same voice with a
different speed). The exact model files are configurable through the environment
so no assumption about what is installed on HAL is baked into the code.
"""

from __future__ import annotations

import os
from dataclasses import dataclass

from .agents import AGENT_HAL, AGENT_TRON
from .config import Settings

# Stable, public-safe voice identifiers (used by the frontend contract).
VOICE_HAL_ID = "atlas-hal-voice"
VOICE_TRON_ID = "atlas-tron-voice"


@dataclass(frozen=True)
class VoiceIdentity:
    """A stable, human-meaningful voice bound to one agent."""

    agent_id: str
    voice_id: str
    language: str
    style: str
    role: str
    voice_ref: str          # configured voice name or model path (never sent to the browser)
    length_scale: float     # >1 slower / more measured, <1 faster
    volume: float


def build_voice_identities(settings: Settings) -> dict[str, VoiceIdentity]:
    """Build the HAL and TRON voice identities from configuration."""

    return {
        AGENT_HAL: VoiceIdentity(
            agent_id=AGENT_HAL,
            voice_id=VOICE_HAL_ID,
            language="en-GB",
            style="calm, measured, slightly deeper",
            role="Infrastructure & Operations",
            voice_ref=settings.tts_hal_voice,
            length_scale=settings.tts_hal_length_scale,
            volume=settings.tts_hal_volume,
        ),
        AGENT_TRON: VoiceIdentity(
            agent_id=AGENT_TRON,
            voice_id=VOICE_TRON_ID,
            language="en-GB",
            style="clear, technical, slightly faster/brighter",
            role="Engineering & RAG",
            voice_ref=settings.tts_tron_voice,
            length_scale=settings.tts_tron_length_scale,
            volume=settings.tts_tron_volume,
        ),
    }


def resolve_voice_model(voice_ref: str, voices_dir: str) -> str:
    """Resolve a configured voice reference to an ``.onnx`` model path.

    Accepts either an absolute path, a relative path, or a bare Piper voice name
    (e.g. ``en_GB-alan-medium``) which is looked up inside ``voices_dir``.
    """

    ref = (voice_ref or "").strip()
    if not ref:
        return ""
    if os.path.isabs(ref):
        return ref
    if ref.endswith(".onnx") or os.sep in ref or "/" in ref:
        return os.path.join(voices_dir, ref)
    return os.path.join(voices_dir, f"{ref}.onnx")