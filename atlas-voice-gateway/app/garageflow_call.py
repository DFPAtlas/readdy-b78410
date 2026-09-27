"""GarageFlow telephone booking conversation state.

The controller is deliberately deterministic. The language model may phrase
questions naturally, but booking progression is controlled by this state
machine so required data cannot be skipped.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Optional


class CallStage(str, Enum):
    GREETING = "greeting"
    IDENTIFY_CUSTOMER = "identify_customer"
    VERIFY_CUSTOMER = "verify_customer"
    IDENTIFY_VEHICLE = "identify_vehicle"
    CAPTURE_SERVICE = "capture_service"
    CAPTURE_DATE = "capture_date"
    CHECK_AVAILABILITY = "check_availability"
    OFFER_SLOTS = "offer_slots"
    SELECT_SLOT = "select_slot"
    CONFIRM_BOOKING = "confirm_booking"
    CREATE_BOOKING = "create_booking"
    COMPLETE = "complete"
    ESCALATE = "escalate"


@dataclass
class OfferedSlot:
    starts_at: str
    ends_at: str


@dataclass
class GarageFlowCallState:
    session_id: str
    stage: CallStage = CallStage.GREETING
    caller_phone: Optional[str] = None
    customer_id: Optional[str] = None
    customer_name: Optional[str] = None
    customer_verified: bool = False
    vehicle_id: Optional[str] = None
    vehicle_registration: Optional[str] = None
    service_type: Optional[str] = None
    service_label: Optional[str] = None
    duration_minutes: Optional[int] = None
    preferred_date: Optional[str] = None
    offered_slots: list[OfferedSlot] = field(default_factory=list)
    selected_slot: Optional[OfferedSlot] = None
    customer_description: str = ""
    booking_id: Optional[str] = None
    escalation_reason: Optional[str] = None

    def ready_for_availability(self) -> bool:
        return bool(
            self.customer_verified
            and self.customer_id
            and self.vehicle_id
            and self.service_type
            and self.duration_minutes
            and self.preferred_date
        )

    def ready_to_book(self) -> bool:
        return bool(self.ready_for_availability() and self.selected_slot)


class GarageFlowCallController:
    """Progresses a GarageFlow phone-booking session safely."""

    def start(self, session_id: str, caller_phone: str | None = None) -> GarageFlowCallState:
        state = GarageFlowCallState(session_id=session_id, caller_phone=caller_phone)
        state.stage = CallStage.IDENTIFY_CUSTOMER
        return state

    def set_customer(
        self,
        state: GarageFlowCallState,
        *,
        customer_id: str,
        customer_name: str,
    ) -> None:
        state.customer_id = customer_id
        state.customer_name = customer_name
        state.customer_verified = False
        state.stage = CallStage.VERIFY_CUSTOMER

    def verify_customer(self, state: GarageFlowCallState, verified: bool) -> None:
        if not verified:
            self.escalate(state, "customer_verification_failed")
            return
        state.customer_verified = True
        state.stage = CallStage.IDENTIFY_VEHICLE

    def set_vehicle(self, state: GarageFlowCallState, *, vehicle_id: str, registration: str) -> None:
        if not state.customer_verified:
            raise ValueError("customer_not_verified")
        state.vehicle_id = vehicle_id
        state.vehicle_registration = registration
        state.stage = CallStage.CAPTURE_SERVICE

    def set_service(
        self,
        state: GarageFlowCallState,
        *,
        service_type: str,
        service_label: str,
        duration_minutes: int,
        customer_description: str = "",
    ) -> None:
        if not state.vehicle_id:
            raise ValueError("vehicle_not_selected")
        if duration_minutes <= 0:
            raise ValueError("invalid_duration")
        state.service_type = service_type
        state.service_label = service_label
        state.duration_minutes = duration_minutes
        state.customer_description = customer_description
        state.stage = CallStage.CAPTURE_DATE

    def set_preferred_date(self, state: GarageFlowCallState, date: str) -> None:
        if not state.service_type:
            raise ValueError("service_not_selected")
        state.preferred_date = date
        state.offered_slots.clear()
        state.selected_slot = None
        state.stage = CallStage.CHECK_AVAILABILITY

    def set_available_slots(self, state: GarageFlowCallState, slots: list[dict]) -> None:
        if not state.ready_for_availability():
            raise ValueError("booking_details_incomplete")
        state.offered_slots = [
            OfferedSlot(starts_at=str(slot["starts_at"]), ends_at=str(slot["ends_at"]))
            for slot in slots
            if slot.get("starts_at") and slot.get("ends_at")
        ]
        if not state.offered_slots:
            state.stage = CallStage.CAPTURE_DATE
            return
        state.stage = CallStage.OFFER_SLOTS

    def select_slot(self, state: GarageFlowCallState, starts_at: str) -> None:
        selected = next((slot for slot in state.offered_slots if slot.starts_at == starts_at), None)
        if selected is None:
            raise ValueError("slot_not_offered")
        state.selected_slot = selected
        state.stage = CallStage.CONFIRM_BOOKING

    def confirm_booking(self, state: GarageFlowCallState, confirmed: bool) -> None:
        if not confirmed:
            state.selected_slot = None
            state.stage = CallStage.CAPTURE_DATE
            return
        if not state.ready_to_book():
            raise ValueError("booking_details_incomplete")
        state.stage = CallStage.CREATE_BOOKING

    def booking_created(self, state: GarageFlowCallState, booking_id: str) -> None:
        if state.stage != CallStage.CREATE_BOOKING:
            raise ValueError("booking_not_expected")
        state.booking_id = booking_id
        state.stage = CallStage.COMPLETE

    def escalate(self, state: GarageFlowCallState, reason: str) -> None:
        state.escalation_reason = reason
        state.stage = CallStage.ESCALATE
