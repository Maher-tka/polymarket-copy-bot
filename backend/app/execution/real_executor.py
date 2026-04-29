import time

from backend.app.config import Settings
from backend.app.execution.executor_base import Executor
from backend.app.risk.risk_engine import RiskDecision
from backend.app.strategy.signal_types import AggregatedDecision, Decision, Market, OrderBook


class RealExecutor(Executor):
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self._client = None
        self.enabled = (
            settings.bot_mode == "REAL"
            and settings.real_trading_enabled
            and settings.i_understand_real_money_risk
            and bool(settings.polymarket_private_key)
            and bool(settings.polymarket_funder_address)
        )

    async def execute(self, decision: AggregatedDecision, market: Market, orderbook: OrderBook, size_usd: float) -> dict:
        raise RuntimeError("RealExecutor requires submit_limit_order with explicit RiskDecision.")

    async def submit_limit_order(
        self,
        decision: AggregatedDecision,
        market: Market,
        orderbook: OrderBook,
        size_usd: float,
        risk: RiskDecision,
    ) -> dict:
        if not self.enabled:
            raise RuntimeError("REAL trading is disabled by env safety flags.")
        if not risk.accepted:
            raise RuntimeError(f"Risk engine blocked real order: {'; '.join(risk.reasons)}")
        if time.time() - orderbook.updated_at > self.settings.stale_data_seconds:
            raise RuntimeError("Risk engine cannot be bypassed with stale orderbook data.")
        if orderbook.spread > self.settings.max_spread:
            raise RuntimeError("Risk engine cannot be bypassed with a wide spread.")
        if self.settings.polymarket_private_key is None:
            raise RuntimeError("Missing private key.")

        client = self._get_client()
        token_id = self._token_for_decision(decision.decision, market)
        side = "SELL" if decision.decision == Decision.SELL else "BUY"
        price = self._maker_price(decision.decision, orderbook)
        if decision.metadata.get("execution_style") == "maker_limit":
            price = float(decision.metadata.get("maker_price") or price)
        if price <= 0:
            raise RuntimeError("Cannot place real order without a valid limit price.")

        shares = round(size_usd / price, 4)
        if shares <= 0:
            raise RuntimeError("Calculated real order size is zero.")

        from py_clob_client.clob_types import OrderArgs, OrderType

        order_args = OrderArgs(
            token_id=token_id,
            price=round(price, 4),
            size=shares,
            side=side,
            fee_rate_bps=int(self.settings.estimated_fee_bps),
        )
        signed_order = client.create_order(order_args)
        response = client.post_order(signed_order, OrderType.GTC, post_only=True)
        return {
            "status": "SUBMITTED",
            "mode": "REAL",
            "token_id": token_id,
            "side": side,
            "price": round(price, 4),
            "shares": shares,
            "response": response,
        }

    async def cancel_all(self) -> dict:
        if not self.enabled:
            return {"status": "NOOP", "reason": "REAL trading is disabled."}
        response = self._get_client().cancel_all()
        return {"status": "CANCELLED", "response": response}

    def _get_client(self):
        if self._client is not None:
            return self._client
        if self.settings.polymarket_private_key is None:
            raise RuntimeError("Missing private key.")
        try:
            from py_clob_client.client import ClobClient
        except ImportError as exc:
            raise RuntimeError("py-clob-client is required for REAL mode.") from exc

        self._client = ClobClient(
            self.settings.polymarket_host,
            key=self.settings.polymarket_private_key.get_secret_value(),
            chain_id=self.settings.polymarket_chain_id,
            funder=self.settings.polymarket_funder_address,
        )
        self._client.set_api_creds(self._client.create_or_derive_api_creds())
        return self._client

    @staticmethod
    def _token_for_decision(decision: Decision, market: Market) -> str:
        if decision == Decision.BUY_NO:
            return market.no_token_id
        return market.yes_token_id

    @staticmethod
    def _maker_price(decision: Decision, orderbook: OrderBook) -> float:
        mid = orderbook.mid_price or 0.0
        if decision == Decision.BUY_YES:
            return orderbook.best_bid or max(mid - 0.01, 0.01)
        if decision == Decision.BUY_NO:
            if orderbook.best_ask is not None:
                return round(max(0.01, min(0.99, 1 - orderbook.best_ask)), 4)
            return max((1 - mid) - 0.01, 0.01)
        if decision == Decision.SELL:
            return orderbook.best_ask or min(mid + 0.01, 0.99)
        return 0.0
