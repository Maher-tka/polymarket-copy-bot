from backend.app.config import Settings
from backend.app.execution.fill_simulator import FillSimulator
from backend.app.strategy.signal_types import OrderBook, OrderBookLevel


def test_fill_simulator_supports_partial_fills_and_slippage():
    simulator = FillSimulator(Settings(_env_file=None))
    book = OrderBook(
        "m1",
        "yes",
        asks=[OrderBookLevel(0.50, 10), OrderBookLevel(0.55, 10)],
        bids=[OrderBookLevel(0.49, 10)],
    )

    fill = simulator.simulate_buy(book, target_usd=20, limit_price=0.55)

    assert fill.partial is True
    assert fill.filled_usd == 10.5
    assert fill.avg_price > 0.50
    assert fill.slippage_usd > 0
