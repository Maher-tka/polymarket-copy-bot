from backend.app.config import Settings
from backend.app.data.external_probability import ExternalProbabilityProvider
from backend.app.strategy.base import Strategy
from backend.app.strategy.signal_types import Market, OrderBook, Signal


class CalibrationArbitrageStrategy(Strategy):
    name = "calibration_arbitrage"

    def __init__(self, settings: Settings, provider: ExternalProbabilityProvider) -> None:
        self.settings = settings
        self.provider = provider

    async def evaluate(self, market: Market, orderbook: OrderBook) -> Signal | None:
        if not self.settings.enable_calibration:
            return None
        external = await self.provider.probability(market.id, market.question)
        mid = orderbook.mid_price
        if external is None or mid is None:
            return None

        edge = external - mid
        if abs(edge) < self.settings.min_expected_edge:
            return None
        side = "YES" if edge > 0 else "NO"
        score = max(-1.0, min(1.0, edge / max(self.settings.min_expected_edge, 0.001)))
        return Signal(
            strategy=self.name,
            market_id=market.id,
            side=side,
            score=score,
            expected_edge=abs(edge),
            confidence=min(1.0, abs(score)),
            reasons=[f"External probability {external:.2%} vs market mid {mid:.2%}."],
        )
