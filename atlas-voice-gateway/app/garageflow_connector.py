"""GarageFlow website connector for the Master Voice Agent.

This adapter talks only to the GarageFlow scoped API. It never reaches directly
into the GarageFlow database and never exposes the API key to the frontend.
"""

from __future__ import annotations

import os
import uuid
from typing import Any, Optional

import httpx

from .website_registry import CapabilityRisk, WebsiteCapability, WebsiteDescriptor


GARAGEFLOW = WebsiteDescriptor(
    id="garageflow",
    name="GarageFlow",
    description="Garage management, workshop diary and AI telephone receptionist",
    aliases=("garage flow", "garage-flow"),
    capabilities=(
        WebsiteCapability("customers.read", "Find caller/customer records", CapabilityRisk.READ),
        WebsiteCapability("vehicles.read", "Find vehicles and registrations", CapabilityRisk.READ),
        WebsiteCapability("bookings.read", "Read workshop bookings", CapabilityRisk.READ),
        WebsiteCapability("bookings.request", "Create a provisional telephone booking request", CapabilityRisk.WRITE_REVERSIBLE),
    ),
)


class GarageFlowConnector:
    descriptor = GARAGEFLOW

    def __init__(
        self,
        base_url: Optional[str] = None,
        api_key: Optional[str] = None,
        *,
        timeout_s: float = 8.0,
        client: httpx.AsyncClient | None = None,
    ) -> None:
        self.base_url = (base_url or os.getenv("GARAGEFLOW_API_BASE_URL", "")).rstrip("/")
        self.api_key = api_key or os.getenv("GARAGEFLOW_API_KEY", "")
        self.timeout_s = timeout_s
        self._client = client

    def configured(self) -> bool:
        return bool(self.base_url and self.api_key)

    def _headers(self, *, idempotency_key: str | None = None) -> dict[str, str]:
        headers = {
            "X-GarageFlow-API-Key": self.api_key,
            "Accept": "application/json",
        }
        if idempotency_key:
            headers["X-Idempotency-Key"] = idempotency_key
        return headers

    async def _request(self, method: str, path: str, **kwargs: Any) -> dict:
        if not self.configured():
            raise RuntimeError("garageflow_not_configured")

        owns_client = self._client is None
        client = self._client or httpx.AsyncClient(timeout=self.timeout_s)
        try:
            response = await client.request(
                method,
                f"{self.base_url}/api/v1/{path.lstrip('/')}",
                headers=self._headers(idempotency_key=kwargs.pop("idempotency_key", None)),
                **kwargs,
            )
            response.raise_for_status()
            body = response.json()
            if not isinstance(body, dict):
                raise RuntimeError("garageflow_invalid_response")
            return body
        finally:
            if owns_client:
                await client.aclose()

    async def find_customers(self, search: str) -> list[dict]:
        result = await self._request("GET", "customers", params={"search": search, "per_page": 20})
        return list(result.get("data") or [])

    async def find_vehicles(self, search: str) -> list[dict]:
        result = await self._request("GET", "vehicles", params={"search": search, "per_page": 20})
        return list(result.get("data") or [])

    async def list_bookings(self, *, date_from: str = "", date_to: str = "", status: str = "") -> list[dict]:
        params = {"per_page": 100}
        if date_from:
            params["date_from"] = date_from
        if date_to:
            params["date_to"] = date_to
        if status:
            params["status"] = status
        result = await self._request("GET", "bookings", params=params)
        return list(result.get("data") or [])

    async def create_booking_request(
        self,
        *,
        customer_id: str,
        vehicle_id: str,
        service_type: str,
        starts_at: str,
        ends_at: str,
        title: str,
        customer_description: str = "",
        duration_minutes: int,
        idempotency_key: str | None = None,
    ) -> dict:
        """Submit a provisional AI-receptionist booking.

        GarageFlow remains authoritative for validation, tenancy and conflicts.
        The connector does not manufacture availability locally.
        """

        payload = {
            "customer_id": customer_id,
            "vehicle_id": vehicle_id,
            "service_type": service_type,
            "starts_at": starts_at,
            "ends_at": ends_at,
            "duration_minutes": duration_minutes,
            "title": title,
            "customer_description": customer_description,
            "source": "ai_receptionist",
        }
        result = await self._request(
            "POST",
            "bookings",
            json=payload,
            idempotency_key=idempotency_key or f"voice-{uuid.uuid4()}",
        )
        return dict(result.get("data") or {})
