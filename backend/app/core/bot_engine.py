import asyncio
import contextlib
import time

from backend.app.config import Settings
from backend.app.data.clob_rest import ClobRestClient
from backend.app.data.external_probability import MockProbabilityProvider
from backend.app.data.gamma_api import GammaApi
from backend.app.data.news_feed import NewsFeed
from backend.app.execution.order_manager import OrderManager
from backend.app.execution.paper_executor import PaperExecutor
from backend.app.execution.real_executor import RealExecutor
from backend.app.risk.circuit_breaker import CircuitBreaker
from backend.app.risk.position_sizing import PositionSizer
from backend.app.risk.risk_engine import PortfolioRiskState, RiskEngine
from backend.app.storage.db import session_scope
from backend.app.storage.models import TradeModel
from backend.app.storage.repositories import MarketRepository, TradeRepository
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
        self._loop_task: asyncio.Task | None = None
        self._markets_cache: list[Market] = []
        self._last_market_refresh = 0.0
        self._high_water_nav = settings.paper_start_balance
        self.strategies = [
            CalibrationArbitrageStrategy(settings, MockProbabilityProvider()),
            MicrostructureStrategy(settings),
            SpreadCaptureStrategy(settings),
            SmartMoneyStrategy(settings),
            NewsReactionStrategy(settings, NewsFeed()),
        ]

    async def start(self) -> None:
        self.circuit_breaker.paused = False
        self.state.state.status = "RUNNING"
        self.state.log("Bot started.")
        if self.settings.bot_mode == "PAPER":
            self._ensure_loop()
        else:
            self.state.log("REAL mode does not auto-run the paper market loop.")

    async def pause(self) -> None:
        self.circuit_breaker.paused = True
        self.state.state.status = "PAUSED"
        await self._stop_loop()
        self.state.log("Bot paused.")

    async def stop(self) -> None:
        self.state.state.status = "STOPPED"
        await self._stop_loop()
        self.state.log("Bot stopped.")

    async def emergency_stop(self) -> None:
        self.circuit_breaker.emergency_stop = True
        self.state.state.status = "EMERGENCY_STOP"
        self.state.state.open_orders.clear()
        await self._stop_loop()
        self.state.log("Emergency stop activated. Open orders cancelled.")

    def dashboard_state(self) -> dict:
        self._sync_executor_state()
        return self.state.snapshot()

    def _ensure_loop(self) -> None:
        if self._loop_task and not self._loop_task.done():
            return
        self._loop_task = asyncio.create_task(self._paper_market_loop())
        self.state.state.loop_running = True

    async def _stop_loop(self) -> None:
        self.state.state.loop_running = False
        if self._loop_task and not self._loop_task.done():
            self._loop_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._loop_task

    async def _paper_market_loop(self) -> None:
        self.state.log("Live PAPER loop started: discovering markets and reading real orderbooks.")
        while self.state.state.status == "RUNNING" and not self.circuit_breaker.emergency_stop:
            started = time.time()
            try:
                await self._run_paper_cycle()
                self.state.state.last_error = None
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                self.state.state.last_error = str(exc)
                self.state.log(f"Live PAPER loop error: {exc}")
            elapsed = time.time() - started
            await asyncio.sleep(max(1, self.settings.paper_loop_interval_seconds - elapsed))
        self.state.state.loop_running = False

    async def _run_paper_cycle(self) -> None:
        self.state.state.cycle_count += 1
        self.state.state.last_cycle_at = time.time()
        self.state.state.data_source = "gamma+clob-rest"
        markets = await self._active_markets()
        if not markets:
            self.state.log("No eligible live markets found yet.")
            return

        scanned = 0
        fills = 0
        clob = ClobRestClient(self.settings)
        try:
            for market in markets[: self.settings.market_scan_limit]:
                if self.state.state.status != "RUNNING":
                    break
                try:
                    orderbook = await clob.get_orderbook(market.yes_token_id, market.id)
                    orderbook.no_token_id = market.no_token_id
                except Exception as exc:
                    self.state.log(f"Orderbook fetch skipped for {market.slug or market.id}: {exc}")
                    continue

                self.paper_executor.mark_to_market(market, orderbook)
                before_trades = len(self.paper_executor.trades)
                result = await self.evaluate_market(market, orderbook)
                scanned += 1
                if len(self.paper_executor.trades) > before_trades:
                    fills += 1
                    self.state.log(f"Paper fill: {market.question[:72]}")
                if fills >= self.settings.max_paper_trades_per_cycle:
                    break
        finally:
            await clob.close()

        self.state.state.scanned_markets = scanned
        self.state.state.stale_data = False
        self._sync_executor_state()
        self.state.log(f"Cycle {self.state.state.cycle_count}: scanned {scanned} live markets, fills {fills}.")

    async def _active_markets(self) -> list[Market]:
        now = time.time()
        if self._markets_cache and now - self._last_market_refresh < self.settings.market_refresh_seconds:
            return self._markets_cache

        gamma = GammaApi(self.settings)
        try:
            markets = await gamma.active_markets(limit=self.settings.market_discovery_limit)
        finally:
            await gamma.close()

        self._markets_cache = markets
        self._last_market_refresh = now
        self.state.state.markets = [
            {
                "id": market.id,
                "question": market.question,
                "slug": market.slug,
                "liquidity": market.liquidity,
                "volume": market.volume,
                "yes_token_id": market.yes_token_id,
                "no_token_id": market.no_token_id,
            }
            for market in markets
        ]
        with session_scope() as session:
            MarketRepository(session).upsert_many(markets)
        self.state.log(f"Discovered {len(markets)} eligible live markets.")
        return markets

    async def evaluate_market(self, market: Market, orderbook: OrderBook) -> dict:
        signals = []
        for strategy in self.strategies:
            signal = await strategy.evaluate(market, orderbook)
            if signal:
                signals.append(signal)
        decision = self.aggregator.aggregate(market.id, signals)
        exposure_by_market = self._position_exposure_by_market()
        market_exposure = exposure_by_market.get(market.id, 0.0)
        size_usd = self.position_sizer.size(self.paper_executor.nav, self.paper_executor.cash, market_exposure, decision.expected_edge, orderbook.mid_price or 1.0)
        risk_state = PortfolioRiskState(
            nav=self.paper_executor.nav,
            cash=self.paper_executor.cash,
            daily_pnl=self.state.state.daily_pnl,
            max_drawdown_pct=self.state.state.max_drawdown_pct,
            exposure_by_market=exposure_by_market,
        )
        risk = self.risk_engine.evaluate(decision, market, orderbook, risk_state, size_usd)
        result = {"decision": decision, "risk": risk, "size_usd": size_usd, "execution": None}
        self.state.state.last_decisions = [
            item for item in self.state.state.last_decisions if item.get("market_id") != market.id
        ]
        self.state.state.last_decisions.insert(
            0,
            {
                "market_id": market.id,
                "question": market.question,
                "slug": market.slug,
                "decision": decision.decision.value,
                "score": decision.final_score,
                "edge": decision.expected_edge,
                "risk_ok": risk.accepted,
                "reasons": decision.reasons + risk.reasons,
                "components": decision.components,
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
        nav = self.paper_executor.nav
        self.state.state.unrealized_pnl = round(nav - self.settings.paper_start_balance, 4)
        self.state.state.daily_pnl = self.state.state.unrealized_pnl
        self._high_water_nav = max(self._high_water_nav, nav)
        if self._high_water_nav > 0:
            self.state.state.max_drawdown_pct = round(max(0.0, (self._high_water_nav - nav) / self._high_water_nav), 6)

    def _position_exposure_by_market(self) -> dict[str, float]:
        exposure: dict[str, float] = {}
        for key, value in self.paper_executor.positions.items():
            market_id = key.removesuffix(":NO")
            exposure[market_id] = exposure.get(market_id, 0.0) + value["cost_basis"]
        return exposure

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
