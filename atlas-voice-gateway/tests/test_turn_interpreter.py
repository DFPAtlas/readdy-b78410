from datetime import date

from app.garageflow_call import GarageFlowCallController, OfferedSlot
from app.turn_interpreter import GarageFlowTurnInterpreter, TurnAction


def test_service_extraction_is_stage_limited():
    controller = GarageFlowCallController()
    state = controller.start("s1")
    interpreter = GarageFlowTurnInterpreter()

    turn = interpreter.interpret(state, "I need a full service")
    assert turn.action == TurnAction.NONE

    state.customer_verified = True
    state.vehicle_id = "v1"
    state.stage = state.stage.CAPTURE_SERVICE
    turn = interpreter.interpret(state, "I need a full service")
    assert turn.action == TurnAction.SERVICE
    assert turn.value == "full_service"


def test_next_tuesday_resolves_from_known_today():
    controller = GarageFlowCallController()
    state = controller.start("s1")
    state.customer_verified = True
    state.vehicle_id = "v1"
    state.service_type = "full_service"
    state.duration_minutes = 180
    state.stage = state.stage.CAPTURE_DATE

    turn = GarageFlowTurnInterpreter().interpret(
        state,
        "next Tuesday",
        today=date(2026, 9, 27),
    )
    assert turn.action == TurnAction.DATE
    assert turn.value == "2026-09-29"


def test_only_offered_ordinal_slot_is_selected():
    controller = GarageFlowCallController()
    state = controller.start("s1")
    state.stage = state.stage.OFFER_SLOTS
    state.offered_slots = [
        OfferedSlot("2026-09-29T08:00:00+00:00", "2026-09-29T09:00:00+00:00"),
        OfferedSlot("2026-09-29T10:00:00+00:00", "2026-09-29T11:00:00+00:00"),
    ]

    turn = GarageFlowTurnInterpreter().interpret(state, "the second one")
    assert turn.action == TurnAction.SLOT
    assert turn.value == "2026-09-29T10:00:00+00:00"


def test_human_request_overrides_current_stage():
    controller = GarageFlowCallController()
    state = controller.start("s1")
    turn = GarageFlowTurnInterpreter().interpret(state, "Can I speak to a person please")
    assert turn.action == TurnAction.HUMAN
