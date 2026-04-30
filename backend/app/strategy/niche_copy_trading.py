from backend.app.config import Settings
from backend.app.data.trader_discovery import NicheTraderDiscovery
from backend.app.strategy.base import Strategy
from backend.app.strategy.signal_types import Market, OrderBook, Signal


class NicheCopyTradingStrategy(Strategy):
    name = "niche_copy_trading"

    def __init__(self, settings: Settings, discovery: NicheTraderDiscovery) -> None:
        self.settings = settings
        self.discovery = discovery

    async def evaluate(self, market: Market, orderbook: OrderBook) -> Signal | None:
        if not self.settings.enable_niche_copy_trading:
            return None
        if market.research_bucket not in self.discovery.allowed_buckets:
            return None
        signal = self.discovery.signal_for_market(market.id)
        if not signal:
            return None
        if orderbook.spread > self.settings.max_spread:
            return None
        source_price_moved = too_far_from_source(signal.side, signal.source_price, orderbook)
        if source_price_moved:
            return None
        score = max(0.0, min(1.0, signal.trader_score))
        edge = max(0.005, min(0.08, score * 0.05))
        return Signal(
            strategy=self.name,
            market_id=market.id,
            side=signal.side,
            score=score,
            expected_edge=edge,
            confidence=score,
            reasons=[signal.reason, "Fast copy uses cached top-trader list; no ranking work is done in the live loop."],
            metadata={
                "strategy": self.name,
                "bucket": signal.bucket,
                "copied_wallet": signal.wallet,
                "copied_trader": signal.trader_name,
                "copied_trader_score": signal.trader_score,
                "source_price": signal.source_price,
                "source_size": signal.source_size,
                "copy_timestamp": signal.timestamp,
            },
        )


def too_far_from_source(side: str, source_price: float, orderbook: OrderBook, max_move: float = 0.04) -> bool:
    current = orderbook.best_ask if side == "YES" else synthetic_no_ask(orderbook)
    if current is None:
        return True
    return current - source_price > max_move


def synthetic_no_ask(orderbook: OrderBook) -> float | None:
    if orderbook.best_bid is None:
        return None
    return round(max(0.01, min(0.99, 1 - orderbook.best_bid)), 4)
