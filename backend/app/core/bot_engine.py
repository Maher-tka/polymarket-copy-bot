import asyncio
import contextlib
import time

from backend.app.config import Settings
from backend.app.analytics.research_audit import ResearchAuditLog
from backend.app.data.clob_rest import ClobRestClient
from backend.app.data.clob_ws import ClobMarketWebSocket
from backend.app.data.external_probability import MetaculusProbabilityProvider, MockProbabilityProvider
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
        self.audit_log = ResearchAuditLog(settings.audit_log_dir)
        self.probability_provider = self._probability_provider(settings)
        self._loop_task: asyncio.Task | None = None
        self._markets_cache: list[Market] = []
        self._market_group_by_id: dict[str, str] = {}
        self._last_market_refresh = 0.0
        self._high_water_nav = settings.paper_start_balance
        self.market_ws = ClobMarketWebSocket(settings.stale_data_seconds, settings.websocket_heartbeat_seconds)
        self.strategies = [
            CalibrationArbitrageStrategy(settings, self.probability_provider),
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

    async def shutdown(self) -> None:
        await self.stop()
        close = getattr(self.probability_provider, "close", None)
        if close:
            await close()

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
        await self.market_ws.stop()
        self.state.state.websocket_connected = False

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
        markets = await self._active_markets()
        if not markets:
            self.state.log("No eligible live markets found yet.")
            return

        scanned = 0
        fills = 0
        ws_hits = 0
        rest_fallbacks = 0
        clob = ClobRestClient(self.settings)
        try:
            for market in markets[: self.settings.market_scan_limit]:
                if self.state.state.status != "RUNNING":
                    break
                try:
                    orderbook, source = await self._get_orderbook(clob, market)
                    if source == "websocket":
                        ws_hits += 1
                    else:
                        rest_fallbacks += 1
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
        self.state.state.rest_fallback_count = rest_fallbacks
        self.state.state.websocket_connected = self.market_ws.connected
        self.state.state.websocket_last_message_age_seconds = self._websocket_message_age()
        self.state.state.websocket_cached_books = len(self.market_ws.orderbooks)
        self.state.state.data_source = "websocket+rest-recovery" if ws_hits else "gamma+clob-rest"
        self.state.state.stale_data = scanned == 0
        self._sync_executor_state()
        self.state.log(
            f"Cycle {self.state.state.cycle_count}: scanned {scanned} live markets, fills {fills}, "
            f"ws {ws_hits}, rest {rest_fallbacks}."
        )

    async def _active_markets(self) -> list[Market]:
        now = time.time()
        if self._markets_cache and now - self._last_market_refresh < self.settings.market_refresh_seconds:
            self.market_ws.subscribe([market.yes_token_id for market in self._markets_cache[: self.settings.market_scan_limit]])
            await self.market_ws.start()
            return self._markets_cache

        gamma = GammaApi(self.settings)
        try:
            markets = await gamma.active_markets(limit=self.settings.market_discovery_limit)
        finally:
            await gamma.close()

        self._markets_cache = markets
        self._market_group_by_id = {market.id: market.correlation_group or "uncategorized" for market in markets}
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
                "correlation_group": market.correlation_group,
            }
            for market in markets
        ]
        with session_scope() as session:
            MarketRepository(session).upsert_many(markets)
        self.market_ws.subscribe([market.yes_token_id for market in markets[: self.settings.market_scan_limit]])
        await self.market_ws.start()
        self.state.log(f"Discovered {len(markets)} eligible live markets.")
        return markets

    async def _get_orderbook(self, clob: ClobRestClient, market: Market) -> tuple[OrderBook, str]:
        cached = self.market_ws.orderbooks.get(market.yes_token_id)
        if cached and not self.market_ws.is_stale(market.yes_token_id):
            cached.no_token_id = market.no_token_id
            return cached, "websocket"
        orderbook = await clob.get_orderbook(market.yes_token_id, market.id)
        orderbook.no_token_id = market.no_token_id
        return orderbook, "rest"

    async def evaluate_market(self, market: Market, orderbook: OrderBook) -> dict:
        signals = []
        for strategy in self.strategies:
            signal = await strategy.evaluate(market, orderbook)
            if signal:
                signals.append(signal)
        decision = self.aggregator.aggregate(market.id, signals)
        exposure_by_market = self._position_exposure_by_market()
        market_exposure = exposure_by_market.get(market.id, 0.0)
        adjusted_edge, _edge_costs = self.risk_engine.cost_adjusted_edge(decision, market)
        size_usd = self.position_sizer.size(
            self.paper_executor.nav,
            self.paper_executor.cash,
            market_exposure,
            max(0.0, adjusted_edge),
            orderbook.mid_price or 1.0,
        )
        risk_state = PortfolioRiskState(
            nav=self.paper_executor.nav,
            cash=self.paper_executor.cash,
            daily_pnl=self.state.state.daily_pnl,
            max_drawdown_pct=self.state.state.max_drawdown_pct,
            exposure_by_market=exposure_by_market,
            exposure_by_correlation_group=self._position_exposure_by_group(),
        )
        risk = self.risk_engine.evaluate(decision, market, orderbook, risk_state, size_usd)
        self.state.state.edge_costs_latest = risk.edge_costs
        self.audit_log.log_decision(market, decision, risk)
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
                "adjusted_edge": risk.adjusted_edge,
                "edge_costs": risk.edge_costs,
                "risk_ok": risk.accepted,
                "reasons": decision.reasons + risk.reasons,
                "components": decision.components,
                "correlation_group": market.correlation_group,
            },
        )
        self.state.state.last_decisions = self.state.state.last_decisions[:100]
        if risk.accepted and decision.decision in {Decision.BUY_YES, Decision.BUY_NO} and size_usd > 0:
            if self.settings.bot_mode == "PAPER":
                result["execution"] = await self.paper_executor.execute(decision, market, orderbook, size_usd)
                self._annotate_execution(result["execution"], decision, market, risk)
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
        self.state.state.positions = self._position_snapshots()
        self.state.state.trades = list(reversed(self.paper_executor.trades[-100:]))
        self.state.state.win_loss_history = self._win_loss_history()
        self.state.state.performance_summary = self._performance_summary(self.state.state.win_loss_history)
        self.state.state.audit_summary = self.audit_log.summary()
        self.state.state.blocked_reasons = list(self.circuit_breaker.blocked_reasons)
        self.state.state.websocket_connected = self.market_ws.connected
        self.state.state.websocket_last_message_age_seconds = self._websocket_message_age()
        self.state.state.websocket_cached_books = len(self.market_ws.orderbooks)
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

    def _position_exposure_by_group(self) -> dict[str, float]:
        exposure: dict[str, float] = {}
        for key, value in self.paper_executor.positions.items():
            market_id = key.removesuffix(":NO")
            group = self._market_group_by_id.get(market_id)
            if not group:
                continue
            exposure[group] = exposure.get(group, 0.0) + value["cost_basis"]
        return exposure

    def _position_snapshots(self) -> list[dict]:
        snapshots = []
        for key, value in self.paper_executor.positions.items():
            cost_basis = float(value.get("cost_basis", 0.0))
            market_value = float(value.get("market_value", 0.0))
            pnl = float(value.get("unrealized_pnl", market_value - cost_basis - float(value.get("fees_paid", 0.0))))
            snapshots.append(
                {
                    "market_id": key,
                    **value,
                    "unrealized_pnl": round(pnl, 4),
                    "pnl_pct": round(pnl / cost_basis, 4) if cost_basis else 0.0,
                    "win_loss": value.get("win_loss") or classify_pnl(pnl),
                }
            )
        return sorted(snapshots, key=lambda item: item.get("opened_at", 0), reverse=True)

    def _win_loss_history(self) -> list[dict]:
        history = []
        for position in self._position_snapshots():
            history.append(
                {
                    "type": "OPEN_POSITION",
                    "status": position.get("win_loss", "BREAKEVEN"),
                    "market_id": position["market_id"],
                    "question": position.get("question") or position["market_id"],
                    "side": position.get("side"),
                    "shares": position.get("shares", 0.0),
                    "avg_price": position.get("avg_price", 0.0),
                    "current_price": position.get("current_price", 0.0),
                    "cost_basis": position.get("cost_basis", 0.0),
                    "market_value": position.get("market_value", 0.0),
                    "pnl": position.get("unrealized_pnl", 0.0),
                    "pnl_pct": position.get("pnl_pct", 0.0),
                    "opened_at": position.get("opened_at"),
                    "last_updated_at": position.get("last_updated_at"),
                }
            )
        return history[:100]

    def _performance_summary(self, history: list[dict]) -> dict:
        wins = [item for item in history if item.get("status") == "WIN"]
        losses = [item for item in history if item.get("status") == "LOSS"]
        breakeven = [item for item in history if item.get("status") == "BREAKEVEN"]
        total_pnl = sum(float(item.get("pnl", 0.0)) for item in history)
        largest_win = max((float(item.get("pnl", 0.0)) for item in wins), default=0.0)
        largest_loss = min((float(item.get("pnl", 0.0)) for item in losses), default=0.0)
        decided = len(wins) + len(losses)
        return {
            "open_wins": len(wins),
            "open_losses": len(losses),
            "open_breakeven": len(breakeven),
            "open_win_rate": round(len(wins) / decided, 4) if decided else 0.0,
            "open_unrealized_pnl": round(total_pnl, 4),
            "largest_open_win": round(largest_win, 4),
            "largest_open_loss": round(largest_loss, 4),
        }

    def _websocket_message_age(self) -> float | None:
        if not self.market_ws.last_message_at:
            return None
        return round(max(0.0, time.time() - self.market_ws.last_message_at), 3)

    def _annotate_execution(self, execution: dict | None, decision, market: Market, risk) -> None:
        if not execution or not execution.get("trade"):
            return
        trade = execution["trade"]
        trade["signal_source"] = primary_signal(decision.components)
        trade["adjusted_edge"] = risk.adjusted_edge
        trade["question"] = market.question
        trade["correlation_group"] = market.correlation_group

    def _record_paper_trade(self, execution: dict | None, decision) -> None:
        if not execution or execution.get("status") not in {"FILLED", "PARTIAL"}:
            return
        trade = execution.get("trade") or {}
        self.audit_log.log_trade(trade)
        with session_scope() as session:
            TradeRepository(session).record_trade(
                TradeModel(
                    mode="PAPER",
                    market_id=trade["market_id"],
                    side=trade["decision"],
                    price=trade["avg_price"],
                    size_usd=trade["size_usd"],
                    shares=trade["shares"],
                    signal_source=trade.get("signal_source") or ",".join(sorted(decision.components.keys())) or "aggregator",
                )
            )

    def _probability_provider(self, settings: Settings):
        if settings.external_probability_provider == "metaculus":
            self.state.log("Using cached Metaculus external probability provider.")
            return MetaculusProbabilityProvider(settings)
        return MockProbabilityProvider()


def primary_signal(components: dict[str, float]) -> str:
    if not components:
        return "aggregator"
    return max(components.items(), key=lambda item: abs(item[1]))[0]


def classify_pnl(pnl: float) -> str:
    if pnl > 0.01:
        return "WIN"
    if pnl < -0.01:
        return "LOSS"
    return "BREAKEVEN"
