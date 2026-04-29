import time

from backend.app.config import Settings
from backend.app.execution.executor_base import Executor
from backend.app.execution.fill_simulator import FillSimulator
from backend.app.strategy.signal_types import AggregatedDecision, Decision, Market, OrderBook


class PaperExecutor(Executor):
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.cash = settings.paper_start_balance
        self.positions: dict[str, dict] = {}
        self.trades: list[dict] = []
        self.fill_simulator = FillSimulator(settings)

    @property
    def nav(self) -> float:
        return self.cash + sum(position["market_value"] for position in self.positions.values())

    async def execute(self, decision: AggregatedDecision, market: Market, orderbook: OrderBook, size_usd: float) -> dict:
        if decision.decision not in {Decision.BUY_YES, Decision.BUY_NO}:
            return {"status": "SKIPPED", "reason": "Decision is not buyable."}
        if time.time() - orderbook.updated_at > self.settings.stale_data_seconds:
            return {"status": "SKIPPED", "reason": "Orderbook data is stale."}
        limit_price = orderbook.best_ask
        if limit_price is None:
            return {"status": "SKIPPED", "reason": "No ask price."}
        fill = self.fill_simulator.simulate_buy(orderbook, min(size_usd, self.cash), limit_price)
        if fill.filled_usd <= 0:
            return {"status": "SKIPPED", "reason": "No simulated fill."}
        self.cash -= fill.filled_usd + fill.fees_usd
        position = self.positions.get(market.id, {"shares": 0.0, "cost_basis": 0.0, "market_value": 0.0})
        position["shares"] += fill.shares
        position["cost_basis"] += fill.filled_usd
        position["market_value"] = position["shares"] * (orderbook.mid_price or fill.avg_price)
        self.positions[market.id] = position
        trade = {
            "mode": "PAPER",
            "market_id": market.id,
            "decision": decision.decision.value,
            "size_usd": fill.filled_usd,
            "shares": fill.shares,
            "avg_price": fill.avg_price,
            "partial": fill.partial,
            "fees_usd": fill.fees_usd,
            "slippage_usd": fill.slippage_usd,
        }
        self.trades.append(trade)
        return {"status": "FILLED" if not fill.partial else "PARTIAL", "trade": trade}
