"""GarageFlow session workflow service.

Binds GarageFlow telephone booking state to the existing Atlas voice session.
Telephony transport and natural-language extraction remain separate concerns.
"""

from __future__ import annotations

from dataclasses import asdict
from typing import Optional

from .garageflow_call import GarageFlowCallController, GarageFlowCallState
from .garageflow_connector import GarageFlowConnector
from .sessions import SessionStore


WORKFLOW_GARAGEFLOW_BOOKING = "garageflow_booking"


class GarageFlowCallWorkflow:
    def __init__(
        self,
        sessions: SessionStore,
        connector: GarageFlowConnector,
        controller: GarageFlowCallController | None = None,
    ) -> None:
        self.sessions = sessions
        self.connector = connector
        self.controller = controller or GarageFlowCallController()

    def start(self, session_id: str, caller_phone: Optional[str] = None) -> GarageFlowCallState:
        session = self.sessions.touch_session(session_id)
        state = self.controller.start(session_id, caller_phone)
        session.active_workflow = WORKFLOW_GARAGEFLOW_BOOKING
        session.workflow_state = state
        return state

    def get(self, session_id: str) -> GarageFlowCallState | None:
        session = self.sessions.touch_session(session_id)
        if session.active_workflow != WORKFLOW_GARAGEFLOW_BOOKING:
            return None
        state = session.workflow_state
        return state if isinstance(state, GarageFlowCallState) else None

    def end(self, session_id: str) -> None:
        session = self.sessions.touch_session(session_id)
        session.active_workflow = None
        session.workflow_state = None

    async def identify_by_caller_phone(self, session_id: str) -> dict:
        state = self._require(session_id)
        if not state.caller_phone:
            return {"status": "needs_input", "field": "caller_phone"}

        customers = await self.connector.find_customer_by_phone(state.caller_phone)
        if len(customers) == 0:
            return {"status": "not_found", "candidates": []}
        if len(customers) > 1:
            return {
                "status": "ambiguous",
                "candidates": [self._safe_customer(c) for c in customers],
            }

        customer = customers[0]
        customer_id = str(customer.get("id") or "")
        customer_name = self._customer_name(customer)
        if not customer_id:
            return {"status": "error", "code": "customer_missing_id"}

        self.controller.set_customer(
            state,
            customer_id=customer_id,
            customer_name=customer_name or "Customer",
        )
        return {
            "status": "matched",
            "customer": self._safe_customer(customer),
            "stage": state.stage.value,
        }

    async def availability(self, session_id: str, interval_minutes: int = 30) -> list[dict]:
        state = self._require(session_id)
        if not state.ready_for_availability():
            raise ValueError("booking_details_incomplete")

        slots = await self.connector.availability(
            date=state.preferred_date or "",
            duration_minutes=int(state.duration_minutes or 0),
            interval_minutes=interval_minutes,
        )
        self.controller.set_available_slots(state, slots)
        return slots

    async def create_booking(self, session_id: str) -> dict:
        state = self._require(session_id)
        if not state.ready_to_book() or state.stage.value != "create_booking":
            raise ValueError("booking_not_confirmed")

        assert state.selected_slot is not None
        booking = await self.connector.create_booking_request(
            customer_id=state.customer_id or "",
            vehicle_id=state.vehicle_id or "",
            service_type=state.service_type or "other",
            starts_at=state.selected_slot.starts_at,
            ends_at=state.selected_slot.ends_at,
            duration_minutes=int(state.duration_minutes or 0),
            title=state.service_label or "GarageFlow telephone booking",
            customer_description=state.customer_description,
            idempotency_key=f"voice-call:{session_id}",
        )
        booking_id = str(booking.get("id") or "")
        if not booking_id:
            raise RuntimeError("garageflow_booking_missing_id")
        self.controller.booking_created(state, booking_id)
        return booking

    def public_state(self, session_id: str) -> dict | None:
        state = self.get(session_id)
        if state is None:
            return None
        data = asdict(state)
        data["stage"] = state.stage.value
        # Caller telephone number is intentionally omitted from generic
        # diagnostics/public state.
        data.pop("caller_phone", None)
        return data

    def _require(self, session_id: str) -> GarageFlowCallState:
        state = self.get(session_id)
        if state is None:
            raise ValueError("garageflow_call_not_started")
        return state

    @staticmethod
    def _customer_name(customer: dict) -> str:
        first = str(customer.get("first_name") or "").strip()
        last = str(customer.get("last_name") or "").strip()
        return " ".join(part for part in (first, last) if part).strip()

    @classmethod
    def _safe_customer(cls, customer: dict) -> dict:
        # This is used before caller verification, so do not surface email,
        # phone or any linked/private records.
        return {
            "id": customer.get("id"),
            "name": cls._customer_name(customer) or "Customer",
        }
