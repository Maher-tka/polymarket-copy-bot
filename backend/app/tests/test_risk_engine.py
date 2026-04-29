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


def test_risk_engine_blocks_core_risk_limits():
    settings = Settings(_env_file=None)
    risk = RiskEngine(settings)

    result = risk.evaluate(decision(score=0.1, edge=0.01), market(), orderbook(), portfolio(), 10)
    assert result.accepted is False
    assert "Final score is below configured threshold." in result.reasons
    assert "Expected edge is below minimum." in result.reasons

    result = risk.evaluate(decision(), market(liquidity=10, volume=10), orderbook(), portfolio(), 10)
    assert result.accepted is False
    assert "Market liquidity is below MIN_LIQUIDITY." in result.reasons
    assert "Market volume is below MIN_VOLUME." in result.reasons

    result = risk.evaluate(decision(), market(), orderbook(bid=0.45, ask=0.55), portfolio(), 10)
    assert result.accepted is False
    assert "Bid/ask spread is above MAX_SPREAD_CENTS." in result.reasons


def test_risk_engine_blocks_when_edge_disappears_after_costs():
    settings = Settings(_env_file=None)

    result = RiskEngine(settings).evaluate(decision(edge=0.06), market(), orderbook(), portfolio(), 10)

    assert result.accepted is False
    assert result.adjusted_edge < settings.min_expected_edge
    assert "Cost-adjusted edge is below minimum after fees, slippage, and capital lock-up." in result.reasons


def test_risk_engine_blocks_max_open_markets_and_correlated_exposure():
    settings = Settings(_env_file=None, max_open_markets=1, max_correlated_nav_pct=0.03)
    risk = RiskEngine(settings)

    too_many_markets = portfolio(exposure_by_market={"other": 10})
    result = risk.evaluate(decision(), market("m2"), orderbook(), too_many_markets, 10)
    assert result.accepted is False
    assert "Max open markets limit hit." in result.reasons

    correlated = portfolio(
        exposure_by_market={"other": 10},
        exposure_by_correlation_group={"same-driver": 25},
    )
    result = risk.evaluate(decision(), market("m2", group="same-driver"), orderbook(), correlated, 10)
    assert result.accepted is False
    assert "Correlated exposure limit hit." in result.reasons


def test_real_mode_keeps_stricter_score_threshold():
    settings = Settings(
        _env_file=None,
        bot_mode="REAL",
        real_trading_enabled=True,
        i_understand_real_money_risk=True,
        polymarket_private_key="test-private-key",
        polymarket_funder_address="0x0000000000000000000000000000000000000000",
    )

    result = RiskEngine(settings).evaluate(decision(score=0.5), market(), orderbook(), portfolio(), 10)

    assert result.accepted is False
    assert "Final score is below configured threshold." in result.reasons


def test_risk_engine_blocks_daily_loss_drawdown_and_cash_reserve():
    settings = Settings(_env_file=None)
    risk = RiskEngine(settings)

    state = portfolio(nav=1000, cash=1000, daily_pnl=-60, max_drawdown_pct=0.11)
    result = risk.evaluate(decision(), market(), orderbook(), state, 10)
    assert result.accepted is False
    assert "Daily loss limit hit." in result.reasons
    assert "Total drawdown limit hit." in result.reasons

    low_cash = portfolio(nav=1000, cash=205)
    result = risk.evaluate(decision(), market(), orderbook(), low_cash, 10)
    assert result.accepted is False
    assert "Cash reserve would be violated." in result.reasons


def decision(score=0.8, edge=0.08):
    return AggregatedDecision("m1", Decision.BUY_YES, score, edge, [], {"calibration_arbitrage": 0.4})


def market(market_id="m1", liquidity=5000, volume=10000, group=None):
    return Market(market_id, "Will test pass?", "test", "yes", "no", liquidity, volume, time.time() + 3600, correlation_group=group)


def orderbook(updated_at=None, bid=0.48, ask=0.50):
    return OrderBook(
        "m1",
        "yes",
        bids=[OrderBookLevel(bid, 100)],
        asks=[OrderBookLevel(ask, 100)],
        updated_at=updated_at or time.time(),
    )


def portfolio(nav=1000, cash=1000, daily_pnl=0, max_drawdown_pct=0, exposure_by_market=None, exposure_by_correlation_group=None):
    return PortfolioRiskState(
        nav=nav,
        cash=cash,
        daily_pnl=daily_pnl,
        max_drawdown_pct=max_drawdown_pct,
        exposure_by_market=exposure_by_market or {},
        exposure_by_correlation_group=exposure_by_correlation_group or {},
    )
