from abc import ABC, abstractmethod

from backend.app.strategy.signal_types import Market, OrderBook, Signal


class Strategy(ABC):
    name: str

    @abstractmethod
    async def evaluate(self, market: Market, orderbook: OrderBook) -> Signal | None:
        """Return a directional signal or None."""
