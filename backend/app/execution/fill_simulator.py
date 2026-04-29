from dataclasses import dataclass

from backend.app.config import Settings
from backend.app.strategy.signal_types import OrderBook


@dataclass(slots=True)
class SimulatedFill:
    filled_usd: float
    shares: float
    avg_price: float
    partial: bool
    slippage_usd: float
    fees_usd: float


class FillSimulator:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    def simulate_buy(self, orderbook: OrderBook, target_usd: float, limit_price: float) -> SimulatedFill:
        remaining = target_usd
        notional = 0.0
        shares = 0.0
        levels = sorted(orderbook.asks, key=lambda level: level.price)
        top_price = levels[0].price if levels else limit_price
        for level in levels:
            if remaining <= 0 or level.price > limit_price:
                break
            level_notional = level.price * level.size
            take_notional = min(remaining, level_notional)
            notional += take_notional
            shares += take_notional / level.price
            remaining -= take_notional
        avg_price = notional / shares if shares else 0.0
        slippage = max(0.0, avg_price - top_price) * shares
        fees = notional * self.settings.estimated_fee_bps / 10_000
        return SimulatedFill(round(notional, 4), round(shares, 4), round(avg_price, 4), remaining > 0.01, round(slippage, 4), round(fees, 4))
