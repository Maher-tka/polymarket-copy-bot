import time

from backend.app.config import Settings
from backend.app.data.external_probability import MockProbabilityProvider
from backend.app.data.news_feed import NewsFeed
from backend.app.execution.order_manager import OrderManager
from backend.app.execution.paper_executor import PaperExecutor
from backend.app.execution.real_executor import RealExecutor
from backend.app.risk.circuit_breaker import CircuitBreaker
from backend.app.risk.position_sizing import PositionSizer
from backend.app.risk.risk_engine import PortfolioRiskState, RiskEngine
from backend.app.storage.db import session_scope
from backend.app.storage.models import TradeModel
from backend.app.storage.repositories import TradeRepository
from backend.app.strategy.calibration_arbitrage import CalibrationArbitrageStrategy
from backend.app.strategy.microstructure import MicrostructureStrategy
from backend.app.strategy.news_reaction import NewsReactionStrategy
from backend.app.strategy.signal_aggregator import SignalAggregator
from backend.app.strategy.signal_types import Decision, Market, OrderBook, OrderBookLevel
from backend.app.strategy.smart_money import SmartMoneyStrategy
from backend.app.strategy.spread_capture import SpreadCaptureStrategy
from backend.app.core.state_store import StateStore


class BotEngine:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.state = StateStore(settings.paper_start_balance, settings.bot_mode)
        self.circuit_breaker = CircuitBreaker()
        self.risk_engine = RiskEngine(settings, self.circuit_breaker)
        self.position_sizer = PositionSizer(settings)
        self.paper_executor = PaperExecutor(settings)
        self.real_executor = RealExecutor(settings)
        self.order_manager = OrderManager(settings.max_order_age_seconds, settings.order_cooldown_seconds)
        self.aggregator = SignalAggregator(settings)
        self.strategies = [
            CalibrationArbitrageStrategy(settings, MockProbabilityProvider()),
            MicrostructureStrategy(settings),
            SpreadCaptureStrategy(settings),
            SmartMoneyStrategy(settings),
            NewsReactionStrategy(settings, NewsFeed()),
        ]

    async def start(self) -> None:
        self.state.state.status = "RUNNING"
        self.state.log("Bot started.")

    async def pause(self) -> None:
        self.circuit_breaker.paused = True
        self.state.state.status = "PAUSED"
        self.state.log("Bot paused.")

    async def stop(self) -> None:
        self.state.state.status = "STOPPED"
        self.state.log("Bot stopped.")

    async def emergency_stop(self) -> None:
        self.circuit_breaker.emergency_stop = True
        self.state.state.status = "EMERGENCY_STOP"
        self.state.state.open_orders.clear()
        self.state.log("Emergency stop activated. Open orders cancelled.")

    def dashboard_state(self) -> dict:
        self._sync_executor_state()
        return self.state.snapshot()

    async def evaluate_market(self, market: Market, orderbook: OrderBook) -> dict:
        signals = []
        for strategy in self.strategies:
            signal = await strategy.evaluate(market, orderbook)
            if signal:
                signals.append(signal)
        decision = self.aggregator.aggregate(market.id, signals)
        market_exposure = self.paper_executor.positions.get(market.id, {}).get("cost_basis", 0.0)
        size_usd = self.position_sizer.size(self.paper_executor.nav, self.paper_executor.cash, market_exposure, decision.expected_edge, orderbook.mid_price or 1.0)
        risk_state = PortfolioRiskState(
            nav=self.paper_executor.nav,
            cash=self.paper_executor.cash,
            daily_pnl=self.state.state.daily_pnl,
            max_drawdown_pct=self.state.state.max_drawdown_pct,
            exposure_by_market={key: value["cost_basis"] for key, value in self.paper_executor.positions.items()},
        )
        risk = self.risk_engine.evaluate(decision, market, orderbook, risk_state, size_usd)
        result = {"decision": decision, "risk": risk, "size_usd": size_usd, "execution": None}
        self.state.state.last_decisions.insert(
            0,
            {
                "market_id": market.id,
                "decision": decision.decision.value,
                "score": decision.final_score,
                "edge": decision.expected_edge,
                "risk_ok": risk.accepted,
                "reasons": decision.reasons + risk.reasons,
            },
        )
        self.state.state.last_decisions = self.state.state.last_decisions[:100]
        if risk.accepted and decision.decision in {Decision.BUY_YES, Decision.BUY_NO} and size_usd > 0:
            if self.settings.bot_mode == "PAPER":
                result["execution"] = await self.paper_executor.execute(decision, market, orderbook, size_usd)
                self._record_paper_trade(result["execution"], decision)
            else:
                result["execution"] = await self.real_executor.submit_limit_order(decision, market, orderbook, size_usd, risk)
        self._sync_executor_state()
        return result

    async def demo_tick(self) -> dict:
        market = Market("demo-market", "Demo market above fair value?", "demo-market", "yes-token", "no-token", 5000, 20000, time.time() + 86400)
        orderbook = OrderBook(
            market_id=market.id,
            yes_token_id=market.yes_token_id,
            bids=[OrderBookLevel(0.48, 200), OrderBookLevel(0.47, 300)],
            asks=[OrderBookLevel(0.51, 200), OrderBookLevel(0.52, 300)],
            updated_at=time.time(),
            source="demo",
        )
        return await self.evaluate_market(market, orderbook)

    def _sync_executor_state(self) -> None:
        self.state.state.balance = round(self.paper_executor.cash, 4)
        self.state.state.nav = round(self.paper_executor.nav, 4)
        self.state.state.positions = [
            {"market_id": key, **value}
            for key, value in self.paper_executor.positions.items()
        ]
        self.state.state.trades = list(reversed(self.paper_executor.trades[-100:]))
        self.state.state.blocked_reasons = list(self.circuit_breaker.blocked_reasons)

    def _record_paper_trade(self, execution: dict | None, decision) -> None:
        if not execution or execution.get("status") not in {"FILLED", "PARTIAL"}:
            return
        trade = execution.get("trade") or {}
        with session_scope() as session:
            TradeRepository(session).record_trade(
                TradeModel(
                    mode="PAPER",
                    market_id=trade["market_id"],
                    side=trade["decision"],
                    price=trade["avg_price"],
                    size_usd=trade["size_usd"],
                    shares=trade["shares"],
                    signal_source=",".join(sorted(decision.components.keys())) or "aggregator",
                )
            )
