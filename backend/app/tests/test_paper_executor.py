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


def decision():
    return AggregatedDecision("m1", Decision.BUY_YES, 0.8, 0.08, [], {})


def market():
    return Market("m1", "Will executor work?", "executor", "yes", "no", 5000, 10000, time.time() + 3600)


def orderbook():
    return OrderBook("m1", "yes", asks=[OrderBookLevel(0.50, 100)], bids=[OrderBookLevel(0.49, 100)], updated_at=time.time())
