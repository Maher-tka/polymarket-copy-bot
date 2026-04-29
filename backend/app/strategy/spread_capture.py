from backend.app.config import Settings
from backend.app.strategy.base import Strategy
from backend.app.strategy.signal_types import Market, OrderBook, Signal


class SpreadCaptureStrategy(Strategy):
    name = "spread_capture"

    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    async def evaluate(self, market: Market, orderbook: OrderBook) -> Signal | None:
        if not self.settings.enable_spread_capture:
            return None
        bid_depth = sum(level.price * level.size for level in orderbook.bids[:3])
        ask_depth = sum(level.price * level.size for level in orderbook.asks[:3])
        if bid_depth + ask_depth < self.settings.min_liquidity:
            return None
        if orderbook.best_bid is None or orderbook.best_ask is None:
            return None
        spread = orderbook.spread
        if spread <= 0 or spread > self.settings.max_spread:
            return None
        score = min(1.0, spread / max(self.settings.max_spread, 0.001))
        edge = max(0.0, spread / 2)
        return Signal(self.name, market.id, "YES", score, edge, 0.55, [f"Maker spread capture opportunity: {spread:.2%}."])
