"""Lightweight in-memory session and request state.

This is deliberately NOT permanent memory. It tracks only what is required for
active requests, selected agent, cancellation and WebSocket events. A gateway
restart clears all of this, which is acceptable for this phase.
"""

from __future__ import annotations

import time
import uuid
from dataclasses import dataclass, field
from typing import Optional

STATUS_PROCESSING = "processing"
STATUS_COMPLETE = "complete"
STATUS_INTERRUPTED = "interrupted"
STATUS_FAILED = "failed"


@dataclass
class RequestState:
    request_id: str
    session_id: str
    agent_id: str
    status: str = STATUS_PROCESSING
    cancelled: bool = False
    created_at: float = field(default_factory=time.time)


@dataclass
class SessionState:
    session_id: str
    selected_agent: Optional[str] = None
    active_request_id: Optional[str] = None
    created_at: float = field(default_factory=time.time)


class SessionStore:
    def __init__(self) -> None:
        self.sessions: dict[str, SessionState] = {}
        self.requests: dict[str, RequestState] = {}

    # --------------------------------------------------------------- sessions

    def touch_session(self, session_id: str) -> SessionState:
        session = self.sessions.get(session_id)
        if session is None:
            session = SessionState(session_id=session_id)
            self.sessions[session_id] = session
        return session

    # --------------------------------------------------------------- requests

    def create_request(self, session_id: str, agent_id: str) -> RequestState:
        request_id = f"req_{uuid.uuid4().hex[:12]}"
        request = RequestState(request_id=request_id, session_id=session_id, agent_id=agent_id)
        self.requests[request_id] = request
        session = self.touch_session(session_id)
        session.active_request_id = request_id
        return request

    def get_request(self, request_id: str) -> Optional[RequestState]:
        return self.requests.get(request_id)

    def cancel(self, request_id: str) -> bool:
        """Flag an in-flight request for cancellation.

        Returns True only if the request existed and was still processing.
        """

        request = self.requests.get(request_id)
        if request is None or request.status != STATUS_PROCESSING:
            return False
        request.cancelled = True
        return True

    def complete(self, request_id: str, status: str) -> None:
        request = self.requests.get(request_id)
        if request is None:
            return
        request.status = status
        session = self.sessions.get(request.session_id)
        if session is not None and session.active_request_id == request_id:
            session.active_request_id = None

    # ----------------------------------------------------------------- counts

    def active_request_count(self) -> int:
        return sum(1 for request in self.requests.values() if request.status == STATUS_PROCESSING)

    def active_session_count(self) -> int:
        return len(self.sessions)

    # ------------------------------------------------------------- maintenance

    def prune(self, max_age_s: float = 3600.0) -> None:
        """Drop finished requests and idle sessions so memory stays bounded."""

        now = time.time()
        finished = [
            rid
            for rid, request in self.requests.items()
            if request.status != STATUS_PROCESSING and now - request.created_at > max_age_s
        ]
        for rid in finished:
            self.requests.pop(rid, None)

        stale = [
            sid
            for sid, session in self.sessions.items()
            if session.active_request_id is None and now - session.created_at > max_age_s * 6
        ]
        for sid in stale:
            self.sessions.pop(sid, None)