"""Short-lived, in-memory audio resources for synthesized speech.

Synthesized responses are not exposed as filesystem paths and not published as
public URLs. Instead the gateway keeps the bytes in memory under an opaque,
random id with a short TTL, and serves them over a gateway-relative resource
route. Resources expire quickly and are purged on a timer, and the whole store
is cleared on restart.

Nothing here is written to disk, so there are no temp files to clean up and no
spoken responses are retained permanently.
"""

from __future__ import annotations

import secrets
import threading
import time
from dataclasses import dataclass, field
from typing import Optional


@dataclass
class AudioResource:
    """One synthesized audio clip, held in memory until it expires."""

    audio_id: str
    data: bytes
    content_type: str
    duration_s: float
    sample_rate: int
    session_id: Optional[str]
    request_id: Optional[str]
    agent_id: Optional[str]
    created_at: float
    expires_at: float
    created_monotonic: float = field(default_factory=time.monotonic)


class AudioStore:
    """Bounded, TTL-based in-memory store of synthesized audio clips."""

    def __init__(self, ttl_s: int) -> None:
        self.ttl_s = max(5, int(ttl_s))
        self._items: dict[str, AudioResource] = {}
        self._lock = threading.Lock()

    @property
    def count(self) -> int:
        with self._lock:
            return len(self._items)

    @property
    def byte_size(self) -> int:
        with self._lock:
            return sum(len(item.data) for item in self._items.values())

    def put(
        self,
        data: bytes,
        content_type: str,
        duration_s: float,
        sample_rate: int,
        session_id: Optional[str] = None,
        request_id: Optional[str] = None,
        agent_id: Optional[str] = None,
    ) -> AudioResource:
        """Store a clip under a fresh random id and return the resource."""

        now = time.time()
        resource = AudioResource(
            audio_id=secrets.token_urlsafe(18),
            data=data,
            content_type=content_type,
            duration_s=duration_s,
            sample_rate=sample_rate,
            session_id=session_id,
            request_id=request_id,
            agent_id=agent_id,
            created_at=now,
            expires_at=now + self.ttl_s,
        )
        with self._lock:
            self._purge_locked(now)
            self._items[resource.audio_id] = resource
        return resource

    def get(self, audio_id: str) -> Optional[AudioResource]:
        """Return a live resource, or None if unknown/expired."""

        now = time.time()
        with self._lock:
            self._purge_locked(now)
            resource = self._items.get(audio_id)
            if resource is None:
                return None
            if resource.expires_at <= now:
                self._items.pop(audio_id, None)
                return None
            return resource

    def remove(self, audio_id: str) -> None:
        with self._lock:
            self._items.pop(audio_id, None)

    def remove_by_request(self, request_id: str) -> int:
        """Drop every clip belonging to a request (used on interruption)."""

        with self._lock:
            victims = [key for key, item in self._items.items() if item.request_id == request_id]
            for key in victims:
                self._items.pop(key, None)
            return len(victims)

    def clear(self) -> None:
        with self._lock:
            self._items.clear()

    def purge_expired(self) -> int:
        with self._lock:
            return self._purge_locked(time.time())

    def _purge_locked(self, now: float) -> int:
        expired = [key for key, item in self._items.items() if item.expires_at <= now]
        for key in expired:
            self._items.pop(key, None)
        return len(expired)