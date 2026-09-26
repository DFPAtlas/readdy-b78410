"""In-process wiring tests for TRON RAG inside the shared ``_execute_chat``.

``POST /api/chat`` (text) and ``POST /api/voice`` (voice) both run through
``_execute_chat``; the voice route simply passes the transcribed text as the
message. These tests exercise that shared seam directly, so they prove:

  * a TRON text turn retrieves and is grounded,
  * a TRON voice turn retrieves using the transcript as the query,
  * a HAL turn never retrieves,
  * empty results and API failure keep the turn alive and honest,
  * repository filtering and bounded context behave.

The RAG API is mocked with ``httpx.MockTransport``; no LAN service is required.
"""

from __future__ import annotations

import asyncio
import json
from types import SimpleNamespace

import httpx

from app.agents import AGENT_HAL, AGENT_TRON
from app.main import _execute_chat
from app.models import RoutingMode
from app.rag import (
    STATUS_OK,
    STATUS_UNAVAILABLE,
    RagChunk,
    RagClient,
    RagResult,
    compose_tron_messages,
    extract_repository,
    retrieve_context,
)
from app.sessions import SessionStore

RAG_BASE_URL = "http://192.168.1.105:8100"


class _FakeAgent:
    """Minimal stand-in for ``AgentRuntime`` (records the messages it receives)."""

    def __init__(self, agent_id: str, model: str = "test-model") -> None:
        self.id = agent_id
        self.name = agent_id
        self.model = model
        self.muted = False
        self.active_requests = 0
        self.semaphore = asyncio.Semaphore(1)
        self.received: list[list[dict]] = []
        self.client = SimpleNamespace(chat_stream=self._chat_stream)

    async def _chat_stream(self, model, messages, options=None):
        self.received.append(messages)
        yield "Grounded answer."


class _FakeRegistry:
    def __init__(self, agents) -> None:
        self.agents = {agent.id: agent for agent in agents}

    def get(self, agent_id):
        return self.agents.get(agent_id)

    def available(self):
        return list(self.agents.keys())


class _FakeConnections:
    def __init__(self) -> None:
        self.events: list[dict] = []

    async def broadcast(self, event):
        self.events.append(event)


def _make_state(rag_client):
    hal = _FakeAgent(AGENT_HAL)
    tron = _FakeAgent(AGENT_TRON)
    state = SimpleNamespace(
        settings=SimpleNamespace(max_message_chars=8000, max_concurrent_total=4),
        registry=_FakeRegistry([hal, tron]),
        sessions=SessionStore(),
        connections=_FakeConnections(),
        rag=rag_client,
    )
    return state, hal, tron


def _rag(handler, **kwargs) -> RagClient:
    return RagClient(RAG_BASE_URL, transport=httpx.MockTransport(handler), **kwargs)


def _grounded_handler(captured):
    def handler(request: httpx.Request) -> httpx.Response:
        captured["body"] = json.loads(request.content)
        return httpx.Response(
            200,
            json={
                "results": [
                    {
                        "content": "booking flow source",
                        "repository": "readdy-5650b0",
                        "path": "src/booking/flow.ts",
                        "similarity": 0.88,
                    }
                ]
            },
        )

    return handler


# --------------------------------------------------------------- text + voice


def test_tron_text_turn_is_grounded():
    captured = {}
    state, hal, tron = _make_state(_rag(_grounded_handler(captured)))

    status, body = asyncio.run(
        _execute_chat(state, "s1", "readdy-5650b0 booking workflow", RoutingMode.TRON)
    )

    assert status == 200
    assert captured["body"]["query"] == "readdy-5650b0 booking workflow"
    assert captured["body"]["repository"] == "readdy-5650b0"

    system, user = tron.received[0]
    assert system["role"] == "system"
    assert "readdy-5650b0:src/booking/flow.ts" in system["content"]
    assert user == {"role": "user", "content": "readdy-5650b0 booking workflow"}

    assert hal.received == []
    assert body["selectedAgent"] == AGENT_TRON
    assert body["response"] == "Grounded answer."


