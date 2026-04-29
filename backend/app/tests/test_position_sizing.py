from backend.app.config import Settings
from backend.app.risk.position_sizing import PositionSizer


def test_position_sizing_caps_fractional_kelly_by_trade_and_cash_reserve():
    settings = Settings(_env_file=None)
    sizer = PositionSizer(settings)

    size = sizer.size(nav=1000, cash=1000, market_exposure=0, edge=0.20, odds=1)

    assert size == 10


def test_position_sizing_respects_market_exposure_limit():
    settings = Settings(_env_file=None)
    sizer = PositionSizer(settings)

    size = sizer.size(nav=1000, cash=1000, market_exposure=19, edge=0.20, odds=1)

    assert size == 1
