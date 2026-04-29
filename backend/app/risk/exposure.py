from dataclasses import dataclass


@dataclass(slots=True)
class Exposure:
    total: float = 0.0
    by_market: dict[str, float] | None = None

    def market(self, market_id: str) -> float:
        return (self.by_market or {}).get(market_id, 0.0)
