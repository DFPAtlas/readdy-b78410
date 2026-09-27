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
