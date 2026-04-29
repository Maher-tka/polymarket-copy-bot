import asyncio
import time

from backend.app.config import Settings
from backend.app.data.price_feed import StaticPriceFeed
from backend.app.execution.paper_executor import PaperExecutor
from backend.app.strategy.impossibility_seller import (
    WARNING_TEXT,
    ImpossibilitySellerStrategy,
    cap_fear_seller_size,
    distance_pct,
    parse_target_price,
)
from backend.app.strategy.signal_aggregator import SignalAggregator
from backend.app.strategy.signal_types import Decision, Market, OrderBook, OrderBookLevel


def test_strategy_disabled_by_default() -> None:
    strategy = ImpossibilitySellerStrategy(Settings(_env_file=None), StaticPriceFeed())

    assert asyncio.run(strategy.evaluate(market(), book())) is None


def test_rejects_stale_data() -> None:
    strategy = ImpossibilitySellerStrategy(enabled_settings(), StaticPriceFeed())

    signal = asyncio.run(strategy.evaluate(market(), book(updated_at=time.time() - 60)))

    assert signal is None
    assert strategy.last_candidates[0]["reason"] == "Orderbook data is stale."


def test_rejects_low_liquidity() -> None:
    strategy = ImpossibilitySellerStrategy(enabled_settings(), StaticPriceFeed())

    signal = asyncio.run(strategy.evaluate(market(liquidity=100), book()))

    assert signal is None
    assert "Liquidity" in strategy.last_candidates[0]["reason"]


def test_rejects_spread_above_fear_limit() -> None:
    strategy = ImpossibilitySellerStrategy(enabled_settings(), StaticPriceFeed())

    signal = asyncio.run(strategy.evaluate(market(), book(bid=0.03, ask=0.06)))

    assert signal is None
    assert "Spread" in strategy.last_candidates[0]["reason"]


def test_rejects_real_mode_without_live_price_feed() -> None:
    settings = enabled_settings(
        bot_mode="REAL",
        real_trading_enabled=True,
        i_understand_real_money_risk=True,
        polymarket_private_key="secret",
        polymarket_funder_address="0xabc",
    )
    strategy = ImpossibilitySellerStrategy(settings, StaticPriceFeed())

    signal = asyncio.run(strategy.evaluate(market(), book()))

    assert signal is None
    assert "live external price feed" in strategy.last_candidates[0]["reason"]


def test_parses_btc_target_prices() -> None:
    assert parse_target_price("Will BTC fall below $40K this month?") == 40_000
    assert parse_target_price("Will Bitcoin crash under $40,000 by Friday?") == 40_000
    assert parse_target_price("Will BTC hit 40000 this month?") == 40_000


def test_calculates_distance_pct() -> None:
    assert round(distance_pct(65_000, 40_000), 4) == 0.3846


def test_rejects_edge_below_minimum() -> None:
    strategy = ImpossibilitySellerStrategy(enabled_settings(), StaticPriceFeed({"BTC": 65_000}))

    signal = asyncio.run(strategy.evaluate(market(question="Will BTC fall below $64,000 this month?"), book(bid=0.01, ask=0.02)))

    assert signal is None
    assert "edge or score below" in strategy.last_candidates[0]["reason"]


def test_caps_trade_size_at_half_percent_nav() -> None:
    size = cap_fear_seller_size(100, 1000, 1000, 0, 0, 0, 0.96, enabled_settings())

    assert size == 5


def test_caps_total_strategy_exposure_at_five_percent_nav() -> None:
    size = cap_fear_seller_size(100, 1000, 1000, 0, 49, 0, 0.96, enabled_settings())

    assert size == 1


def test_caps_btc_crash_bucket_exposure_at_two_percent_nav() -> None:
    size = cap_fear_seller_size(100, 1000, 1000, 0, 0, 19, 0.96, enabled_settings())

    assert size == 1


def test_never_places_market_orders() -> None:
    decision = accepted_decision()

    assert decision.metadata["order_type"] == "LIMIT"
    assert decision.metadata["execution_style"] == "maker_limit"


def test_uses_maker_limit_orders_only_in_paper_executor() -> None:
    executor = PaperExecutor(enabled_settings())
    result = asyncio.run(executor.execute(accepted_decision(), market(), book(), 5))

    assert result["status"] == "SUBMITTED"
    assert result["order"]["post_only"] is True
    assert result["order"]["order_type"] == "LIMIT"
    assert executor.trades == []


def test_cancels_stale_maker_orders() -> None:
    executor = PaperExecutor(enabled_settings())
    asyncio.run(executor.execute(accepted_decision(), market(), book(), 5))
    executor.open_orders[0]["created_at"] = time.time() - 120

    assert executor.cancel_stale_orders(60) == 1
    assert executor.open_orders == []


def test_does_not_blindly_copy_wallet_trades() -> None:
    strategy = ImpossibilitySellerStrategy(enabled_settings(), StaticPriceFeed())

    assert strategy.name != "smart_money"
    assert not hasattr(strategy, "wallet")


def test_dashboard_warning_is_available() -> None:
    strategy = ImpossibilitySellerStrategy(enabled_settings(), StaticPriceFeed())

    assert strategy.summary()["warning"] == WARNING_TEXT


def accepted_decision():
    strategy = ImpossibilitySellerStrategy(enabled_settings(), StaticPriceFeed({"BTC": 65_000}))
    signal = asyncio.run(strategy.evaluate(market(), book()))
    assert signal is not None
    decision = SignalAggregator(enabled_settings()).aggregate("m1", [signal])
    assert decision.decision == Decision.BUY_NO
    return decision


def enabled_settings(**overrides) -> Settings:
    return Settings(_env_file=None, enable_impossibility_seller=True, **overrides)


def market(question: str = "Will BTC fall below $40K this month?", liquidity: float = 50_000, volume: float = 100_000) -> Market:
    return Market("m1", question, "btc-below-40k", "yes", "no", liquidity, volume, time.time() + 10 * 86_400)


def book(bid: float = 0.04, ask: float = 0.05, updated_at: float | None = None) -> OrderBook:
    return OrderBook(
        "m1",
        "yes",
        "no",
        bids=[OrderBookLevel(bid, 600), OrderBookLevel(max(0.01, bid - 0.01), 500)],
        asks=[OrderBookLevel(ask, 700), OrderBookLevel(min(0.99, ask + 0.01), 600)],
        updated_at=updated_at or time.time(),
    )
