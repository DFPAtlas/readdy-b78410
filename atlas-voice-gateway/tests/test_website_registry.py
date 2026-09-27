from app.garageflow_connector import GarageFlowConnector
from app.website_registry import WebsiteRegistry


def test_registry_matches_garageflow_alias():
    connector = GarageFlowConnector(base_url="https://example.test", api_key="secret")
    registry = WebsiteRegistry([connector])
    assert registry.match_message("open Garage Flow bookings") is connector


def test_catalogue_never_exposes_secret():
    connector = GarageFlowConnector(base_url="https://example.test", api_key="super-secret")
    registry = WebsiteRegistry([connector])
    catalogue = registry.public_catalogue()
    assert catalogue[0]["configured"] is True
    assert "super-secret" not in repr(catalogue)


def test_unconfigured_connector_is_reported_safely():
    connector = GarageFlowConnector(base_url="", api_key="")
    assert connector.configured() is False


def test_garageflow_capabilities_include_reversible_booking_write():
    connector = GarageFlowConnector(base_url="https://example.test", api_key="secret")
    caps = {cap.name: cap.risk.value for cap in connector.descriptor.capabilities}
    assert caps["bookings.request"] == "write_reversible"


import httpx
import pytest


@pytest.mark.asyncio
async def test_garageflow_availability_requires_authoritative_response():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path.endswith("/api/v1/bookings/availability")
        assert request.url.params["date"] == "2026-09-29"
        assert request.url.params["duration_minutes"] == "60"
        return httpx.Response(200, json={
            "authoritative": True,
            "data": [{"starts_at": "2026-09-29T08:00:00Z", "ends_at": "2026-09-29T09:00:00Z"}],
        })

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport) as client:
        connector = GarageFlowConnector(
            base_url="https://garageflow.example",
            api_key="secret",
            client=client,
        )
        slots = await connector.availability(date="2026-09-29", duration_minutes=60)

    assert len(slots) == 1
    assert slots[0]["starts_at"] == "2026-09-29T08:00:00Z"
