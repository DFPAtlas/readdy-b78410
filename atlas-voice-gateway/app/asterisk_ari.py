"""Asterisk ARI control-plane adapter for Atlas telephony.

This client controls signalling/bridges only. Media transport is handled by an
External Media channel and a dedicated Atlas media endpoint.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any, Optional
from urllib.parse import quote

import httpx


@dataclass(frozen=True)
class AsteriskSettings:
    base_url: str
    username: str
    password: str
    app_name: str
    external_media_host: str
    external_media_format: str = "ulaw"
    external_media_transport: str = "udp"
    external_media_encapsulation: str = "rtp"

    @classmethod
    def from_env(cls) -> "AsteriskSettings":
        return cls(
            base_url=os.getenv("ASTERISK_ARI_URL", "http://127.0.0.1:8088/ari").rstrip("/"),
            username=os.getenv("ASTERISK_ARI_USERNAME", ""),
            password=os.getenv("ASTERISK_ARI_PASSWORD", ""),
            app_name=os.getenv("ASTERISK_ARI_APP", "atlas-garageflow"),
            external_media_host=os.getenv("ASTERISK_EXTERNAL_MEDIA_HOST", "127.0.0.1:60000"),
            external_media_format=os.getenv("ASTERISK_EXTERNAL_MEDIA_FORMAT", "ulaw"),
            external_media_transport=os.getenv("ASTERISK_EXTERNAL_MEDIA_TRANSPORT", "udp"),
            external_media_encapsulation=os.getenv("ASTERISK_EXTERNAL_MEDIA_ENCAPSULATION", "rtp"),
        )

    def configured(self) -> bool:
        return bool(self.base_url and self.username and self.password and self.app_name and self.external_media_host)


class AsteriskARIError(RuntimeError):
    pass


class AsteriskARIClient:
    def __init__(
        self,
        settings: AsteriskSettings | None = None,
        *,
        client: httpx.AsyncClient | None = None,
        timeout_s: float = 8.0,
    ) -> None:
        self.settings = settings or AsteriskSettings.from_env()
        self._client = client
        self.timeout_s = timeout_s

    async def _request(self, method: str, path: str, *, params: dict | None = None, json: Any = None) -> Any:
        if not self.settings.configured():
            raise AsteriskARIError("asterisk_not_configured")

        owns = self._client is None
        client = self._client or httpx.AsyncClient(
            timeout=self.timeout_s,
            auth=(self.settings.username, self.settings.password),
        )
        try:
            response = await client.request(
                method,
                f"{self.settings.base_url}/{path.lstrip('/')}",
                params=params,
                json=json,
                auth=(self.settings.username, self.settings.password),
            )
            if response.status_code >= 400:
                raise AsteriskARIError(f"asterisk_http_{response.status_code}")
            if response.status_code == 204 or not response.content:
                return {}
            return response.json()
        finally:
            if owns:
                await client.aclose()

    async def answer(self, channel_id: str) -> None:
        await self._request("POST", f"channels/{quote(channel_id, safe='')}/answer")

    async def create_bridge(self, bridge_id: str) -> dict:
        return await self._request(
            "POST",
            "bridges",
            params={"type": "mixing", "bridgeId": bridge_id, "name": f"Atlas {bridge_id}"},
        )

    async def add_channel_to_bridge(self, bridge_id: str, channel_id: str) -> None:
        await self._request(
            "POST",
            f"bridges/{quote(bridge_id, safe='')}/addChannel",
            params={"channel": channel_id},
        )

    async def create_external_media(self, channel_id: str) -> dict:
        return await self._request(
            "POST",
            "channels/externalMedia",
            params={
                "channelId": channel_id,
                "app": self.settings.app_name,
                "external_host": self.settings.external_media_host,
                "format": self.settings.external_media_format,
                "transport": self.settings.external_media_transport,
                "encapsulation": self.settings.external_media_encapsulation,
                "direction": "both",
            },
        )

    async def hangup(self, channel_id: str) -> None:
        await self._request("DELETE", f"channels/{quote(channel_id, safe='')}")

    async def destroy_bridge(self, bridge_id: str) -> None:
        await self._request("DELETE", f"bridges/{quote(bridge_id, safe='')}")

    async def redirect(self, channel_id: str, endpoint: str) -> None:
        """Redirect an active channel to a configured PJSIP/SIP endpoint."""

        endpoint = (endpoint or "").strip()
        if not endpoint:
            raise AsteriskARIError("transfer_endpoint_required")
        await self._request(
            "POST",
            f"channels/{quote(channel_id, safe='')}/redirect",
            params={"endpoint": endpoint},
        )
