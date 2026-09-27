from app.garageflow_call import GarageFlowCallController
from app.garageflow_connector import GarageFlowConnector
from app.garageflow_workflow import GarageFlowCallWorkflow
from app.sessions import SessionStore
from app.telephony import TelephonyAuth, TelephonyRegistry


def build_registry():
    sessions = SessionStore()
    connector = GarageFlowConnector(base_url="https://example.test", api_key="secret")
    workflow = GarageFlowCallWorkflow(sessions, connector, GarageFlowCallController())
    return TelephonyRegistry(workflow), sessions


def test_call_id_maps_to_one_voice_session():
    registry, sessions = build_registry()
    first = registry.start(call_id="provider-123", provider="generic", caller_phone="+44123")
    second = registry.start(call_id="provider-123", provider="generic", caller_phone="+44123")

    assert first.session_id == second.session_id
    assert first.session_id in sessions.sessions
    assert sessions.sessions[first.session_id].active_workflow == "garageflow_booking"


def test_end_call_clears_workflow_but_retains_call_audit_state():
    registry, sessions = build_registry()
    call = registry.start(call_id="provider-123", provider="generic")
    registry.end("provider-123")

    assert registry.get("provider-123").status == "ended"
    assert sessions.sessions[call.session_id].active_workflow is None


def test_shared_secret_auth_is_fail_closed():
    auth = TelephonyAuth("abc123")
    assert auth.verify("abc123") is True
    assert auth.verify("wrong") is False
    assert TelephonyAuth("").verify("") is False
