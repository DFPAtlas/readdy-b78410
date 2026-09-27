"""Asterisk call lifecycle mapped onto Atlas provider-neutral telephony."""

from __future__ import annotations

import uuid
from dataclasses import dataclass

from .asterisk_ari import AsteriskARIClient
from .telephony import TelephonyRegistry


@dataclass
class AsteriskCallResources:
    call_id: str
    channel_id: str
    session_id: str
    bridge_id: str
    media_channel_id: str


class AsteriskCallController:
    def __init__(self, ari: AsteriskARIClient, telephony: TelephonyRegistry) -> None:
        self.ari = ari
        self.telephony = telephony
        self.calls: dict[str, AsteriskCallResources] = {}

    async def start(
        self,
        *,
        channel_id: str,
        caller_phone: str | None = None,
        called_number: str | None = None,
    ) -> AsteriskCallResources:
        existing = self.calls.get(channel_id)
        if existing:
            return existing

        tel = self.telephony.start(
            call_id=channel_id,
            provider="asterisk",
            caller_phone=caller_phone,
            called_number=called_number,
        )
        bridge_id = f"atlas-{uuid.uuid4().hex[:12]}"
        media_channel_id = f"atlas-media-{uuid.uuid4().hex[:12]}"

        try:
            await self.ari.answer(channel_id)
            await self.ari.create_bridge(bridge_id)
            await self.ari.add_channel_to_bridge(bridge_id, channel_id)
            await self.ari.create_external_media(media_channel_id)
            await self.ari.add_channel_to_bridge(bridge_id, media_channel_id)
        except Exception:
            # Best-effort rollback. The telephony registry remains auditable.
            try:
                await self.ari.hangup(media_channel_id)
            except Exception:
                pass
            try:
                await self.ari.destroy_bridge(bridge_id)
            except Exception:
                pass
            try:
                self.telephony.end(channel_id)
            except Exception:
                pass
            raise

        resources = AsteriskCallResources(
            call_id=channel_id,
            channel_id=channel_id,
            session_id=tel.session_id,
            bridge_id=bridge_id,
            media_channel_id=media_channel_id,
        )
        self.calls[channel_id] = resources
        return resources

    async def transfer(self, channel_id: str, endpoint: str) -> None:
        resources = self._require(channel_id)
        await self.ari.redirect(resources.channel_id, endpoint)

    async def end(self, channel_id: str) -> None:
        resources = self.calls.pop(channel_id, None)
        if resources is None:
            try:
                self.telephony.end(channel_id)
            except Exception:
                pass
            return

        for ch in (resources.media_channel_id, resources.channel_id):
            try:
                await self.ari.hangup(ch)
            except Exception:
                pass
        try:
            await self.ari.destroy_bridge(resources.bridge_id)
        except Exception:
            pass
        try:
            self.telephony.end(channel_id)
        except Exception:
            pass

    def _require(self, channel_id: str) -> AsteriskCallResources:
        resources = self.calls.get(channel_id)
        if resources is None:
            raise ValueError("asterisk_call_not_found")
        return resources
