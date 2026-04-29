from backend.app.config import Settings
from backend.app.strategy.base import Strategy
from backend.app.strategy.signal_types import Market, OrderBook, Signal


class SmartMoneyStrategy(Strategy):
    name = "smart_money"

    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    async def evaluate(self, market: Market, orderbook: OrderBook) -> Signal | None:
        if not self.settings.enable_smart_money:
            return None
        return Signal(self.name, market.id, "YES", 0.1, 0.01, 0.2, ["Mock smart-money weak signal only."])
