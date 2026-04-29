import time
from dataclasses import dataclass, field

from backend.app.config import Settings
from backend.app.risk.circuit_breaker import CircuitBreaker
from backend.app.strategy.signal_types import AggregatedDecision, Decision, Market, OrderBook


@dataclass(slots=True)
class PortfolioRiskState:
    nav: float
    cash: float
    daily_pnl: float = 0.0
    max_drawdown_pct: float = 0.0
    exposure_by_market: dict[str, float] | None = None
    exposure_by_correlation_group: dict[str, float] | None = None


@dataclass(slots=True)
class RiskDecision:
    accepted: bool
    reasons: list[str]
    adjusted_edge: float = 0.0
    edge_costs: dict[str, float] = field(default_factory=dict)


class RiskEngine:
    def __init__(self, settings: Settings, circuit_breaker: CircuitBreaker | None = None) -> None:
        self.settings = settings
        self.circuit_breaker = circuit_breaker or CircuitBreaker()

    def evaluate(
        self,
        decision: AggregatedDecision,
        market: Market,
        orderbook: OrderBook,
        portfolio: PortfolioRiskState,
        order_size: float,
    ) -> RiskDecision:
        reasons: list[str] = []
        adjusted_edge, edge_costs = self.cost_adjusted_edge(decision, market)
        if self.circuit_breaker.emergency_stop:
            reasons.append("Emergency stop is active.")
        if self.circuit_breaker.paused:
            reasons.append("Bot is paused.")
        if decision.decision == Decision.HOLD:
            reasons.append("Signal aggregator decision is HOLD.")
        score_threshold = self.settings.final_score_threshold
        if self.settings.bot_mode == "REAL":
            score_threshold = max(score_threshold, 0.65)
        if decision.final_score < score_threshold:
            reasons.append("Final score is below configured threshold.")
        if decision.expected_edge < self.settings.min_expected_edge:
            reasons.append("Expected edge is below minimum.")
        if adjusted_edge < self.settings.min_expected_edge:
            reasons.append("Cost-adjusted edge is below minimum after fees, slippage, and capital lock-up.")
        if market.liquidity < self.settings.min_liquidity:
            reasons.append("Market liquidity is below MIN_LIQUIDITY.")
        if market.volume < self.settings.min_volume:
            reasons.append("Market volume is below MIN_VOLUME.")
        if orderbook.spread > self.settings.max_spread:
            reasons.append("Bid/ask spread is above MAX_SPREAD_CENTS.")
        if market.end_ts and market.end_ts - time.time() < self.settings.market_close_buffer_minutes * 60:
            reasons.append("Market is too close to resolution.")
        if time.time() - orderbook.updated_at > self.settings.stale_data_seconds:
            reasons.append("Orderbook data is stale.")
        if portfolio.daily_pnl <= -portfolio.nav * self.settings.max_daily_loss_pct:
            reasons.append("Daily loss limit hit.")
        if portfolio.max_drawdown_pct >= self.settings.max_total_drawdown_pct:
            reasons.append("Total drawdown limit hit.")
        market_exposure = (portfolio.exposure_by_market or {}).get(market.id, 0.0)
        if market_exposure + order_size > portfolio.nav * self.settings.max_market_nav_pct:
            reasons.append("Per-market exposure limit hit.")
        active_market_count = len([value for value in (portfolio.exposure_by_market or {}).values() if value > 0])
        if market_exposure <= 0 and active_market_count >= self.settings.max_open_markets:
            reasons.append("Max open markets limit hit.")
        group_exposure = (portfolio.exposure_by_correlation_group or {}).get(market.correlation_group or "", 0.0)
        if market.correlation_group and group_exposure + order_size > portfolio.nav * self.settings.max_correlated_nav_pct:
            reasons.append("Correlated exposure limit hit.")
        if portfolio.cash - order_size < portfolio.nav * self.settings.cash_reserve_pct:
            reasons.append("Cash reserve would be violated.")
        return RiskDecision(not reasons, reasons, round(adjusted_edge, 4), edge_costs)

    def cost_adjusted_edge(self, decision: AggregatedDecision, market: Market) -> tuple[float, dict[str, float]]:
        slippage_cost = self.settings.slippage_bps / 10_000
        fee_cost = self.settings.estimated_fee_bps / 10_000
        resolution_cost = self.settings.resolution_fee_pct
        capital_cost = self._capital_lockup_cost(market)
        total_cost = slippage_cost + fee_cost + resolution_cost + capital_cost
        costs = {
            "raw_edge": round(decision.expected_edge, 4),
            "fees": round(fee_cost, 4),
            "slippage": round(slippage_cost, 4),
            "resolution_fee": round(resolution_cost, 4),
            "capital_lockup": round(capital_cost, 4),
            "total_cost": round(total_cost, 4),
        }
        return decision.expected_edge - total_cost, costs

    def _capital_lockup_cost(self, market: Market) -> float:
        if not market.end_ts:
            return 0.0
        seconds_to_resolution = max(0.0, market.end_ts - time.time())
        return self.settings.annual_capital_cost_pct * (seconds_to_resolution / 31_536_000)
