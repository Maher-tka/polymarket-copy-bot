from abc import ABC, abstractmethod


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
