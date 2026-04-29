from backend.app.config import Settings
from backend.app.strategy.base import Strategy
from backend.app.strategy.signal_types import Market, OrderBook, Signal


class MicrostructureStrategy(Strategy):
    name = "microstructure"

    def __init__(self, settings: Settings, depth_levels: int = 5) -> None:
        self.settings = settings
        self.depth_levels = depth_levels

    async def evaluate(self, market: Market, orderbook: OrderBook) -> Signal | None:
        if not self.settings.enable_microstructure:
            return None
        bid_depth = sum(level.size for level in orderbook.bids[: self.depth_levels])
        ask_depth = sum(level.size for level in orderbook.asks[: self.depth_levels])
        total = bid_depth + ask_depth
        if total <= 0:
            return None
        imbalance = bid_depth / total
        if orderbook.spread > self.settings.max_spread:
            return None
        if imbalance > 0.70:
            score = min(1.0, (imbalance - 0.5) * 2)
            return Signal(self.name, market.id, "YES", score, score * 0.08, score, [f"Bid depth imbalance {imbalance:.2f}."])
        if imbalance < 0.30:
            score = min(1.0, (0.5 - imbalance) * 2)
            return Signal(self.name, market.id, "NO", score, score * 0.08, score, [f"Ask depth imbalance {imbalance:.2f}."])
        return None
