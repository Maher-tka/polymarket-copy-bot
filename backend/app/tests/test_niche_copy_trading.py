import asyncio
import time

from backend.app.config import Settings
from backend.app.data.trader_discovery import CopySignal, NicheTraderDiscovery, TraderProfile, build_copy_signal, trade_bucket
from backend.app.risk.risk_engine import PortfolioRiskState, RiskEngine
from backend.app.strategy.niche_copy_trading import NicheCopyTradingStrategy
from backend.app.strategy.signal_types import AggregatedDecision, Decision, Market, OrderBook, OrderBookLevel


def test_trade_bucket_only_targets_crypto_up_down_and_weather() -> None:
    assert trade_bucket({"title": "Will Bitcoin be above $100K?", "outcome": "Up"}) == "crypto_up"
    assert trade_bucket({"title": "Bitcoin Up or Down on May 1?", "outcome": "Up"}) == "crypto_up"
    assert trade_bucket({"title": "Will BTC close down today?", "outcome": "Down"}) == "crypto_down"
    assert trade_bucket({"title": "Will NYC get rain tomorrow?"}) == "weather"


def test_build_copy_signal_uses_public_trade_without_wallet_copy_shortcut() -> None:
    profile = TraderProfile("0xabc", "sharp", "crypto_up", 0.8, 20, 500, 50, 0.7, time.time())
    signal = build_copy_signal(
        {
            "conditionId": "market-1",
            "outcomeIndex": 0,
            "price": 0.54,
            "size": 20,
            "timestamp": time.time(),
            "outcome": "Up",
        },
        "crypto_up",
        profile,
    )

    assert signal is not None
    assert signal.side == "YES"
    assert signal.source_price == 0.54
    assert "Copied sharp" in signal.reason


def test_niche_copy_strategy_emits_cached_signal_without_live_discovery_work() -> None:
    settings = Settings(_env_file=None, enable_niche_copy_trading=True)
    discovery = NicheTraderDiscovery(settings)
    discovery.copy_signals_by_market["m1"] = copy_signal()

    signal = asyncio.run(NicheCopyTradingStrategy(settings, discovery).evaluate(market(), orderbook()))

    assert signal is not None
    assert signal.strategy == "niche_copy_trading"
    assert signal.side == "YES"
    assert signal.metadata["copied_wallet"] == "0xabc"
    assert "cached top-trader list" in signal.reasons[1]


def test_niche_copy_strategy_rejects_disallowed_stale_wide_or_moved_signal() -> None:
    settings = Settings(_env_file=None, enable_niche_copy_trading=True)
    discovery = NicheTraderDiscovery(settings)
    discovery.copy_signals_by_market["m1"] = copy_signal(timestamp=time.time() - settings.copy_signal_ttl_seconds - 1)
    strategy = NicheCopyTradingStrategy(settings, discovery)

    assert asyncio.run(strategy.evaluate(market(), orderbook())) is None

    discovery.copy_signals_by_market["m1"] = copy_signal()
    assert asyncio.run(strategy.evaluate(market(bucket="sports"), orderbook())) is None
    assert asyncio.run(strategy.evaluate(market(), orderbook(bid=0.40, ask=0.48))) is None
    assert asyncio.run(strategy.evaluate(market(), orderbook(bid=0.60, ask=0.62))) is None


def test_copy_signal_summary_exposes_top_traders_and_live_signals() -> None:
    settings = Settings(_env_file=None)
    discovery = NicheTraderDiscovery(settings)
    discovery.top_traders_by_bucket["weather"] = [
        TraderProfile("0xabc", "rain-maker", "weather", 0.7, 15, 300, 40, 0.8, time.time())
    ]
    discovery.copy_signals_by_market["m1"] = copy_signal(bucket="weather")

    summary = discovery.summary()

    assert summary["enabled"] is True
    assert summary["allowed_buckets"] == ["crypto_down", "crypto_up", "weather"]
    assert summary["top_traders"]["weather"][0]["name"] == "rain-maker"
    assert summary["copy_signals"][0]["bucket"] == "weather"


def test_niche_only_mode_blocks_non_copy_trade() -> None:
    settings = Settings(_env_file=None, enable_niche_copy_trading=True, require_niche_copy_confirmation=True)
    decision = AggregatedDecision(
        "m1",
        Decision.BUY_YES,
        0.8,
        0.08,
        [],
        {"calibration_arbitrage": 0.4},
        {"strategy": "calibration_arbitrage"},
    )

    result = RiskEngine(settings).evaluate(
        decision,
        market("weather"),
        orderbook(),
        PortfolioRiskState(nav=1000, cash=1000, exposure_by_market={}, exposure_by_correlation_group={}),
        10,
    )

    assert result.accepted is False
    assert "Top-trader copy confirmation required for niche-only mode." in result.reasons


def copy_signal(bucket: str = "crypto_up", timestamp: float | None = None) -> CopySignal:
    return CopySignal(
        market_id="m1",
        bucket=bucket,
        wallet="0xabc",
        trader_name="sharp",
        trader_score=0.82,
        side="YES",
        outcome="Up",
        source_price=0.50,
        source_size=20,
        timestamp=timestamp or time.time(),
        reason="Copied sharp in crypto_up: Up @ 0.500.",
    )


def market(bucket: str = "crypto_up") -> Market:
    return Market("m1", "Will Bitcoin be up today?", "bitcoin-up", "yes", "no", 10_000, 50_000, time.time() + 86_400, research_bucket=bucket)


def orderbook(bid: float = 0.49, ask: float = 0.51) -> OrderBook:
    return OrderBook(
        "m1",
        "yes",
        "no",
        bids=[OrderBookLevel(bid, 1_000)],
        asks=[OrderBookLevel(ask, 1_000)],
        updated_at=time.time(),
        source="test",
    )
