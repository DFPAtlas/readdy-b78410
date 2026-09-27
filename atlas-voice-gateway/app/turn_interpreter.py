"""Natural-language turn interpreter for GarageFlow telephone booking.

The interpreter is intentionally constrained: it extracts stage-appropriate
fields and emits typed actions. It never writes to GarageFlow directly.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from enum import Enum
from typing import Optional

from .garageflow_call import CallStage, GarageFlowCallState


class TurnAction(str, Enum):
    NONE = "none"
    VERIFY_YES = "verify_yes"
    VERIFY_NO = "verify_no"
    VEHICLE_REGISTRATION = "vehicle_registration"
    SERVICE = "service"
    DATE = "date"
    SLOT = "slot"
    CONFIRM_YES = "confirm_yes"
    CONFIRM_NO = "confirm_no"
    HUMAN = "human"
    CANCEL = "cancel"


@dataclass(frozen=True)
class InterpretedTurn:
    action: TurnAction
    value: Optional[str] = None
    confidence: float = 0.0


YES = {"yes", "yeah", "yep", "correct", "that's right", "that is right", "please do", "go ahead", "confirm"}
NO = {"no", "nope", "wrong", "that's not right", "that is not right", "don't", "do not"}
HUMAN = {"human", "person", "someone", "member of staff", "receptionist", "operator", "speak to staff"}
CANCEL = {"cancel", "stop", "forget it", "never mind", "nevermind"}

SERVICE_PATTERNS: tuple[tuple[str, str], ...] = (
    ("full service", "full_service"),
    ("major service", "major_service"),
    ("interim service", "interim_service"),
    ("mot", "mot"),
    ("diagnostic", "diagnostic"),
    ("diagnostics", "diagnostic"),
    ("tyre", "tyres"),
    ("tyres", "tyres"),
    ("air con", "air_con"),
    ("air conditioning", "air_con"),
    ("electrical", "electrical"),
    ("inspection", "inspection"),
    ("repair", "repair"),
)

WEEKDAYS = {
    "monday": 0,
    "tuesday": 1,
    "wednesday": 2,
    "thursday": 3,
    "friday": 4,
    "saturday": 5,
    "sunday": 6,
}


class GarageFlowTurnInterpreter:
    def interpret(
        self,
        state: GarageFlowCallState,
        transcript: str,
        *,
        today: date | None = None,
    ) -> InterpretedTurn:
        text = self._normalise(transcript)
        if not text:
            return InterpretedTurn(TurnAction.NONE, confidence=0.0)

        if self._contains_any(text, HUMAN):
            return InterpretedTurn(TurnAction.HUMAN, confidence=1.0)
        if self._contains_any(text, CANCEL):
            return InterpretedTurn(TurnAction.CANCEL, confidence=1.0)

        if state.stage == CallStage.VERIFY_CUSTOMER:
            yn = self._yes_no(text)
            if yn is not None:
                return InterpretedTurn(
                    TurnAction.VERIFY_YES if yn else TurnAction.VERIFY_NO,
                    confidence=0.98,
                )

        if state.stage == CallStage.IDENTIFY_VEHICLE:
            reg = self._registration(text)
            if reg:
                return InterpretedTurn(TurnAction.VEHICLE_REGISTRATION, reg, 0.9)

        if state.stage == CallStage.CAPTURE_SERVICE:
            service = self._service(text)
            if service:
                return InterpretedTurn(TurnAction.SERVICE, service, 0.92)

        if state.stage == CallStage.CAPTURE_DATE:
            resolved = self._date(text, today=today or date.today())
            if resolved:
                return InterpretedTurn(TurnAction.DATE, resolved.isoformat(), 0.9)

        if state.stage in (CallStage.OFFER_SLOTS, CallStage.SELECT_SLOT):
            slot = self._slot_choice(text, state)
            if slot:
                return InterpretedTurn(TurnAction.SLOT, slot, 0.95)

        if state.stage == CallStage.CONFIRM_BOOKING:
            yn = self._yes_no(text)
            if yn is not None:
                return InterpretedTurn(
                    TurnAction.CONFIRM_YES if yn else TurnAction.CONFIRM_NO,
                    confidence=0.98,
                )

        return InterpretedTurn(TurnAction.NONE, confidence=0.0)

    @staticmethod
    def _normalise(text: str) -> str:
        return " ".join((text or "").lower().strip().split())

    @staticmethod
    def _contains_any(text: str, phrases: set[str]) -> bool:
        return any(p in text for p in phrases)

    @staticmethod
    def _yes_no(text: str) -> Optional[bool]:
        if any(p == text or p in text for p in YES):
            return True
        if any(p == text or p in text for p in NO):
            return False
        return None

    @staticmethod
    def _registration(text: str) -> Optional[str]:
        # UK-style VRM capture, tolerant of spaces/hyphens from STT.
        compact = re.sub(r"[^a-z0-9]", "", text.upper())
        match = re.search(r"[A-Z]{2}[0-9]{2}[A-Z]{3}", compact)
        return match.group(0) if match else None

    @staticmethod
    def _service(text: str) -> Optional[str]:
        for phrase, service in SERVICE_PATTERNS:
            if phrase in text:
                return service
        return None

    @staticmethod
    def _date(text: str, *, today: date) -> Optional[date]:
        if "today" in text:
            return today
        if "tomorrow" in text:
            return today + timedelta(days=1)

        for name, weekday in WEEKDAYS.items():
            if name not in text:
                continue
            delta = (weekday - today.weekday()) % 7
            if "next " + name in text and delta == 0:
                delta = 7
            elif "next " + name in text:
                delta = delta or 7
            return today + timedelta(days=delta)

        # ISO-like or UK numeric date.
        for pattern, day_first in (
            (r"\b(\d{4})-(\d{2})-(\d{2})\b", False),
            (r"\b(\d{1,2})/(\d{1,2})/(\d{4})\b", True),
        ):
            match = re.search(pattern, text)
            if match:
                try:
                    if day_first:
                        d, m, y = map(int, match.groups())
                    else:
                        y, m, d = map(int, match.groups())
                    return date(y, m, d)
                except ValueError:
                    return None
        return None

    @staticmethod
    def _slot_choice(text: str, state: GarageFlowCallState) -> Optional[str]:
        if not state.offered_slots:
            return None

        # Ordinal selection: first/second/third.
        ordinals = {
            "first": 0, "1st": 0, "one": 0,
            "second": 1, "2nd": 1, "two": 1,
            "third": 2, "3rd": 2, "three": 2,
        }
        for token, idx in ordinals.items():
            if token in text and idx < len(state.offered_slots):
                return state.offered_slots[idx].starts_at

        # Match a spoken HH:MM/hour against offered slots in local display form.
        time_match = re.search(r"\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b", text)
        if not time_match:
            return None
        hour = int(time_match.group(1))
        minute = int(time_match.group(2) or 0)
        meridiem = time_match.group(3)
        if meridiem == "pm" and hour < 12:
            hour += 12
        if meridiem == "am" and hour == 12:
            hour = 0

        for slot in state.offered_slots:
            try:
                dt = datetime.fromisoformat(slot.starts_at.replace("Z", "+00:00"))
            except ValueError:
                continue
            if dt.hour == hour and dt.minute == minute:
                return slot.starts_at
        return None
