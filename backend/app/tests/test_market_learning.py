import time

from backend.app.config import Settings
from backend.app.core.bot_engine import BotEngine
from backend.app.data.gamma_api import diversify_markets, infer_research_bucket, should_include_market
from backend.app.strategy.signal_types import Market


def test_research_bucket_classifies_crypto_up_down_and_weather() -> None:
    assert infer_research_bucket("Will Bitcoin be above $80,000 on May 2?") == "crypto_up"
    assert infer_research_bucket("Will BTC fall below $40K this month?") == "crypto_down"
    assert infer_research_bucket("Will the lowest temperature in Paris be 14C or higher?") == "weather"


def test_diversify_markets_interleaves_bucket_order() -> None:
    markets = [
        market("general-1", "general", 10),
        market("crypto-up-1", "crypto_up", 8),
        market("weather-1", "weather", 6),
        market("crypto-down-1", "crypto_down", 7),
    ]

    ordered = diversify_markets(markets, "crypto_up,crypto_down,weather,general")

    assert [item.id for item in ordered] == ["crypto-up-1", "crypto-down-1", "weather-1", "general-1"]


def test_bucket_performance_tracks_open_pnl_by_market_type() -> None:
    engine = BotEngine(Settings(_env_file=None))
    engine.state.state.markets = [
        {"id": "m1", "research_bucket": "crypto_up"},
        {"id": "m2", "research_bucket": "weather"},
    ]
    engine.state.state.last_decisions = [
        {"market_id": "m1", "research_bucket": "crypto_up", "score": 0.7, "risk_ok": True},
        {"market_id": "m2", "research_bucket": "weather", "score": 0.2, "risk_ok": False},
    ]
    engine.paper_executor.positions["m1"] = {
        "shares": 10,
        "cost_basis": 5,
        "market_value": 5.5,
        "unrealized_pnl": 0.5,
        "research_bucket": "crypto_up",
        "opened_at": time.time(),
    }
    engine._sync_executor_state()

    buckets = {item["bucket"]: item for item in engine.state.state.bucket_performance}
    assert buckets["crypto_up"]["open_pnl"] == 0.5
    assert buckets["crypto_up"]["open_positions"] == 1
    assert buckets["weather"]["blocked"] == 1


def test_focus_weather_can_be_included_for_watch_only_learning() -> None:
    settings = Settings(_env_file=None)
    weather = market("weather-1", "weather", 100, question="Will Paris temperature be 14C or higher?")
    weather.liquidity = settings.learning_min_liquidity
    weather.volume = settings.learning_min_volume

    assert should_include_market(weather, settings) is True


def market(market_id: str, bucket: str, volume: float, question: str | None = None) -> Market:
    return Market(
        market_id,
        question or market_id,
        market_id,
        "yes",
        "no",
        10_000,
        volume,
        time.time() + 86_400,
        research_bucket=bucket,
    )
