"""Deterministic AUTO routing for the Atlas Voice Gateway.

This is intentionally simple keyword matching, isolated in its own module so it
can later be replaced by a proper routing model without touching the rest of the
gateway. No AI-based routing is used yet.
"""

from __future__ import annotations

from itertools import cycle
from typing import Optional

from .agents import AGENT_HAL, AGENT_TRON

# --- HAL: infrastructure & operations -------------------------------------
HAL_KEYWORDS: tuple[str, ...] = (
    "network",
    "server",
    "switch",
    "storage",
    "monitoring",
    "uptime",
    "infrastructure",
    "n8n",
    "docker",
    "systemd",
    "firewall",
    "dns",
)

# --- TRON: engineering & RAG ----------------------------------------------
TRON_KEYWORDS: tuple[str, ...] = (
    "code",
    "repository",
    "github",
    "typescript",
    "javascript",
    "python",
    "build",
    "compile",
    "debug",
    "database",
    "sql",
    "supabase",
    "rag",
)

INTENT_INFRA = "infrastructure"
INTENT_ENGINEERING = "engineering"
INTENT_FALLBACK = "fallback"


class AutoRouter:
    """Deterministic router with an alternating fallback for no-match prompts."""

    def __init__(self) -> None:
        # Cycles HAL -> TRON -> HAL ... for prompts that match no keyword.
        self._cycle = cycle([AGENT_HAL, AGENT_TRON])

    def classify(self, message: str) -> Optional[str]:
        """Return the intent-matching agent id, or None when nothing matches."""

        text = (message or "").lower()
        hal_score = sum(1 for keyword in HAL_KEYWORDS if keyword in text)
        tron_score = sum(1 for keyword in TRON_KEYWORDS if keyword in text)
        if hal_score == 0 and tron_score == 0:
            return None
        return AGENT_HAL if hal_score >= tron_score else AGENT_TRON

    def pick(self, message: str, available: list[str]) -> tuple[str, str, str]:
        """Choose an agent.

        Returns ``(agent_id, reason, intent)`` where ``reason`` is one of
        ``"keyword"`` or ``"alternate"`` and ``intent`` is
        ``"infrastructure"``, ``"engineering"`` or ``"fallback"``.
        """

        intent_agent = self.classify(message)
        if intent_agent is not None:
            intent = INTENT_INFRA if intent_agent == AGENT_HAL else INTENT_ENGINEERING
            choice = intent_agent if intent_agent in available else available[0]
            return choice, "keyword", intent

        # No clear match: alternate between HAL and TRON for demonstration.
        for _ in range(len(available)):
            candidate = next(self._cycle)
            if candidate in available:
                return candidate, "alternate", INTENT_FALLBACK
        return available[0], "alternate", INTENT_FALLBACK