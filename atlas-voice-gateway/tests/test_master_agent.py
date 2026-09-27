from app.agents import AGENT_HAL, AGENT_TRON
from app.master_agent import MasterVoiceAgent


def test_explicit_voice_address_wins():
    master = MasterVoiceAgent()
    decision = master.decide(
        "TRON, scan the repository for database errors",
        [AGENT_HAL, AGENT_TRON],
    )
    assert decision.selected_agent == AGENT_TRON
    assert decision.reason == "voice_address"
    assert decision.confidence == 1.0


def test_infrastructure_routes_to_hal():
    master = MasterVoiceAgent()
    decision = master.decide(
        "check the network switch and TrueNAS storage",
        [AGENT_HAL, AGENT_TRON],
    )
    assert decision.selected_agent == AGENT_HAL
    assert decision.intent == "infrastructure"


def test_engineering_routes_to_tron():
    master = MasterVoiceAgent()
    decision = master.decide(
        "scan the GitHub repo, debug the Python API and run tests",
        [AGENT_HAL, AGENT_TRON],
    )
    assert decision.selected_agent == AGENT_TRON
    assert decision.intent == "engineering"


def test_general_followup_stays_with_current_agent():
    master = MasterVoiceAgent()
    decision = master.decide(
        "okay, do the next one",
        [AGENT_HAL, AGENT_TRON],
        current_agent=AGENT_TRON,
    )
    assert decision.selected_agent == AGENT_TRON
    assert decision.reason == "conversation_continuity"
    assert decision.continuation is True


def test_unavailable_intent_agent_fails_over():
    master = MasterVoiceAgent()
    decision = master.decide(
        "debug the TypeScript build",
        [AGENT_HAL],
    )
    assert decision.selected_agent == AGENT_HAL
    assert decision.reason == "intent_failover"
    assert decision.requested_agents == (AGENT_TRON,)


def test_preferred_agent_is_authoritative_when_available():
    master = MasterVoiceAgent()
    decision = master.decide(
        "check the server",
        [AGENT_HAL, AGENT_TRON],
        preferred_agent="atlas-tron",
    )
    assert decision.selected_agent == AGENT_TRON
    assert decision.reason == "preferred_agent"


def test_no_agents_is_rejected():
    master = MasterVoiceAgent()
    try:
        master.decide("hello", [])
    except ValueError as exc:
        assert str(exc) == "no available agents"
    else:
        raise AssertionError("expected ValueError")
