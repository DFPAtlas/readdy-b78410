"""Single WebSocket fan-out for the Atlas Voice Gateway.

There is exactly ONE WebSocket endpoint. HAL and TRON never get their own
sockets; the gateway multiplexes all events through this manager.
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import WebSocket

logger = logging.getLogger("atlas.voice.gateway.ws")


class ConnectionManager:
    """Tracks connected browser clients and broadcasts events to all of them."""

    def __init__(self) -> None:
        self._clients: set[WebSocket] = set()

    @property
    def count(self) -> int:
        return len(self._clients)

    async def connect(self, websocket: WebSocket) -> None:
        await websocket.accept()
        self._clients.add(websocket)
        logger.info("websocket client connected (total=%d)", len(self._clients))

    def disconnect(self, websocket: WebSocket) -> None:
        if websocket in self._clients:
            self._clients.discard(websocket)
            logger.info("websocket client disconnected (total=%d)", len(self._clients))

    async def send(self, websocket: WebSocket, event: dict[str, Any]) -> None:
        await websocket.send_json(event)

    async def broadcast(self, event: dict[str, Any]) -> None:
        """Send an event to every client, dropping any that error out."""

        if not self._clients:
            return
        dead: list[WebSocket] = []
        for websocket in list(self._clients):
            try:
                await websocket.send_json(event)
            except Exception:  # noqa: BLE001 - a broken socket must never break the loop
                dead.append(websocket)
        for websocket in dead:
            self.disconnect(websocket)