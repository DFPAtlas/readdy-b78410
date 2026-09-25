"""Agent registry, health monitoring and concurrency control.

HAL and TRON are both represented by the same ``AgentRuntime`` structure and the
same reusable ``OllamaClient`` implementation, so there is no agent-specific
logic anywhere.
"""

from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass, field
from typing import Awaitable, Callable, Optional

from .config import Settings
from .ollama_client import OllamaClient

logger = logging.getLogger("atlas.voice.gateway.agents")

AGENT_HAL = "atlas-hal"
AGENT_TRON = "atlas-tron"

STATUS_CONNECTING = "connecting"
STATUS_ONLINE = "online"
STATUS_DEGRADED = "degraded"
STATUS_OFFLINE = "offline"
STATUS_BUSY = "busy"

HealthChangeHandler = Callable[[dict], Awaitable[None]]


@dataclass
class AgentRuntime:
    id: str
    name: str
    role: str
    client: OllamaClient
    semaphore: asyncio.Semaphore
    model: Optional[str] = None
    online: bool = False
    ollama_ready: bool = False
    latency: Optional[int] = None
    active_requests: int = 0
    initialized: bool = False
    muted: bool = False
    last_checked: float = field(default_factory=time.time)

    @property
    def busy(self) -> bool:
        return self.active_requests > 0

    @property
    def status(self) -> str:
        if not self.initialized:
            return STATUS_CONNECTING
        if not self.online:
            return STATUS_OFFLINE
        if not self.ollama_ready:
            return STATUS_DEGRADED
        if self.busy:
            return STATUS_BUSY
        return STATUS_ONLINE

    def public(self) -> dict:
        """Public-safe, frontend-facing snapshot."""

        return {
            "id": self.id,
            "name": self.name,
            "role": self.role,
            "status": self.status,
            "model": self.model,
            "ollamaReady": self.ollama_ready,
            "latency": self.latency,
            "busy": self.busy,
            "muted": self.muted,
        }


class AgentRegistry:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self._on_change: Optional[HealthChangeHandler] = None

        hal_client = OllamaClient(
            settings.hal_ollama_url,
            settings.hal_default_model,
            settings.request_timeout_s,
        )
        tron_client = OllamaClient(
            settings.tron_ollama_url,
            settings.tron_default_model,
            settings.request_timeout_s,
        )

        self.agents: dict[str, AgentRuntime] = {
            AGENT_HAL: AgentRuntime(
                id=AGENT_HAL,
                name="HAL",
                role="Infrastructure & Operations",
                client=hal_client,
                semaphore=asyncio.Semaphore(settings.max_concurrent_per_agent),
            ),
            AGENT_TRON: AgentRuntime(
                id=AGENT_TRON,
                name="TRON",
                role="Engineering & RAG",
                client=tron_client,
                semaphore=asyncio.Semaphore(settings.max_concurrent_per_agent),
            ),
        }

    # ------------------------------------------------------------------ access

    def set_change_handler(self, handler: HealthChangeHandler) -> None:
        self._on_change = handler

    def get(self, agent_id: str) -> Optional[AgentRuntime]:
        return self.agents.get(agent_id)

    def available(self) -> list[str]:
        """Agents that are reachable AND have a usable model."""

        return [aid for aid, agent in self.agents.items() if agent.online and agent.ollama_ready]

    # ------------------------------------------------------------------ health

    async def _check(self, agent: AgentRuntime) -> None:
        previous = (agent.online, agent.ollama_ready, agent.status)
        online, model, latency, ready = await agent.client.health()
        agent.online = online
        agent.model = model
        agent.latency = latency
        agent.ollama_ready = ready
        agent.initialized = True
        agent.last_checked = time.time()

        current = (agent.online, agent.ollama_ready, agent.status)
        if current != previous:
            logger.info(
                "agent %s health changed: online=%s model=%s ready=%s latency=%sms",
                agent.id,
                agent.online,
                agent.model,
                agent.ollama_ready,
                agent.latency,
            )
            if self._on_change is not None:
                try:
                    await self._on_change(agent.public())
                except Exception:  # noqa: BLE001 - broadcasting must never break health
                    logger.exception("agent change handler failed")

    async def refresh_once(self) -> None:
        await asyncio.gather(
            *(self._check(agent) for agent in self.agents.values()),
            return_exceptions=True,
        )

    async def monitor(self, interval_s: float) -> None:
        """Periodically refresh agent health. Never hammers the endpoints."""

        while True:
            try:
                await self.refresh_once()
            except asyncio.CancelledError:
                raise
            except Exception:  # noqa: BLE001
                logger.exception("health monitor iteration failed")
            await asyncio.sleep(interval_s)