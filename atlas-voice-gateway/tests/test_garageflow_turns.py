import pytest

from app.garageflow_call import CallStage
from app.garageflow_turns import GarageFlowTurnExecutor


class FakeConnector:
    async def find_vehicles(self, search):
        return [{"id": "veh-1", "customer_id": "cust-1", "registration": "AB12CDE"}]

    async def availability(self, *, date, duration_minutes, interval_minutes=30):
        return [{"starts_at": "2026-09-29T08:00:00+00:00", "ends_at": "2026-09-29T11:00:00+00:00"}]

    async def create_booking_request(self, **kwargs):
        return {"id": "booking-123", "status": "provisional"}


class FakeController:
    pass


@pytest.mark.asyncio
async def test_turn_executor_happy_path_without_freeform_model():
    from app.garageflow_call import GarageFlowCallController
    from app.garageflow_workflow import GarageFlowCallWorkflow
    from app.sessions import SessionStore

    sessions = SessionStore()
    connector = FakeConnector()
    workflow = GarageFlowCallWorkflow(sessions, connector, GarageFlowCallController())
    state = workflow.start("s1", "+441234")
    workflow.controller.set_customer(state, customer_id="cust-1", customer_name="Alex Smith")
    workflow.controller.verify_customer(state, True)

    executor = GarageFlowTurnExecutor(workflow)

    out = await executor.handle("s1", "AB12 CDE")
    assert out["stage"] == CallStage.CAPTURE_SERVICE.value

    out = await executor.handle("s1", "full service")
    assert out["stage"] == CallStage.CAPTURE_DATE.value

    out = await executor.handle("s1", "next Tuesday")
    assert out["stage"] == CallStage.OFFER_SLOTS.value

    out = await executor.handle("s1", "the first one")
    assert out["stage"] == CallStage.CONFIRM_BOOKING.value

    out = await executor.handle("s1", "yes")
    assert out["stage"] == CallStage.COMPLETE.value
    assert state.booking_id == "booking-123"
