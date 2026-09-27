"""Master voice orchestration primitives for Atlas Voice Gateway.

The MasterVoiceAgent sits above specialised agents.  It does not call models,
tools, or network services itself; it produces a structured execution decision
that the gateway can execute and audit.

V1 intentionally keeps execution single-agent so it can be introduced without
changing the existing /api/chat or /api/voice response contracts.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional, Sequence

from .agents import AGENT_HAL, AGENT_TRON

INTENT_INFRASTRUCTURE = "infrastructure"
INTENT_ENGINEERING = "engineering"
INTENT_GENERAL = "general"

HAL_TERMS: tuple[str, ...] = (
    "network", "server", "switch", "router", "storage", "truenas", "ups",
    "monitoring", "librenms", "n8n", "docker", "systemd", "firewall", "dns",
    "vlan", "fibre", "fiber", "ollama", "service", "host",
)

TRON_TERMS: tuple[str, ...] = (
    "code", "repository", "repo", "github", "typescript", "javascript",
    "python", "build", "compile", "debug", "database", "sql", "supabase",
    "rag", "migration", "api", "frontend", "backend", "test", "deploy",
)


@dataclass(frozen=True)
class MasterDecision:
    """Auditable V1 execution decision returned by the master agent."""

    selected_agent: str
    intent: str
    reason: str
    confidence: float
    requested_agents: tuple[str, ...]
    continuation: bool = False

    def public(self) -> dict:
        return {
            "selectedAgent": self.selected_agent,
            "intent": self.intent,
            "reason": self.reason,
            "confidence": round(self.confidence, 3),
            "requestedAgents": list(self.requested_agents),
            "continuation": self.continuation,
        }


class MasterVoiceAgent:
    """Deterministic orchestration layer for voice AUTO routing.

    This is deliberately policy-first rather than model-first.  A later version
    can add an LLM planner, tools, memory and approvals behind this same
    decision contract.
    """

    def decide(
        self,
        message: str,
        available_agents: Sequence[str],
        *,
        preferred_agent: Optional[str] = None,
        current_agent: Optional[str] = None,
    ) -> MasterDecision:
        available = tuple(dict.fromkeys(available_agents))
        if not available:
            raise ValueError("no available agents")

        preferred = self._canonical_agent(preferred_agent)
        if preferred and preferred in available:
            return MasterDecision(
                selected_agent=preferred,
                intent=self._intent_for(preferred),
                reason="preferred_agent",
                confidence=1.0,
                requested_agents=(preferred,),
            )

        addressed = self._addressed_agent(message)
        if addressed and addressed in available:
            return MasterDecision(
                selected_agent=addressed,
                intent=self._intent_for(addressed),
                reason="voice_address",
                confidence=1.0,
                requested_agents=(addressed,),
            )

        hal_score, tron_score = self._scores(message)
        if hal_score or tron_score:
            wanted = AGENT_HAL if hal_score >= tron_score else AGENT_TRON
            other = AGENT_TRON if wanted == AGENT_HAL else AGENT_HAL
            selected = wanted if wanted in available else other
            if selected not in available:
                selected = available[0]
            total = max(1, hal_score + tron_score)
            confidence = max(hal_score, tron_score) / total
            return MasterDecision(
                selected_agent=selected,
                intent=self._intent_for(wanted),
                reason="intent_match" if selected == wanted else "intent_failover",
                confidence=confidence,
                requested_agents=(wanted,),
            )

        current = self._canonical_agent(current_agent)
        if current and current in available:
            return MasterDecision(
                selected_agent=current,
                intent=INTENT_GENERAL,
                reason="conversation_continuity",
                confidence=0.55,
                requested_agents=(current,),
                continuation=True,
            )

        # Stable fallback is preferable to alternating agents between ordinary
        # conversational turns. HAL is the general operations fallback.
        selected = AGENT_HAL if AGENT_HAL in available else available[0]
        return MasterDecision(
            selected_agent=selected,
            intent=INTENT_GENERAL,
            reason="default",
            confidence=0.35,
            requested_agents=(selected,),
        )

    @staticmethod
    def _canonical_agent(value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        normalized = value.strip().lower()
        if normalized in ("hal", AGENT_HAL):
            return AGENT_HAL
        if normalized in ("tron", AGENT_TRON):
            return AGENT_TRON
        return None

    @staticmethod
    def _intent_for(agent_id: str) -> str:
        if agent_id == AGENT_TRON:
            return INTENT_ENGINEERING
        if agent_id == AGENT_HAL:
            return INTENT_INFRASTRUCTURE
        return INTENT_GENERAL

    @staticmethod
    def _scores(message: str) -> tuple[int, int]:
        text = (message or "").lower()
        hal_score = sum(1 for term in HAL_TERMS if term in text)
        tron_score = sum(1 for term in TRON_TERMS if term in text)
        return hal_score, tron_score

    @classmethod
    def _addressed_agent(cls, message: str) -> Optional[str]:
        text = (message or "").strip().lower()
        # Common natural voice forms such as "HAL, check the switch" and
        # "ask TRON to scan the repo".  Deliberately conservative to avoid
        # matching unrelated words that merely contain hal/tron.
        words = {token.strip(" ,.:;!?()[]{}\"'") for token in text.split()}
        if "hal" in words:
            return AGENT_HAL
        if "tron" in words:
            return AGENT_TRON
        return None
