from abc import ABC, abstractmethod

from backend.app.strategy.signal_types import AggregatedDecision, Market, OrderBook


class Executor(ABC):
    @abstractmethod
    async def execute(self, decision: AggregatedDecision, market: Market, orderbook: OrderBook, size_usd: float) -> dict:
        """Execute or simulate a limit order."""
