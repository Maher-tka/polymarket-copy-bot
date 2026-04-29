import time

from backend.app.config import Settings
from backend.app.execution.executor_base import Executor
from backend.app.execution.fill_simulator import FillSimulator
from backend.app.strategy.signal_types import AggregatedDecision, Decision, Market, OrderBook, OrderBookLevel


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
        execution_book = orderbook if decision.decision == Decision.BUY_YES else invert_binary_orderbook(orderbook, market.no_token_id)
        limit_price = execution_book.best_ask
        if limit_price is None:
            return {"status": "SKIPPED", "reason": "No ask price."}
        fill = self.fill_simulator.simulate_buy(execution_book, min(size_usd, self.cash), limit_price)
        if fill.filled_usd <= 0:
            return {"status": "SKIPPED", "reason": "No simulated fill."}
        self.cash -= fill.filled_usd + fill.fees_usd
        position_key = market.id if decision.decision == Decision.BUY_YES else f"{market.id}:NO"
        position = self.positions.get(position_key, {"shares": 0.0, "cost_basis": 0.0, "market_value": 0.0, "side": decision.decision.value})
        position["shares"] += fill.shares
        position["cost_basis"] += fill.filled_usd
        position["market_value"] = position["shares"] * (execution_book.mid_price or fill.avg_price)
        self.positions[position_key] = position
        trade = {
            "mode": "PAPER",
            "market_id": position_key,
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

    def mark_to_market(self, market: Market, orderbook: OrderBook) -> None:
        yes_position = self.positions.get(market.id)
        if yes_position and orderbook.mid_price is not None:
            yes_position["market_value"] = yes_position["shares"] * orderbook.mid_price

        no_position = self.positions.get(f"{market.id}:NO")
        if no_position and orderbook.mid_price is not None:
            no_mid = max(0.01, min(0.99, 1 - orderbook.mid_price))
            no_position["market_value"] = no_position["shares"] * no_mid


def invert_binary_orderbook(orderbook: OrderBook, no_token_id: str | None) -> OrderBook:
    return OrderBook(
        market_id=f"{orderbook.market_id}:NO",
        yes_token_id=no_token_id or f"{orderbook.yes_token_id}:NO",
        no_token_id=orderbook.yes_token_id,
        bids=[OrderBookLevel(price=round(1 - level.price, 4), size=level.size) for level in orderbook.asks],
        asks=[OrderBookLevel(price=round(1 - level.price, 4), size=level.size) for level in orderbook.bids],
        last_trade_price=round(1 - orderbook.last_trade_price, 4) if orderbook.last_trade_price is not None else None,
        updated_at=orderbook.updated_at,
        source=f"{orderbook.source}:synthetic-no",
    )
