"""Focused tests for the TRON RAG client (Atlas RAG API ``/search``).

The LAN service is NEVER required: every test injects an ``httpx.MockTransport``
so the client's real request/parse/failure logic runs without a network.
"""

from __future__ import annotations

import asyncio
import json

import httpx
import pytest

from app.rag import (
    STATUS_DISABLED,
    STATUS_EMPTY,
    STATUS_OK,
    STATUS_UNAVAILABLE,
    RagClient,
)

BASE_URL = "http://192.168.1.105:8100"


def _make_client(handler, **kwargs) -> RagClient:
    return RagClient(BASE_URL, transport=httpx.MockTransport(handler), **kwargs)


def _run(coro):
    return asyncio.run(coro)


def test_search_parses_results_and_shapes_query():
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        captured["body"] = json.loads(request.content)
        return httpx.Response(
            200,
            json={
                "results": [
                    {
                        "content": "GarageFlow booking workflow: create -> confirm -> invoice",
                        "repository": "readdy-5650b0",
                        "path": "src/booking/flow.ts",
                        "similarity": 0.82,
                        "evidence": {"lines": "10-40"},
                        "metadata": {"language": "typescript"},
                    }
                ]
            },
        )

    client = _make_client(handler)
    result = _run(client.search("GarageFlow booking workflow", repository="readdy-5650b0"))

    assert result.status == STATUS_OK
    assert result.has_evidence is True
    assert captured["url"] == f"{BASE_URL}/search"
    assert captured["body"]["query"] == "GarageFlow booking workflow"
    assert captured["body"]["repository"] == "readdy-5650b0"
    assert 3 <= captured["body"]["limit"] <= 5
    assert result.chunks[0].repository == "readdy-5650b0"
    assert result.chunks[0].path == "src/booking/flow.ts"
    assert result.chunks[0].similarity == pytest.approx(0.82)


def test_repository_is_not_sent_unless_explicit():
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["body"] = json.loads(request.content)
        return httpx.Response(200, json={"results": []})

    client = _make_client(handler)
    _run(client.search("how does the booking workflow work?"))

    assert "repository" not in captured["body"]


def test_empty_results_report_empty():
    client = _make_client(lambda r: httpx.Response(200, json={"results": []}))
    result = _run(client.search("something unrelated"))

    assert result.status == STATUS_EMPTY
    assert result.has_evidence is False


def test_http_failure_degrades_to_unavailable():
    client = _make_client(lambda r: httpx.Response(503, text="boom"))
    result = _run(client.search("x"))

    assert result.status == STATUS_UNAVAILABLE
    assert result.error == "http_503"


def test_timeout_degrades_to_unavailable():
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.TimeoutException("timed out", request=request)

    client = _make_client(handler)
    result = _run(client.search("x"))

    assert result.status == STATUS_UNAVAILABLE
    assert result.error == "timeout"


def test_unreachable_degrades_to_unavailable():
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("connection refused", request=request)

    client = _make_client(handler)
    result = _run(client.search("x"))

    assert result.status == STATUS_UNAVAILABLE
    assert result.error == "unreachable"


def test_malformed_body_degrades_to_unavailable():
    client = _make_client(lambda r: httpx.Response(200, text="not json"))
    result = _run(client.search("x"))

    assert result.status == STATUS_UNAVAILABLE
    assert result.error == "invalid_body"


def test_bounded_context_limits_each_excerpt_and_the_total():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "results": [
                    {"content": "A" * 5000, "repository": "r", "path": "p", "similarity": 0.9}
                    for _ in range(20)
                ]
            },
        )

    client = _make_client(handler, max_excerpt_chars=100, max_total_chars=250)
    result = _run(client.search("x"))

    assert result.status == STATUS_OK
    assert all(len(chunk.content) <= 100 for chunk in result.chunks)
    assert sum(len(chunk.content) for chunk in result.chunks) <= 250
    # 100 + 100 + 50 then the total cap is reached.
    assert len(result.chunks) == 3


def test_disabled_when_url_missing_never_calls_network():
    called = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        called["n"] += 1
        return httpx.Response(200, json={"results": []})

    client = RagClient("", transport=httpx.MockTransport(handler))
    result = _run(client.search("x"))

    assert result.status == STATUS_DISABLED
    assert called["n"] == 0


def test_disabled_when_flag_off_never_calls_network():
    called = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        called["n"] += 1
        return httpx.Response(200, json={"results": []})

    client = RagClient(BASE_URL, enabled=False, transport=httpx.MockTransport(handler))
    result = _run(client.search("x"))

    assert result.status == STATUS_DISABLED
    assert called["n"] == 0