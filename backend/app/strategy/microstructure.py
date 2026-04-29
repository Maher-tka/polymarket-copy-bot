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
        trade_flow = getattr(orderbook, "trade_flow_imbalance", 0.0)
        recent_trades = getattr(orderbook, "recent_trade_count", 0)
        if imbalance > 0.70:
            score = min(1.0, (imbalance - 0.5) * 2)
            flow_bonus = max(0.0, trade_flow) * 0.03
            confidence = min(1.0, score + max(0.0, trade_flow) * 0.2)
            reasons = [f"Bid depth imbalance {imbalance:.2f}."]
            if recent_trades:
                reasons.append(f"Recent trade-flow imbalance {trade_flow:+.2f} across {recent_trades} trades.")
            return Signal(self.name, market.id, "YES", score, score * 0.08 + flow_bonus, confidence, reasons)
        if imbalance < 0.30:
            score = min(1.0, (0.5 - imbalance) * 2)
            flow_bonus = max(0.0, -trade_flow) * 0.03
            confidence = min(1.0, score + max(0.0, -trade_flow) * 0.2)
            reasons = [f"Ask depth imbalance {imbalance:.2f}."]
            if recent_trades:
                reasons.append(f"Recent trade-flow imbalance {trade_flow:+.2f} across {recent_trades} trades.")
            return Signal(self.name, market.id, "NO", score, score * 0.08 + flow_bonus, confidence, reasons)
        return None
