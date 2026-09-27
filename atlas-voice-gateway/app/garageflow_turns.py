"""Apply interpreted GarageFlow caller turns to the deterministic workflow."""

from __future__ import annotations

from .garageflow_call import CallStage
from .garageflow_workflow import GarageFlowCallWorkflow
from .turn_interpreter import GarageFlowTurnInterpreter, TurnAction


class GarageFlowTurnExecutor:
    def __init__(
        self,
        workflow: GarageFlowCallWorkflow,
        interpreter: GarageFlowTurnInterpreter | None = None,
    ) -> None:
        self.workflow = workflow
        self.interpreter = interpreter or GarageFlowTurnInterpreter()

    async def handle(self, session_id: str, transcript: str) -> dict:
        state = self.workflow.get(session_id)
        if state is None:
            raise ValueError("garageflow_call_not_started")

        turn = self.interpreter.interpret(state, transcript)

        if turn.action == TurnAction.HUMAN:
            self.workflow.controller.escalate(state, "caller_requested_human")
            return self._result(state, turn, "I’ll pass this to a member of staff.")

        if turn.action == TurnAction.CANCEL:
            self.workflow.controller.escalate(state, "caller_cancelled")
            return self._result(state, turn, "Okay. I won’t make a booking.")

        if turn.action == TurnAction.VERIFY_YES:
            self.workflow.controller.verify_customer(state, True)
            return self._result(state, turn, "Thank you. Which vehicle is this for?")

        if turn.action == TurnAction.VERIFY_NO:
            self.workflow.controller.verify_customer(state, False)
            return self._result(state, turn, "I’ll pass this to a member of staff to verify your details.")

        if turn.action == TurnAction.VEHICLE_REGISTRATION:
            vehicles = await self.workflow.connector.find_vehicles(turn.value or "")
            if not vehicles:
                return self._result(state, turn, "I couldn’t find that registration. Please repeat it.")
            # Only accept a vehicle belonging to the verified customer.
            matches = [v for v in vehicles if str(v.get("customer_id") or "") == str(state.customer_id or "")]
            if len(matches) != 1:
                return self._result(state, turn, "I need a member of staff to confirm that vehicle.")
            vehicle = matches[0]
            self.workflow.controller.set_vehicle(
                state,
                vehicle_id=str(vehicle["id"]),
                registration=str(vehicle.get("registration") or turn.value or ""),
            )
            return self._result(state, turn, "What would you like the vehicle booked in for?")

        if turn.action == TurnAction.SERVICE:
            service_type = turn.value or "other"
            duration = self._default_duration(service_type)
            self.workflow.controller.set_service(
                state,
                service_type=service_type,
                service_label=self._service_label(service_type),
                duration_minutes=duration,
                customer_description=transcript,
            )
            return self._result(state, turn, "What date would you prefer?")

        if turn.action == TurnAction.DATE:
            self.workflow.controller.set_preferred_date(state, turn.value or "")
            slots = await self.workflow.availability(session_id)
            if not slots:
                return self._result(state, turn, "I don’t have an available slot on that date. Which other date would suit you?")
            options = self._spoken_slots(slots[:3])
            return self._result(state, turn, f"I have {options}. Which would you prefer?")

        if turn.action == TurnAction.SLOT:
            self.workflow.controller.select_slot(state, turn.value or "")
            slot = state.selected_slot
            return self._result(
                state,
                turn,
                f"To confirm: {state.vehicle_registration}, {state.service_label}, at {slot.starts_at if slot else 'that time'}. Shall I book that?",
            )

        if turn.action == TurnAction.CONFIRM_YES:
            self.workflow.controller.confirm_booking(state, True)
            booking = await self.workflow.create_booking(session_id)
            return self._result(state, turn, f"That’s booked provisionally. Your booking reference is {booking.get('id')}.")

        if turn.action == TurnAction.CONFIRM_NO:
            self.workflow.controller.confirm_booking(state, False)
            return self._result(state, turn, "No problem. What date would you prefer instead?")

        return self._result(state, turn, self._prompt_for_stage(state.stage))

    @staticmethod
    def _default_duration(service_type: str) -> int:
        # V1 defaults. These will move to GarageFlow service configuration next.
        return {
            "mot": 45,
            "interim_service": 90,
            "full_service": 180,
            "major_service": 240,
            "diagnostic": 60,
            "tyres": 60,
            "air_con": 90,
            "electrical": 120,
            "inspection": 60,
            "repair": 120,
        }.get(service_type, 60)

    @staticmethod
    def _service_label(service_type: str) -> str:
        return service_type.replace("_", " ").title()

    @staticmethod
    def _spoken_slots(slots: list[dict]) -> str:
        return ", ".join(str(slot.get("starts_at")) for slot in slots)

    @staticmethod
    def _prompt_for_stage(stage: CallStage) -> str:
        prompts = {
            CallStage.IDENTIFY_CUSTOMER: "Can I take your name or telephone number?",
            CallStage.VERIFY_CUSTOMER: "Can you confirm that’s you?",
            CallStage.IDENTIFY_VEHICLE: "What is the vehicle registration?",
            CallStage.CAPTURE_SERVICE: "What would you like the vehicle booked in for?",
            CallStage.CAPTURE_DATE: "What date would you prefer?",
            CallStage.OFFER_SLOTS: "Which of those times would you prefer?",
            CallStage.CONFIRM_BOOKING: "Shall I book that appointment?",
        }
        return prompts.get(stage, "How can I help?")

    @staticmethod
    def _result(state, turn, reply: str) -> dict:
        return {
            "stage": state.stage.value,
            "action": turn.action.value,
            "value": turn.value,
            "confidence": turn.confidence,
            "reply": reply,
        }
