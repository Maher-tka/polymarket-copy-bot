import asyncio
import time

from backend.app.config import Settings
from backend.app.strategy.microstructure import MicrostructureStrategy
from backend.app.strategy.signal_types import Market, OrderBook, OrderBookLevel


def test_microstructure_uses_trade_flow_as_confirmation() -> None:
    strategy = MicrostructureStrategy(Settings(_env_file=None))
    signal = asyncio.run(strategy.evaluate(market(), orderbook(trade_flow_imbalance=0.8, recent_trade_count=12)))

    assert signal is not None
    assert signal.side == "YES"
    assert signal.expected_edge > 0.064
    assert any("trade-flow" in reason for reason in signal.reasons)


def market() -> Market:
    return Market("m1", "Will flow confirm?", "flow", "yes", "no", 5000, 10000, time.time() + 3600)


def orderbook(trade_flow_imbalance: float, recent_trade_count: int) -> OrderBook:
    return OrderBook(
        "m1",
        "yes",
        bids=[OrderBookLevel(0.49, 800), OrderBookLevel(0.48, 300)],
        asks=[OrderBookLevel(0.51, 100), OrderBookLevel(0.52, 100)],
        updated_at=time.time(),
        trade_flow_imbalance=trade_flow_imbalance,
        recent_trade_count=recent_trade_count,
    )
