"""Reusable async Ollama client.

HAL and TRON use this exact same implementation and differ only by
configuration (base URL + default model), so there is no duplicated Ollama code
anywhere in the gateway.

Supported operations:
  * availability check
  * list / verify configured model
  * chat (streaming)
  * timeout (per-request, via httpx)
  * cancellation (the consumer cancels the task / closes the generator)
"""

from __future__ import annotations

import json
import time
from typing import AsyncIterator, Optional

import httpx


class OllamaError(Exception):
    """Base class for Ollama client failures."""

    def __init__(self, message: str, status: Optional[int] = None) -> None:
        super().__init__(message)
        self.status = status


class OllamaUnavailable(OllamaError):
    """The Ollama endpoint could not be reached at all."""


class OllamaClient:
    def __init__(self, base_url: str, default_model: str = "", timeout_s: float = 120.0) -> None:
        self.base_url = base_url.rstrip("/")
        self.default_model = default_model
        self.timeout_s = timeout_s

    # ------------------------------------------------------------------ health

    async def is_available(self) -> bool:
        """Return True if the Ollama API answers on this base URL."""

        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                response = await client.get(f"{self.base_url}/api/tags")
                return response.status_code == 200
        except (httpx.HTTPError, OSError):
            return False

    async def list_models(self) -> list[str]:
        """Return the model names reported by this Ollama instance."""

        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(f"{self.base_url}/api/tags")
            response.raise_for_status()
            data = response.json()
        return [m.get("name", "") for m in data.get("models", []) if m.get("name")]

    def _match_model(self, models: list[str]) -> Optional[str]:
        """Resolve the configured model against what is actually installed."""

        if self.default_model:
            for name in models:
                if name == self.default_model or name.split(":")[0] == self.default_model:
                    return name
            # Configured model is missing: do NOT pretend it exists.
            return None
        return models[0] if models else None

    async def health(self) -> tuple[bool, Optional[str], Optional[int], bool]:
        """One-shot health probe.

        Returns ``(online, model, latency_ms, model_ready)``.
        ``model`` is the resolved model name (or None), ``model_ready`` tells
        whether the resolved model is actually usable.
        """

        start = time.perf_counter()
        try:
            models = await self.list_models()
        except (httpx.HTTPError, OSError):
            return (False, None, None, False)
        latency = int((time.perf_counter() - start) * 1000)
        model = self._match_model(models)
        return (True, model, latency, model is not None)

    # -------------------------------------------------------------------- chat

    async def chat_stream(
        self,
        model: str,
        messages: list[dict],
        options: Optional[dict] = None,
    ) -> AsyncIterator[str]:
        """Stream assistant text chunks for a chat request.

        Yields only the incremental ``message.content`` pieces. Raises
        ``OllamaError``/``OllamaUnavailable`` on failure. Cancelling the
        consuming task closes the underlying stream and aborts generation.
        """

        payload: dict = {"model": model, "messages": messages, "stream": True}
        if options:
            payload["options"] = options

        timeout = httpx.Timeout(self.timeout_s, connect=5.0)
        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                async with client.stream("POST", f"{self.base_url}/api/chat", json=payload) as response:
                    if response.status_code != 200:
                        await response.aread()
                        raise OllamaError(
                            f"Ollama returned HTTP {response.status_code}",
                            response.status_code,
                        )
                    async for line in response.aiter_lines():
                        if not line:
                            continue
                        try:
                            chunk = json.loads(line)
                        except json.JSONDecodeError:
                            continue
                        if chunk.get("error"):
                            raise OllamaError(str(chunk["error"]))
                        content = (chunk.get("message") or {}).get("content", "")
                        if content:
                            yield content
                        if chunk.get("done"):
                            break
        except httpx.TimeoutException as exc:
            raise OllamaError("Ollama request timed out") from exc
        except httpx.HTTPError as exc:
            raise OllamaUnavailable(f"Could not reach Ollama at {self.base_url}") from exc