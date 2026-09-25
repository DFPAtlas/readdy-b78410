"""WebSocket event construction.

Every event carries ``type`` and ``timestamp`` plus, where relevant,
``sessionId``, ``requestId``, ``agent`` and ``payload``.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any


def event(event_type: str, **fields: Any) -> dict:
    """Build a single gateway event dictionary.

    ``None`` fields are omitted so payloads stay small and unambiguous.
    """

    payload: dict[str, Any] = {
        "type": event_type,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    for key, value in fields.items():
        if value is not None:
            payload[key] = value
    return payload