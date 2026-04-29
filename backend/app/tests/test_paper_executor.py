import asyncio
import time

from backend.app.config import Settings
from backend.app.execution.paper_executor import PaperExecutor
from backend.app.strategy.signal_types import AggregatedDecision, Decision, Market, OrderBook, OrderBookLevel


def test_paper_executor_updates_cash_positions_and_trade_history():
    executor = PaperExecutor(Settings(_env_file=None))
    result = asyncio.run(executor.execute(decision(), market(), orderbook(), 10))

    assert result["status"] == "FILLED"
    assert executor.cash < 1000
    assert "m1" in executor.positions
    assert len(executor.trades) == 1
    assert executor.trades[0]["question"] == "Will executor work?"
    assert executor.trades[0]["created_at"] > 0


def test_paper_executor_rejects_stale_orderbook():
    executor = PaperExecutor(Settings(_env_file=None))
    stale_book = orderbook(updated_at=time.time() - 60)

    result = asyncio.run(executor.execute(decision(), market(), stale_book, 10))

    assert result["status"] == "SKIPPED"
    assert result["reason"] == "Orderbook data is stale."
    assert len(executor.trades) == 0


def test_paper_executor_can_buy_synthetic_no_side():
    executor = PaperExecutor(Settings(_env_file=None))
    result = asyncio.run(executor.execute(decision(Decision.BUY_NO), market(), orderbook(), 10))

    assert result["status"] == "FILLED"
    assert "m1:NO" in executor.positions
    assert executor.positions["m1:NO"]["side"] == Decision.BUY_NO.value


def test_paper_executor_tracks_open_win_loss_metrics():
    executor = PaperExecutor(Settings(_env_file=None))
    asyncio.run(executor.execute(decision(), market(), orderbook(), 10))

    executor.mark_to_market(market(), orderbook(bid=0.59, ask=0.61))

    position = executor.positions["m1"]
    assert position["win_loss"] == "WIN"
    assert position["unrealized_pnl"] > 0
    assert position["pnl_pct"] > 0


def decision(side=Decision.BUY_YES):
    return AggregatedDecision("m1", side, 0.8, 0.08, [], {})


def market():
    return Market("m1", "Will executor work?", "executor", "yes", "no", 5000, 10000, time.time() + 3600)


def orderbook(updated_at=None, bid=0.49, ask=0.50):
    return OrderBook(
        "m1",
        "yes",
        asks=[OrderBookLevel(ask, 100)],
        bids=[OrderBookLevel(bid, 100)],
        updated_at=updated_at or time.time(),
    )
