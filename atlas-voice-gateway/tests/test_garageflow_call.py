from app.garageflow_call import CallStage, GarageFlowCallController


def build_ready_state():
    controller = GarageFlowCallController()
    state = controller.start("call-1", "+441234567890")
    controller.set_customer(state, customer_id="cust-1", customer_name="Alex Smith")
    controller.verify_customer(state, True)
    controller.set_vehicle(state, vehicle_id="veh-1", registration="AB12CDE")
    controller.set_service(
        state,
        service_type="full_service",
        service_label="Full Service",
        duration_minutes=180,
    )
    controller.set_preferred_date(state, "2026-09-29")
    return controller, state


def test_happy_path_to_create_booking():
    controller, state = build_ready_state()
    controller.set_available_slots(state, [
        {"starts_at": "2026-09-29T08:00:00Z", "ends_at": "2026-09-29T11:00:00Z"},
        {"starts_at": "2026-09-29T12:00:00Z", "ends_at": "2026-09-29T15:00:00Z"},
    ])
    assert state.stage == CallStage.OFFER_SLOTS

    controller.select_slot(state, "2026-09-29T08:00:00Z")
    assert state.stage == CallStage.CONFIRM_BOOKING

    controller.confirm_booking(state, True)
    assert state.stage == CallStage.CREATE_BOOKING
    assert state.ready_to_book() is True

    controller.booking_created(state, "booking-1")
    assert state.stage == CallStage.COMPLETE
    assert state.booking_id == "booking-1"


def test_unoffered_slot_cannot_be_selected():
    controller, state = build_ready_state()
    controller.set_available_slots(state, [
        {"starts_at": "2026-09-29T08:00:00Z", "ends_at": "2026-09-29T11:00:00Z"},
    ])

    try:
        controller.select_slot(state, "2026-09-29T09:00:00Z")
    except ValueError as exc:
        assert str(exc) == "slot_not_offered"
    else:
        raise AssertionError("expected slot_not_offered")


def test_failed_customer_verification_escalates():
    controller = GarageFlowCallController()
    state = controller.start("call-1")
    controller.set_customer(state, customer_id="cust-1", customer_name="Alex Smith")
    controller.verify_customer(state, False)

    assert state.stage == CallStage.ESCALATE
    assert state.escalation_reason == "customer_verification_failed"


def test_empty_availability_returns_to_date_capture():
    controller, state = build_ready_state()
    controller.set_available_slots(state, [])

    assert state.stage == CallStage.CAPTURE_DATE
    assert state.offered_slots == []


def test_declined_confirmation_returns_to_date_capture():
    controller, state = build_ready_state()
    controller.set_available_slots(state, [
        {"starts_at": "2026-09-29T08:00:00Z", "ends_at": "2026-09-29T11:00:00Z"},
    ])
    controller.select_slot(state, "2026-09-29T08:00:00Z")
    controller.confirm_booking(state, False)

    assert state.stage == CallStage.CAPTURE_DATE
    assert state.selected_slot is None
