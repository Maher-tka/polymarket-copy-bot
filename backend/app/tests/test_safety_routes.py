import time

import pytest
from fastapi.testclient import TestClient

from backend.app.config import Settings
from backend.app.core.bot_engine import BotEngine
from backend.app.execution.real_executor import RealExecutor
from backend.app.main import app
from backend.app.risk.risk_engine import RiskDecision
from backend.app.strategy.signal_types import AggregatedDecision, Decision, Market, OrderBook, OrderBookLevel


def test_settings_route_does_not_expose_private_key_name_or_value():
    with TestClient(app) as client:
        response = client.get("/api/settings")

    payload = response.json()
    serialized = response.text
    assert response.status_code == 200
    assert "polymarket_private_key" not in payload
    assert "POLYMARKET_PRIVATE_KEY" not in serialized


def test_start_real_mode_requires_runtime_confirmation():
    real_engine = BotEngine(
        Settings(
            _env_file=None,
            bot_mode="REAL",
            real_trading_enabled=True,
            i_understand_real_money_risk=True,
            polymarket_private_key="test-private-key",
            polymarket_funder_address="0x0000000000000000000000000000000000000001",
        )
    )
    with TestClient(app) as client:
        original_engine = client.app.state.engine
        client.app.state.engine = real_engine
        try:
            response = client.post("/api/bot/start")
        finally:
            client.app.state.engine = original_engine

    assert response.status_code == 403
    assert "runtime confirmation" in response.json()["detail"]


def test_demo_tick_is_disabled_in_real_mode():
    real_engine = BotEngine(
        Settings(
            _env_file=None,
            bot_mode="REAL",
            real_trading_enabled=True,
            i_understand_real_money_risk=True,
            polymarket_private_key="test-private-key",
            polymarket_funder_address="0x0000000000000000000000000000000000000001",
        )
    )
    with TestClient(app) as client:
        original_engine = client.app.state.engine
        client.app.state.engine = real_engine
        try:
            response = client.post("/api/bot/demo-tick")
        finally:
            client.app.state.engine = original_engine

    assert response.status_code == 409


def test_real_executor_rejects_stale_orderbook_even_with_accepted_risk():
    executor = RealExecutor(
        Settings(
            _env_file=None,
            bot_mode="REAL",
            real_trading_enabled=True,
            i_understand_real_money_risk=True,
            polymarket_private_key="test-private-key",
            polymarket_funder_address="0x0000000000000000000000000000000000000001",
        )
    )

    with pytest.raises(RuntimeError, match="stale orderbook"):
        import asyncio

        asyncio.run(
            executor.submit_limit_order(
                AggregatedDecision("m1", Decision.BUY_YES, 0.9, 0.1, [], {}),
                Market("m1", "Question?", "m1", "yes", "no", 5000, 10000, time.time() + 3600),
                OrderBook(
                    "m1",
                    "yes",
                    bids=[OrderBookLevel(0.49, 100)],
                    asks=[OrderBookLevel(0.50, 100)],
                    updated_at=time.time() - 60,
                ),
                10,
                RiskDecision(True, []),
            )
        )
