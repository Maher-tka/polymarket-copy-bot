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
        self.open_orders: list[dict] = []
        self.fill_simulator = FillSimulator(settings)

    @property
    def nav(self) -> float:
        return self.cash + sum(position["market_value"] for position in self.positions.values())

    def cancel_stale_orders(self, max_age_seconds: int) -> int:
        now = time.time()
        before = len(self.open_orders)
        self.open_orders = [
            order for order in self.open_orders if now - float(order.get("created_at", 0.0)) <= max_age_seconds
        ]
        return before - len(self.open_orders)

    async def execute(self, decision: AggregatedDecision, market: Market, orderbook: OrderBook, size_usd: float) -> dict:
        if decision.decision not in {Decision.BUY_YES, Decision.BUY_NO}:
            return {"status": "SKIPPED", "reason": "Decision is not buyable."}
        if time.time() - orderbook.updated_at > self.settings.stale_data_seconds:
            return {"status": "SKIPPED", "reason": "Orderbook data is stale."}
        execution_book = orderbook if decision.decision == Decision.BUY_YES else invert_binary_orderbook(orderbook, market.no_token_id)
        limit_price = execution_book.best_ask
        if limit_price is None:
            return {"status": "SKIPPED", "reason": "No ask price."}
        if decision.metadata.get("execution_style") == "maker_limit":
            maker_price = float(decision.metadata.get("maker_price") or 0.0)
            if maker_price <= 0 or maker_price >= limit_price:
                return {"status": "SKIPPED", "reason": "Maker limit would cross the spread."}
            order = {
                "mode": "PAPER",
                "order_type": "LIMIT",
                "post_only": True,
                "market_id": market.id if decision.decision == Decision.BUY_YES else f"{market.id}:NO",
                "question": market.question,
                "decision": decision.decision.value,
                "price": round(maker_price, 4),
                "size_usd": round(min(size_usd, self.cash), 4),
                "strategy": decision.metadata.get("strategy"),
                "bucket": decision.metadata.get("bucket"),
                "created_at": time.time(),
            }
            self.open_orders.insert(0, order)
            self.open_orders = self.open_orders[:100]
            return {"status": "SUBMITTED", "order": order}
        fill = self.fill_simulator.simulate_buy(execution_book, min(size_usd, self.cash), limit_price)
        if fill.filled_usd <= 0:
            return {"status": "SKIPPED", "reason": "No simulated fill."}
        self.cash -= fill.filled_usd + fill.fees_usd
        position_key = market.id if decision.decision == Decision.BUY_YES else f"{market.id}:NO"
        position = self.positions.get(
            position_key,
            {
                "shares": 0.0,
                "cost_basis": 0.0,
                "market_value": 0.0,
                "side": decision.decision.value,
                "question": market.question,
                "opened_at": time.time(),
                "fees_paid": 0.0,
                "slippage_usd": 0.0,
                "strategy": decision.metadata.get("strategy"),
                "bucket": decision.metadata.get("bucket"),
            },
        )
        position["question"] = position.get("question") or market.question
        position["shares"] += fill.shares
        position["cost_basis"] += fill.filled_usd
        position["fees_paid"] = position.get("fees_paid", 0.0) + fill.fees_usd
        position["slippage_usd"] = position.get("slippage_usd", 0.0) + fill.slippage_usd
        position["strategy"] = position.get("strategy") or decision.metadata.get("strategy")
        position["bucket"] = position.get("bucket") or decision.metadata.get("bucket")
        self._refresh_position_metrics(position, execution_book.mid_price or fill.avg_price)
        self.positions[position_key] = position
        trade = {
            "mode": "PAPER",
            "market_id": position_key,
            "question": market.question,
            "decision": decision.decision.value,
            "size_usd": fill.filled_usd,
            "shares": fill.shares,
            "avg_price": fill.avg_price,
            "partial": fill.partial,
            "fees_usd": fill.fees_usd,
            "slippage_usd": fill.slippage_usd,
            "strategy": decision.metadata.get("strategy"),
            "bucket": decision.metadata.get("bucket"),
            "created_at": time.time(),
        }
        self.trades.append(trade)
        return {"status": "FILLED" if not fill.partial else "PARTIAL", "trade": trade}

    def mark_to_market(self, market: Market, orderbook: OrderBook) -> None:
        yes_position = self.positions.get(market.id)
        if yes_position and orderbook.mid_price is not None:
            yes_position["question"] = yes_position.get("question") or market.question
            self._refresh_position_metrics(yes_position, orderbook.mid_price)

        no_position = self.positions.get(f"{market.id}:NO")
        if no_position and orderbook.mid_price is not None:
            no_mid = max(0.01, min(0.99, 1 - orderbook.mid_price))
            no_position["question"] = no_position.get("question") or market.question
            self._refresh_position_metrics(no_position, no_mid)

    def _refresh_position_metrics(self, position: dict, current_price: float) -> None:
        position["current_price"] = round(current_price, 4)
        position["avg_price"] = round(position["cost_basis"] / position["shares"], 4) if position["shares"] else 0.0
        position["market_value"] = round(position["shares"] * current_price, 4)
        pnl = position["market_value"] - position["cost_basis"] - position.get("fees_paid", 0.0)
        position["unrealized_pnl"] = round(pnl, 4)
        position["pnl_pct"] = round(pnl / position["cost_basis"], 4) if position["cost_basis"] else 0.0
        position["win_loss"] = classify_pnl(pnl)
        position["last_updated_at"] = time.time()


def classify_pnl(pnl: float) -> str:
    if pnl > 0.01:
        return "WIN"
    if pnl < -0.01:
        return "LOSS"
    return "BREAKEVEN"


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
        trade_flow_imbalance=round(-orderbook.trade_flow_imbalance, 4),
        recent_trade_count=orderbook.recent_trade_count,
        last_event_type=orderbook.last_event_type,
    )
