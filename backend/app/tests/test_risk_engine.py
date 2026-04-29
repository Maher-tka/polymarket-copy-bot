import time

from backend.app.config import Settings
from backend.app.risk.circuit_breaker import CircuitBreaker
from backend.app.risk.risk_engine import PortfolioRiskState, RiskEngine
from backend.app.strategy.signal_types import AggregatedDecision, Decision, Market, OrderBook, OrderBookLevel


def test_risk_engine_accepts_clean_paper_trade():
    settings = Settings(_env_file=None)
    risk = RiskEngine(settings)

    result = risk.evaluate(decision(), market(), orderbook(), portfolio(), 10)

    assert result.accepted is True


def test_risk_engine_blocks_stale_data_and_emergency_stop():
    settings = Settings(_env_file=None)
    breaker = CircuitBreaker(emergency_stop=True)
    risk = RiskEngine(settings, breaker)
    stale_book = orderbook(updated_at=time.time() - 60)

    result = risk.evaluate(decision(), market(), stale_book, portfolio(), 10)

    assert result.accepted is False
    assert "Emergency stop is active." in result.reasons
    assert "Orderbook data is stale." in result.reasons


def test_risk_engine_blocks_market_exposure_limit():
    settings = Settings(_env_file=None)
    state = portfolio(exposure_by_market={"m1": 15})

    result = RiskEngine(settings).evaluate(decision(), market(), orderbook(), state, 10)

    assert result.accepted is False
    assert "Per-market exposure limit hit." in result.reasons


def decision():
    return AggregatedDecision("m1", Decision.BUY_YES, 0.8, 0.08, [], {"calibration_arbitrage": 0.4})


def market():
    return Market("m1", "Will test pass?", "test", "yes", "no", 5000, 10000, time.time() + 3600)


def orderbook(updated_at=None):
    return OrderBook(
        "m1",
        "yes",
        bids=[OrderBookLevel(0.48, 100)],
        asks=[OrderBookLevel(0.50, 100)],
        updated_at=updated_at or time.time(),
    )


def portfolio(exposure_by_market=None):
    return PortfolioRiskState(nav=1000, cash=1000, exposure_by_market=exposure_by_market or {})
