"""Focused tests for TRON RAG repository-name resolution (``GET /repos``).

A speaker should not have to pronounce a Readdy repository slug: a project name
such as "GarageFlow" - or the STT spacing variant "Garage Flow" - must resolve to
the indexed repository slug the catalogue advertises. The catalogue is fetched
from the Atlas RAG API and cached briefly. Every test mocks both ``GET /repos``
and ``POST /search`` with ``httpx.MockTransport``, so no LAN service is required.
"""

from __future__ import annotations

import asyncio
import json

import httpx

from app.rag import (
    STATUS_OK,
    RagClient,
    build_repo_catalogue,
)

BASE_URL = "http://192.168.1.105:8100"

CATALOGUE = {
    "repos": [
        {
            "repository": "readdy-5650b0",
            "metadata": {
                "website_name": "GarageFlow",
                "canonical_project_name": "GarageFlow",
                "readdy_project_name": "readdy-5650b0",
            },
        },
        {
            "repository": "readdy-b78410",
            "metadata": {
                "website_name": "Atlas Console",
                "canonical_project_name": "Atlas Voice Console",
                "readdy_project_name": "readdy-b78410",
            },
        },
    ]
}

RESULTS = {
    "results": [
        {
            "content": "GarageFlow workshop booking: create, confirm, then invoice.",
            "repository": "readdy-5650b0",
            "path": "src/data/helpArticles.ts",
            "similarity": 0.83,
        }
    ]
}


def _run(coro):
    return asyncio.run(coro)


def _client(handler, **kwargs) -> RagClient:
    return RagClient(BASE_URL, transport=httpx.MockTransport(handler), **kwargs)


def _catalogue_and_search(*, catalogue=CATALOGUE, catalogue_status=200, **kwargs):
    """A mock transport serving GET /repos and POST /search; records the calls."""

    calls = {"repos": 0, "search": []}

    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "GET":
            calls["repos"] += 1
            return httpx.Response(catalogue_status, json=catalogue)
        calls["search"].append(json.loads(request.content))
        return httpx.Response(200, json=RESULTS)

    return _client(handler, **kwargs), calls


# ------------------------------------------------------------- name resolution


def test_unique_project_name_resolves_to_slug():
    client, calls = _catalogue_and_search()

    resolution = _run(client.resolve_repository("Tell me how GarageFlow makes a booking"))

    assert resolution.repository == "readdy-5650b0"
    assert resolution.reason == "name"
    assert calls["repos"] == 1


def test_stt_spacing_variant_resolves_to_same_slug():
    client, _ = _catalogue_and_search()

    resolution = _run(client.resolve_repository("Tell me how Garage Flow makes a booking"))

    assert resolution.repository == "readdy-5650b0"
    assert resolution.reason == "name"


def test_resolved_name_is_sent_as_the_repository_filter():
    client, calls = _catalogue_and_search()

    resolution = _run(client.resolve_repository("Tell me how Garage Flow makes a booking"))
    _run(client.search_multi(["how Garage Flow makes a booking"], repository=resolution.repository))

    assert calls["search"][0]["repository"] == "readdy-5650b0"


def test_other_project_name_resolves_to_its_own_slug():
    client, _ = _catalogue_and_search()

    resolution = _run(client.resolve_repository("how does the Atlas Console route requests"))

    assert resolution.repository == "readdy-b78410"


# --------------------------------------------------------------- explicit wins


def test_explicit_slug_wins_and_skips_the_catalogue():
    client, calls = _catalogue_and_search()

    resolution = _run(client.resolve_repository("In repository readdy-b78410, explain the router"))

    assert resolution.repository == "readdy-b78410"
    assert resolution.reason == "explicit"
    # Explicit references never hit GET /repos.
    assert calls["repos"] == 0


def test_explicit_slug_beats_a_conflicting_project_name():
    # The message names GarageFlow but explicitly targets another repository:
    # the explicit reference must win.
    client, _ = _catalogue_and_search()

    resolution = _run(
        client.resolve_repository("In repository readdy-b78410, how does GarageFlow book")
    )

    assert resolution.repository == "readdy-b78410"
    assert resolution.reason == "explicit"


# ----------------------------------------------------- ambiguous / unknown name


def test_ambiguous_project_name_is_not_guessed():
    catalogue = {
        "repos": [
            {"repository": "readdy-aaaaaa", "metadata": {"website_name": "GarageFlow"}},
            {"repository": "readdy-bbbbbb", "metadata": {"canonical_project_name": "Garage Flow"}},
        ]
    }
    client, calls = _catalogue_and_search(catalogue=catalogue)

    resolution = _run(client.resolve_repository("how does GarageFlow handle a booking"))

    assert resolution.repository is None
    assert resolution.reason == "ambiguous"
    # The follow-up search stays unfiltered: no repository is claimed.
    _run(client.search_multi(["how does GarageFlow handle a booking"], repository=resolution.repository))
    assert "repository" not in calls["search"][0]


def test_unknown_project_name_searches_unfiltered():
    client, calls = _catalogue_and_search()

    resolution = _run(client.resolve_repository("explain the mating habits of penguins"))

    assert resolution.repository is None
    assert resolution.reason == "none"
    _run(client.search_multi(["explain the mating habits of penguins"], repository=resolution.repository))
    assert "repository" not in calls["search"][0]


# ---------------------------------------------------------- resilient catalogue


def test_missing_catalogue_degrades_to_unfiltered_and_keeps_working():
    client, calls = _catalogue_and_search(catalogue_status=503)

    resolution = _run(client.resolve_repository("how GarageFlow makes a booking"))

    assert resolution.repository is None
    assert resolution.reason == "catalogue_unavailable"

    result = _run(
        client.search_multi(["how GarageFlow makes a booking"], repository=resolution.repository)
    )
    assert result.status == STATUS_OK
    assert "repository" not in calls["search"][0]


def test_catalogue_network_failure_is_survived():
    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "GET":
            raise httpx.ConnectError("refused", request=request)
        return httpx.Response(200, json=RESULTS)

    client = _client(handler)
    resolution = _run(client.resolve_repository("how GarageFlow makes a booking"))

    assert resolution.repository is None
    assert resolution.reason == "catalogue_unavailable"


# ---------------------------------------------------------------- cache behaviour


def test_catalogue_is_cached_between_turns():
    client, calls = _catalogue_and_search()

    _run(client.resolve_repository("how GarageFlow makes a booking"))
    _run(client.resolve_repository("how GarageFlow makes a booking again"))

    # The brief cache means GET /repos is fetched once, not per turn.
    assert calls["repos"] == 1


def test_catalogue_refetches_after_the_cache_expires():
    client, calls = _catalogue_and_search(repos_cache_ms=0)

    _run(client.resolve_repository("how GarageFlow makes a booking"))
    _run(client.resolve_repository("how GarageFlow makes a booking again"))

    assert calls["repos"] == 2


# ------------------------------------------------------------- catalogue parsing


def test_catalogue_parses_alternate_envelope_and_keys():
    catalogue = build_repo_catalogue({"data": [{"slug": "readdy-5650b0", "title": "GarageFlow"}]})

    assert catalogue.resolve("GarageFlow booking")[0] == "readdy-5650b0"
    assert catalogue.resolve("something else entirely")[0] is None


def test_catalogue_ignores_entries_without_a_repository():
    catalogue = build_repo_catalogue({"repos": [{"website_name": "NoSlug"}, {"nope": True}]})

    assert catalogue.resolve("NoSlug booking")[0] is None