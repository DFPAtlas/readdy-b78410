"""Provider-neutral telephony session adapter.

This module maps an external provider call id to one Atlas voice session.
It does not implement SIP signalling itself; providers translate these actions
into their own call-control primitives.
"""

from __future__ import annotations

import hmac
import os
import time
import uuid
from dataclasses import dataclass, field
from typing import Optional

from .garageflow_workflow import GarageFlowCallWorkflow


@dataclass
class TelephonyCall:
    call_id: str
    session_id: str
    provider: str
    caller_phone: Optional[str] = None
    called_number: Optional[str] = None
    status: str = "active"
    created_at: float = field(default_factory=time.time)
    ended_at: Optional[float] = None


class TelephonyRegistry:
    def __init__(self, workflow: GarageFlowCallWorkflow) -> None:
        self.workflow = workflow
        self.calls: dict[str, TelephonyCall] = {}

    def start(
        self,
        *,
        call_id: str,
        provider: str,
        caller_phone: Optional[str] = None,
        called_number: Optional[str] = None,
    ) -> TelephonyCall:
        call_id = (call_id or "").strip()
        if not call_id:
            raise ValueError("call_id_required")

        existing = self.calls.get(call_id)
        if existing and existing.status == "active":
            return existing

        session_id = f"tel_{uuid.uuid4().hex[:16]}"
        call = TelephonyCall(
            call_id=call_id,
            session_id=session_id,
            provider=(provider or "generic").strip().lower(),
            caller_phone=caller_phone,
            called_number=called_number,
        )
        self.calls[call_id] = call
        self.workflow.start(session_id, caller_phone)
        return call

    def get(self, call_id: str) -> TelephonyCall | None:
        return self.calls.get(call_id)

    def end(self, call_id: str) -> TelephonyCall:
        call = self.calls.get(call_id)
        if call is None:
            raise ValueError("call_not_found")
        if call.status != "ended":
            call.status = "ended"
            call.ended_at = time.time()
            self.workflow.end(call.session_id)
        return call

    def public(self, call: TelephonyCall) -> dict:
        return {
            "callId": call.call_id,
            "sessionId": call.session_id,
            "provider": call.provider,
            "status": call.status,
        }


class TelephonyAuth:
    """Small shared-secret guard for provider-facing webhook endpoints."""

    def __init__(self, secret: Optional[str] = None) -> None:
        self.secret = secret if secret is not None else os.getenv("TELEPHONY_SHARED_SECRET", "")

    def configured(self) -> bool:
        return bool(self.secret)

    def verify(self, supplied: Optional[str]) -> bool:
        if not self.configured() or supplied is None:
            return False
        return hmac.compare_digest(self.secret, supplied)


def transfer_number() -> str:
    """Server-side configured human transfer target."""

    return os.getenv("GARAGEFLOW_TRANSFER_NUMBER", "").strip()
