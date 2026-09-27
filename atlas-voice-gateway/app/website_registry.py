"""Website integration registry for the Atlas Master Voice Agent.

Each website is represented by a small capability contract. Secrets stay in the
gateway environment; the browser never receives API keys or service-role tokens.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Protocol, Sequence


class CapabilityRisk(str, Enum):
    READ = "read"
    WRITE_REVERSIBLE = "write_reversible"
    WRITE_PRIVILEGED = "write_privileged"


@dataclass(frozen=True)
class WebsiteCapability:
    name: str
    description: str
    risk: CapabilityRisk


@dataclass(frozen=True)
class WebsiteDescriptor:
    id: str
    name: str
    description: str
    capabilities: tuple[WebsiteCapability, ...]
    aliases: tuple[str, ...] = field(default_factory=tuple)

    def matches(self, text: str) -> bool:
        normal = (text or "").lower()
        return self.id.lower() in normal or self.name.lower() in normal or any(a.lower() in normal for a in self.aliases)


class WebsiteConnector(Protocol):
    @property
    def descriptor(self) -> WebsiteDescriptor: ...

    def configured(self) -> bool: ...


class WebsiteRegistry:
    def __init__(self, connectors: Sequence[WebsiteConnector] = ()) -> None:
        self._connectors: dict[str, WebsiteConnector] = {}
        for connector in connectors:
            self.register(connector)

    def register(self, connector: WebsiteConnector) -> None:
        self._connectors[connector.descriptor.id] = connector

    def get(self, website_id: str) -> WebsiteConnector | None:
        return self._connectors.get(website_id)

    def list(self) -> list[WebsiteConnector]:
        return list(self._connectors.values())

    def match_message(self, message: str) -> WebsiteConnector | None:
        for connector in self._connectors.values():
            if connector.descriptor.matches(message):
                return connector
        return None

    def public_catalogue(self) -> list[dict]:
        return [
            {
                "id": c.descriptor.id,
                "name": c.descriptor.name,
                "description": c.descriptor.description,
                "configured": c.configured(),
                "capabilities": [
                    {"name": cap.name, "description": cap.description, "risk": cap.risk.value}
                    for cap in c.descriptor.capabilities
                ],
            }
            for c in self._connectors.values()
        ]
