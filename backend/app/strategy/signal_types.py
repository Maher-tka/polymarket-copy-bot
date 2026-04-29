from dataclasses import dataclass, field
from enum import Enum
from typing import Literal


class Decision(str, Enum):
    BUY_YES = "BUY_YES"
    BUY_NO = "BUY_NO"
    SELL = "SELL"
    HOLD = "HOLD"


Side = Literal["YES", "NO"]


@dataclass(slots=True)
class OrderBookLevel:
    price: float
    size: float


@dataclass(slots=True)
class OrderBook:
    market_id: str
    yes_token_id: str
    no_token_id: str | None = None
    bids: list[OrderBookLevel] = field(default_factory=list)
    asks: list[OrderBookLevel] = field(default_factory=list)
    last_trade_price: float | None = None
    updated_at: float = 0.0
    source: str = "unknown"

    @property
    def best_bid(self) -> float | None:
        return max((level.price for level in self.bids), default=None)

    @property
    def best_ask(self) -> float | None:
        return min((level.price for level in self.asks), default=None)

    @property
    def mid_price(self) -> float | None:
        if self.best_bid is None or self.best_ask is None:
            return None
        return (self.best_bid + self.best_ask) / 2

    @property
    def spread(self) -> float:
        if self.best_bid is None or self.best_ask is None:
            return 999.0
        return max(0.0, self.best_ask - self.best_bid)


@dataclass(slots=True)
class Market:
    id: str
    question: str
    slug: str | None
    yes_token_id: str
    no_token_id: str | None
    liquidity: float
    volume: float
    end_ts: float | None
    active: bool = True


@dataclass(slots=True)
class Signal:
    strategy: str
    market_id: str
    side: Side
    score: float
    expected_edge: float
    confidence: float
    reasons: list[str] = field(default_factory=list)


@dataclass(slots=True)
class AggregatedDecision:
    market_id: str
    decision: Decision
    final_score: float
    expected_edge: float
    reasons: list[str]
    components: dict[str, float]
