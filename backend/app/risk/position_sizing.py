from backend.app.config import Settings


class PositionSizer:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    def size(self, nav: float, cash: float, market_exposure: float, edge: float, odds: float) -> float:
        kelly_fraction = edge / max(odds, 1.0)
        raw_size = nav * kelly_fraction * self.settings.kelly_fraction
        max_trade = nav * self.settings.max_trade_nav_pct
        max_market_remaining = max(0.0, nav * self.settings.max_market_nav_pct - market_exposure)
        cash_reserve_remaining = max(0.0, cash - nav * self.settings.cash_reserve_pct)
        return round(max(0.0, min(raw_size, max_trade, max_market_remaining, cash_reserve_remaining)), 4)
