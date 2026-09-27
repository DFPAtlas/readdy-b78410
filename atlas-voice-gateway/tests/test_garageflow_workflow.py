import httpx
import pytest

from app.garageflow_call import CallStage
from app.garageflow_connector import GarageFlowConnector
from app.garageflow_workflow import GarageFlowCallWorkflow
from app.sessions import SessionStore


@pytest.mark.asyncio
async def test_workflow_attaches_to_existing_voice_session_and_matches_caller():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path.endswith("/api/v1/customers")
        return httpx.Response(200, json={
            "data": [{"id": "cust-1", "first_name": "Alex", "last_name": "Smith", "phone": "+441234"}]
        })

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        connector = GarageFlowConnector(
            base_url="https://garageflow.example",
            api_key="secret",
            client=client,
        )
        sessions = SessionStore()
        workflow = GarageFlowCallWorkflow(sessions, connector)

        state = workflow.start("voice-session-1", "+441234")
        assert sessions.sessions["voice-session-1"].active_workflow == "garageflow_booking"
        assert state.stage == CallStage.IDENTIFY_CUSTOMER

        result = await workflow.identify_by_caller_phone("voice-session-1")
        assert result["status"] == "matched"
        assert state.stage == CallStage.VERIFY_CUSTOMER
        assert result["customer"] == {"id": "cust-1", "name": "Alex Smith"}


def test_public_state_omits_caller_phone():
    sessions = SessionStore()
    connector = GarageFlowConnector(base_url="https://garageflow.example", api_key="secret")
    workflow = GarageFlowCallWorkflow(sessions, connector)
    workflow.start("voice-session-1", "+441234")

    public = workflow.public_state("voice-session-1")
    assert public is not None
    assert "caller_phone" not in public
    assert public["stage"] == "identify_customer"


def test_end_workflow_keeps_session_but_clears_call_state():
    sessions = SessionStore()
    connector = GarageFlowConnector(base_url="https://garageflow.example", api_key="secret")
    workflow = GarageFlowCallWorkflow(sessions, connector)
    workflow.start("voice-session-1", "+441234")
    workflow.end("voice-session-1")

    assert "voice-session-1" in sessions.sessions
    assert sessions.sessions["voice-session-1"].active_workflow is None
    assert workflow.get("voice-session-1") is None