def test_tron_voice_turn_uses_transcript_as_query():
    # /api/voice transcribes audio then calls this SAME function with the
    # transcript as the message, so this proves the voice path retrieves too.
    captured = {}
    transcript = "what does the GarageFlow booking workflow do"
    state, hal, tron = _make_state(_rag(_grounded_handler(captured)))

    status, _ = asyncio.run(_execute_chat(state, "s1", transcript, RoutingMode.TRON))

    assert status == 200
    assert captured["body"]["query"] == transcript
    assert "repository" not in captured["body"]  # generic question: no filter
    assert tron.received[0][1]["content"] == transcript


# ------------------------------------------------------------------ HAL bypass


def test_hal_turn_bypasses_retrieval():
    called = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        called["n"] += 1
        return httpx.Response(200, json={"results": []})

    state, hal, tron = _make_state(_rag(handler))

    status, _ = asyncio.run(_execute_chat(state, "s1", "check the loft switch", RoutingMode.HAL))

    assert status == 200
    assert called["n"] == 0
    assert hal.received[0] == [{"role": "user", "content": "check the loft switch"}]
    assert tron.received == []


# --------------------------------------------------------- resilient failures


def test_tron_turn_survives_api_failure():
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.TimeoutException("down", request=request)

    state, hal, tron = _make_state(_rag(handler))

    status, body = asyncio.run(_execute_chat(state, "s1", "q", RoutingMode.TRON))

    assert status == 200
    assert body["response"] == "Grounded answer."
    prompt = tron.received[0][0]["content"]
    assert "UNAVAILABLE" in prompt
    assert "do not" in prompt.lower()


def test_tron_turn_survives_empty_results():
    state, hal, tron = _make_state(_rag(lambda r: httpx.Response(200, json={"results": []})))

    status, body = asyncio.run(_execute_chat(state, "s1", "q", RoutingMode.TRON))

    assert status == 200
    assert body["response"] == "Grounded answer."
    assert "NO relevant matches" in tron.received[0][0]["content"]


def test_tron_retrieval_emits_a_single_activity_event():
    captured = {}
    state, hal, tron = _make_state(_rag(_grounded_handler(captured)))

    asyncio.run(_execute_chat(state, "s1", "readdy-5650b0 booking", RoutingMode.TRON))

    rag_events = [e for e in state.connections.events if e.get("payload", {}).get("type") == "rag"]
    assert len(rag_events) == 1


# --------------------------------------------------------- repository filtering


def test_extract_repository_explicit_forms():
    assert extract_repository("Repository: readdy-5650b0 show the booking flow") == "readdy-5650b0"
    assert extract_repository("repo=readdy-b78410") == "readdy-b78410"


def test_extract_repository_bare_slug():
    assert extract_repository("look at readdy-5650b0 booking workflow") == "readdy-5650b0"


def test_extract_repository_none_for_generic_question():
    assert extract_repository("how does the booking workflow work?") is None
    assert extract_repository("which repository is used") is None


# --------------------------------------------------------------- the RAG seam


def test_retrieve_context_is_tron_only():
    called = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        called["n"] += 1
        return httpx.Response(200, json={"results": []})

    client = _rag(handler)
    assert asyncio.run(retrieve_context(client, AGENT_HAL, "hi")) is None
    assert called["n"] == 0


def test_retrieve_context_none_when_unconfigured():
    client = RagClient("")
    assert asyncio.run(retrieve_context(client, AGENT_TRON, "hi")) is None


# ------------------------------------------------------------ prompt composition


def test_compose_includes_evidence_and_citation_guidance():
    result = RagResult(status=STATUS_OK, chunks=[RagChunk("print(1)", "readdy-5650b0", "a/b.py", 0.9)])
    messages = compose_tron_messages("q", result)

    assert messages[0]["role"] == "system"
    assert messages[1] == {"role": "user", "content": "q"}
    prompt = messages[0]["content"]
    assert "readdy-5650b0:a/b.py" in prompt
    assert "untrusted" in prompt.lower()
    assert "cite the repository" in prompt.lower()


def test_compose_is_honest_when_unavailable():
    result = RagResult(status=STATUS_UNAVAILABLE, error="timeout")
    prompt = compose_tron_messages("q", result)[0]["content"]

    assert "UNAVAILABLE" in prompt
    assert "invent" in prompt.lower()