"""Focused unit tests for TRON RAG query construction and chunk merging.

These cover the retrieval-relevance logic in ``app/rag.py`` without any network:
query cleaning, complementary search queries, repository filtering, de-duplication
and source-preferring re-ranking. No LAN service is required.
"""

from __future__ import annotations

from app.rag import (
    RagChunk,
    _merge_chunks,
    build_search_queries,
    clean_query,
    extract_repository,
)

BOOKING_MESSAGE = (
    "In repository readdy-5650b0, how does GarageFlow handle workshop bookings? "
    "Cite the source file"
)


# --------------------------------------------------------------- clean_query


def test_clean_query_strips_boilerplate_but_keeps_subject():
    cleaned = clean_query(BOOKING_MESSAGE)

    assert cleaned == "how does GarageFlow handle workshop bookings?"
    assert "readdy-5650b0" not in cleaned
    assert "cite" not in cleaned.lower()
    assert "repository" not in cleaned.lower()


def test_clean_query_preserves_file_names_and_technical_terms():
    cleaned = clean_query("please explain how WorkshopClosing.tsx handles the booking flow")

    assert "WorkshopClosing.tsx" in cleaned
    assert "booking" in cleaned
    assert cleaned.lower().startswith("explain")


def test_clean_query_removes_only_filler():
    assert clean_query("please") == ""
    assert clean_query("   ") == ""


# --------------------------------------------------------- build_search_queries


def test_build_search_queries_adds_one_complementary_query():
    queries = build_search_queries(BOOKING_MESSAGE)

    assert queries[0] == "how does GarageFlow handle workshop bookings?"
    assert len(queries) == 2
    assert "GarageFlow" in queries[1]
    assert "readdy-5650b0" not in " ".join(queries)
    assert "cite" not in " ".join(queries).lower()


def test_build_search_queries_single_when_no_boilerplate():
    queries = build_search_queries("GarageFlow booking workflow")

    assert queries == ["GarageFlow booking workflow"]


def test_build_search_queries_empty_message():
    assert build_search_queries("") == []


# ------------------------------------------------------------ repository filter


def test_booking_message_repository_is_explicit_only():
    assert extract_repository(BOOKING_MESSAGE) == "readdy-5650b0"
    # The generic question never filters a repository.
    assert extract_repository("how does GarageFlow handle workshop bookings?") is None


# ------------------------------------------------------------------ merging


def test_merge_deduplicates_identical_chunks_keeping_highest_score():
    duplicate_a = RagChunk("same body", "readdy-5650b0", "src/a.ts", similarity=0.5)
    duplicate_b = RagChunk("same body", "readdy-5650b0", "src/a.ts", similarity=0.9)

    merged = _merge_chunks([duplicate_a, duplicate_b], "src/a.ts content")

    assert len(merged) == 1
    assert merged[0].similarity == 0.9


def test_merge_prefers_the_file_that_was_asked_about_over_a_mention():
    asked = RagChunk(
        "export function WorkshopClosing() { return null; }",
        "readdy-5650b0",
        "src/components/WorkshopClosing.tsx",
        similarity=0.5,
    )
    mention = RagChunk(
        "See WorkshopClosing.tsx for the closing component. Book a demo.",
        "readdy-5650b0",
        "src/pages/index.html",
        similarity=0.6,
    )

    merged = _merge_chunks([asked, mention], "how does WorkshopClosing.tsx work?")

    assert merged[0].path == "src/components/WorkshopClosing.tsx"


def test_merge_demotes_marketing_cta_chunks():
    docs = RagChunk(
        "GarageFlow booking workflow: create appointment then confirm.",
        "readdy-5650b0",
        "src/data/helpArticles.ts",
        similarity=0.55,
    )
    marketing = RagChunk(
        "Book a demo and get founding access to GarageFlow today.",
        "readdy-5650b0",
        "src/pages/WorkshopClosing.tsx",
        similarity=0.6,
    )

    merged = _merge_chunks([docs, marketing], "GarageFlow workshop booking workflow")

    assert merged[0].path == "src/data/helpArticles.ts"


def test_merge_uses_explicit_chunk_identity_for_dedup():
    a = RagChunk("alpha body", "r", "p/one", similarity=0.4, identity="chunk-1")
    b = RagChunk("beta body", "r", "p/two", similarity=0.8, identity="chunk-1")

    merged = _merge_chunks([a, b], "alpha")

    assert len(merged) == 1
    assert merged[0].content == "beta body"