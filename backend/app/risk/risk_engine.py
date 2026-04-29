import time
from dataclasses import dataclass

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


@dataclass(slots=True)
class RiskDecision:
    accepted: bool
    reasons: list[str]


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
        if self.circuit_breaker.emergency_stop:
            reasons.append("Emergency stop is active.")
        if self.circuit_breaker.paused:
            reasons.append("Bot is paused.")
        if decision.decision == Decision.HOLD:
            reasons.append("Signal aggregator decision is HOLD.")
        if decision.final_score < self.settings.final_score_threshold:
            reasons.append("Final score is below configured threshold.")
        if decision.expected_edge < self.settings.min_expected_edge:
            reasons.append("Expected edge is below minimum.")
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
        if portfolio.cash - order_size < portfolio.nav * self.settings.cash_reserve_pct:
            reasons.append("Cash reserve would be violated.")
        return RiskDecision(not reasons, reasons)
