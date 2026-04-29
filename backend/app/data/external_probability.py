from abc import ABC, abstractmethod
import time

import httpx

from backend.app.config import Settings


class ExternalProbabilityProvider(ABC):
    @abstractmethod
    async def probability(self, market_id: str, question: str) -> float | None:
        """Return an external YES probability in [0, 1]."""


class MockProbabilityProvider(ExternalProbabilityProvider):
    async def probability(self, market_id: str, question: str) -> float | None:
        lowered = question.lower()
        if "will" in lowered or "win" in lowered or "above" in lowered:
            return 0.52
        return 0.50


class MetaculusProbabilityProvider(ExternalProbabilityProvider):
    """Cached public Metaculus lookup, disabled unless explicitly selected."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self._client = httpx.AsyncClient(timeout=8)
        self._cache: dict[str, tuple[float, float | None]] = {}

    async def probability(self, market_id: str, question: str) -> float | None:
        key = self._cache_key(market_id, question)
        cached = self._cache.get(key)
        now = time.time()
        if cached and now - cached[0] < self.settings.metaculus_cache_ttl_seconds:
            return cached[1]

        probability = await self._fetch_probability(question)
        self._cache[key] = (now, probability)
        return probability

    async def close(self) -> None:
        await self._client.aclose()

    async def _fetch_probability(self, question: str) -> float | None:
        keywords = " ".join(question.split()[:6])
        if not keywords:
            return None
        try:
            response = await self._client.get(
                "https://www.metaculus.com/api2/questions/",
                params={
                    "search": keywords,
                    "status": "open",
                    "order_by": "-activity",
                    "limit": self.settings.metaculus_search_limit,
                },
            )
            response.raise_for_status()
        except httpx.HTTPError:
            return None

        for item in response.json().get("results", []):
            probability = self._extract_probability(item)
            if probability is not None:
                return probability
        return None

    def _extract_probability(self, item: dict) -> float | None:
        candidates = [
            item.get("community_prediction", {}).get("full", {}).get("q2"),
            item.get("community_prediction", {}).get("q2"),
            item.get("prediction", {}).get("q2"),
        ]
        for candidate in candidates:
            if candidate is None:
                continue
            try:
                value = float(candidate)
            except (TypeError, ValueError):
                continue
            if 0.0 <= value <= 1.0:
                return value
        return None

    def _cache_key(self, market_id: str, question: str) -> str:
        return f"{market_id}:{question.lower()[:120]}"
