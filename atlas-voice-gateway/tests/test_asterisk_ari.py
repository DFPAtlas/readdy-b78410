import httpx
import pytest

from app.asterisk_ari import AsteriskARIClient, AsteriskSettings


@pytest.mark.asyncio
async def test_ari_builds_external_media_channel():
    seen = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        if request.url.path.endswith("/channels/externalMedia"):
            return httpx.Response(200, json={"id": "media-1"})
        return httpx.Response(204)

    settings = AsteriskSettings(
        base_url="http://asterisk.test:8088/ari",
        username="atlas",
        password="secret",
        app_name="atlas-garageflow",
        external_media_host="10.0.0.5:60000",
    )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        ari = AsteriskARIClient(settings, client=client)
        result = await ari.create_external_media("media-1")

    assert result["id"] == "media-1"
    req = seen[0]
    assert req.url.params["app"] == "atlas-garageflow"
    assert req.url.params["external_host"] == "10.0.0.5:60000"
    assert req.url.params["format"] == "ulaw"
    assert req.url.params["direction"] == "both"


@pytest.mark.asyncio
async def test_ari_redirect_uses_endpoint():
    seen = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(204)

    settings = AsteriskSettings(
        base_url="http://asterisk.test:8088/ari",
        username="atlas",
        password="secret",
        app_name="atlas-garageflow",
        external_media_host="10.0.0.5:60000",
    )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        ari = AsteriskARIClient(settings, client=client)
        await ari.redirect("PJSIP/garage-0001", "PJSIP/101")

    assert seen[0].url.params["endpoint"] == "PJSIP/101"
