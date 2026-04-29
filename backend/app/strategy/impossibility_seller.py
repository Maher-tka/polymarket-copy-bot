import re
import time
from dataclasses import dataclass

from backend.app.config import Settings
from backend.app.data.price_feed import PriceFeed
from backend.app.strategy.base import Strategy
from backend.app.strategy.signal_types import Market, OrderBook, Signal


WARNING_TEXT = "High win-rate strategy with rare catastrophic loss risk. One loss can erase many small wins."


@dataclass(slots=True)
class FearSellerCandidate:
    market_id: str
    question: str
    status: str
    reason: str
    edge: float = 0.0
    score: float = 0.0
    expiry_days: float | None = None
    target_price: float | None = None
    current_spot_price: float | None = None
    estimated_disaster_probability: float | None = None
    estimated_no_probability: float | None = None
    no_price: float | None = None
    bucket: str | None = None

    def to_dict(self) -> dict:
        return {
            "market_id": self.market_id,
            "question": self.question,
            "status": self.status,
            "reason": self.reason,
            "edge": round(self.edge, 6),
            "score": round(self.score, 2),
            "expiry_days": round(self.expiry_days, 2) if self.expiry_days is not None else None,
            "target_price": self.target_price,
            "current_spot_price": self.current_spot_price,
            "estimated_disaster_probability": (
                round(self.estimated_disaster_probability, 6)
                if self.estimated_disaster_probability is not None
                else None
            ),
            "estimated_no_probability": (
                round(self.estimated_no_probability, 6) if self.estimated_no_probability is not None else None
            ),
            "no_price": round(self.no_price, 6) if self.no_price is not None else None,
            "bucket": self.bucket,
        }


class ImpossibilitySellerStrategy(Strategy):
    name = "impossibility_seller"
    display_name = "Fear Seller"

    def __init__(self, settings: Settings, price_feed: PriceFeed) -> None:
        self.settings = settings
        self.price_feed = price_feed
        self.last_candidates: list[dict] = []

    async def evaluate(self, market: Market, orderbook: OrderBook) -> Signal | None:
        if not self.settings.enable_impossibility_seller:
            return None

        candidate = await self._evaluate_candidate(market, orderbook)
        self._remember(candidate)
        if candidate.status != "ACCEPTED":
            return None

        assert candidate.estimated_no_probability is not None
        assert candidate.no_price is not None
        return Signal(
            strategy=self.name,
            market_id=market.id,
            side="NO",
            score=candidate.score / 100,
            expected_edge=candidate.edge,
            confidence=min(1.0, candidate.score / 100),
            reasons=[candidate.reason, WARNING_TEXT],
            metadata={
                "display_name": self.display_name,
                "execution_style": "maker_limit",
                "order_type": "LIMIT",
                "post_only": True,
                "maker_price": maker_limit_price_for_no(orderbook),
                "bucket": candidate.bucket,
                "target_price": candidate.target_price,
                "current_spot_price": candidate.current_spot_price,
                "estimated_disaster_probability": candidate.estimated_disaster_probability,
                "estimated_no_probability": candidate.estimated_no_probability,
                "no_price": candidate.no_price,
                "score_100": candidate.score,
                "warning": WARNING_TEXT,
            },
        )

    def summary(self, positions: list[dict] | None = None, nav: float = 0.0) -> dict:
        positions = positions or []
        fear_positions = [item for item in positions if item.get("strategy") == self.name]
        bucket_exposure: dict[str, float] = {}
        total_exposure = 0.0
        for position in fear_positions:
            exposure = float(position.get("cost_basis", 0.0))
            total_exposure += exposure
            bucket = str(position.get("bucket") or fear_bucket(position.get("question", "")))
            bucket_exposure[bucket] = round(bucket_exposure.get(bucket, 0.0) + exposure, 4)
        return {
            "enabled": self.settings.enable_impossibility_seller,
            "name": self.display_name,
            "warning": WARNING_TEXT,
            "total_exposure": round(total_exposure, 4),
            "total_exposure_pct": round(total_exposure / nav, 6) if nav else 0.0,
            "bucket_exposure": bucket_exposure,
            "open_positions": len(fear_positions),
            "candidate_markets": self.last_candidates[:20],
        }

    async def _evaluate_candidate(self, market: Market, orderbook: OrderBook) -> FearSellerCandidate:
        base = {
            "market_id": market.id,
            "question": market.question,
            "bucket": fear_bucket(market.question),
        }
        if self.settings.bot_mode == "REAL" and not self.price_feed.is_live:
            return FearSellerCandidate(**base, status="REJECTED", reason="REAL mode requires a live external price feed.")
        if market.liquidity < self.settings.imp_min_liquidity:
            return FearSellerCandidate(**base, status="REJECTED", reason="Liquidity below Fear Seller minimum.")
        if market.volume < self.settings.imp_min_volume:
            return FearSellerCandidate(**base, status="REJECTED", reason="Volume below Fear Seller minimum.")
        if time.time() - orderbook.updated_at > self.settings.stale_data_seconds:
            return FearSellerCandidate(**base, status="REJECTED", reason="Orderbook data is stale.")
        if orderbook.spread > self.settings.imp_max_spread:
            return FearSellerCandidate(**base, status="REJECTED", reason="Spread is wider than Fear Seller limit.")
        if self.settings.imp_require_crypto_only and not contains_keyword(market.question, self.settings.imp_allowed_keywords):
            return FearSellerCandidate(**base, status="REJECTED", reason="Market is outside allowed crypto keywords.")
        if not contains_keyword(market.question, self.settings.imp_disaster_keywords):
            return FearSellerCandidate(**base, status="REJECTED", reason="Market does not look like a fear/disaster setup.")

        expiry_days = days_to_expiry(market)
        if expiry_days is None:
            return FearSellerCandidate(**base, status="REJECTED", reason="Missing market expiry.")
        if expiry_days < self.settings.imp_min_days_to_expiry or expiry_days > self.settings.imp_max_days_to_expiry:
            return FearSellerCandidate(**base, status="REJECTED", reason="Expiry is outside Fear Seller window.", expiry_days=expiry_days)

        symbol = detect_asset_symbol(market.question)
        spot = await self.price_feed.spot_price(symbol) if symbol else None
        target = parse_target_price(market.question)
        if not symbol or spot is None or target is None:
            return FearSellerCandidate(**base, status="REJECTED", reason="Could not estimate spot/target price.", expiry_days=expiry_days)

        distance = distance_pct(spot, target)
        if target >= spot and contains_keyword(market.question, "hit,reach"):
            return FearSellerCandidate(
                **base,
                status="REJECTED",
                reason="Target is above spot, not a downside fear setup.",
                expiry_days=expiry_days,
                target_price=target,
                current_spot_price=spot,
            )

        no_price = no_best_ask(orderbook)
        if no_price is None:
            return FearSellerCandidate(**base, status="REJECTED", reason="NO ask price is unavailable.")
        if no_price < self.settings.imp_min_high_prob_price or no_price > self.settings.imp_max_high_prob_price:
            return FearSellerCandidate(
                **base,
                status="REJECTED",
                reason="NO price is outside high-probability band.",
                expiry_days=expiry_days,
                target_price=target,
                current_spot_price=spot,
                no_price=no_price,
            )

        yes_price = orderbook.mid_price if orderbook.mid_price is not None else max(0.0, 1 - no_price)
        estimated_disaster = heuristic_disaster_probability(yes_price, distance, expiry_days)
        estimated_no = 1 - estimated_disaster
        edge = estimated_no - no_price
        score = fear_seller_score(edge, distance, expiry_days, market.liquidity, orderbook, self.settings)
        status = "ACCEPTED" if edge >= self.settings.imp_min_edge and score >= self.settings.imp_min_score else "REJECTED"
        reason = (
            f"Fear Seller edge {edge:.2%}, score {score:.0f}, target distance {distance:.1%}."
            if status == "ACCEPTED"
            else "Fear Seller edge or score below threshold."
        )
        return FearSellerCandidate(
            **base,
            status=status,
            reason=reason,
            edge=edge,
            score=score,
            expiry_days=expiry_days,
            target_price=target,
            current_spot_price=spot,
            estimated_disaster_probability=estimated_disaster,
            estimated_no_probability=estimated_no,
            no_price=no_price,
        )

    def _remember(self, candidate: FearSellerCandidate) -> None:
        self.last_candidates = [item for item in self.last_candidates if item.get("market_id") != candidate.market_id]
        self.last_candidates.insert(0, candidate.to_dict())
        self.last_candidates = self.last_candidates[:50]


def parse_target_price(question: str) -> float | None:
    money_match = re.search(r"\$\s*([0-9]+(?:,[0-9]{3})*(?:\.\d+)?|[0-9]+(?:\.\d+)?)\s*([kKmM])?", question)
    if money_match:
        return apply_suffix(money_match.group(1), money_match.group(2))
    compact_match = re.search(r"\b([0-9]+(?:\.\d+)?)\s*([kKmM])\b", question)
    if compact_match:
        return apply_suffix(compact_match.group(1), compact_match.group(2))
    numbers = [float(value.replace(",", "")) for value in re.findall(r"\b\d{4,7}(?:,\d{3})*\b", question)]
    realistic = [number for number in numbers if number >= 100]
    return realistic[0] if realistic else None


def apply_suffix(value: str, suffix: str | None) -> float:
    parsed = float(value.replace(",", ""))
    if suffix and suffix.lower() == "k":
        return parsed * 1_000
    if suffix and suffix.lower() == "m":
        return parsed * 1_000_000
    return parsed


def distance_pct(current_spot: float, target: float) -> float:
    if current_spot <= 0:
        return 0.0
    return abs(current_spot - target) / current_spot


def heuristic_disaster_probability(market_yes_price: float, distance: float, expiry_days: float, volatility: float = 0.65) -> float:
    distance_discount = 1 - min(0.65, distance * 1.25)
    time_discount = 0.75 + min(0.25, expiry_days / 180)
    volatility_lift = 1 + max(0.0, volatility - 0.65) * 0.25
    adjustment = max(0.08, min(1.0, distance_discount * time_discount * volatility_lift))
    return max(0.0001, min(0.999, market_yes_price * adjustment))


def fear_seller_score(edge: float, distance: float, expiry_days: float, liquidity: float, orderbook: OrderBook, settings: Settings) -> float:
    edge_score = min(100.0, max(0.0, edge / max(settings.imp_min_edge * 6, 0.001) * 100))
    distance_score = min(100.0, distance / 0.35 * 100)
    time_score = max(0.0, min(100.0, (settings.imp_max_days_to_expiry - expiry_days) / max(settings.imp_max_days_to_expiry - settings.imp_min_days_to_expiry, 1) * 100))
    liquidity_score = min(100.0, liquidity / max(settings.imp_min_liquidity * 6, 1) * 100)
    orderbook_score = no_orderbook_score(orderbook, settings)
    return round(
        0.30 * edge_score
        + 0.25 * distance_score
        + 0.20 * time_score
        + 0.15 * liquidity_score
        + 0.10 * orderbook_score,
        2,
    )


def no_orderbook_score(orderbook: OrderBook, settings: Settings) -> float:
    spread_score = max(0.0, 1 - orderbook.spread / max(settings.imp_max_spread, 0.001)) * 100
    no_depth = sum(level.size for level in orderbook.asks[:3])
    depth_score = min(100.0, no_depth / 500 * 100)
    return 0.65 * spread_score + 0.35 * depth_score


def no_best_ask(orderbook: OrderBook) -> float | None:
    if orderbook.best_bid is None:
        return None
    return round(max(0.01, min(0.99, 1 - orderbook.best_bid)), 4)


def maker_limit_price_for_no(orderbook: OrderBook) -> float:
    if orderbook.best_ask is None:
        return 0.0
    return round(max(0.01, min(0.99, 1 - orderbook.best_ask)), 4)


def cap_fear_seller_size(
    base_size: float,
    nav: float,
    cash: float,
    market_exposure: float,
    total_exposure: float,
    bucket_exposure: float,
    no_price: float,
    settings: Settings,
) -> float:
    max_trade = nav * settings.imp_max_trade_nav_pct
    if no_price > 0.98:
        max_trade *= 0.5
    max_market = max(0.0, nav * settings.imp_max_market_nav_pct - market_exposure)
    max_total = max(0.0, nav * settings.imp_max_total_nav_pct - total_exposure)
    max_bucket = max(0.0, nav * settings.imp_max_bucket_nav_pct - bucket_exposure)
    cash_reserve = max(0.0, cash - nav * settings.cash_reserve_pct)
    return round(max(0.0, min(base_size, max_trade, max_market, max_total, max_bucket, cash_reserve)), 4)


def days_to_expiry(market: Market) -> float | None:
    if not market.end_ts:
        return None
    return max(0.0, (market.end_ts - time.time()) / 86_400)


def contains_keyword(text: str, keywords: str) -> bool:
    lowered = text.lower()
    return any(keyword.strip().lower() in lowered for keyword in keywords.split(",") if keyword.strip())


def detect_asset_symbol(question: str) -> str | None:
    lowered = question.lower()
    if "btc" in lowered or "bitcoin" in lowered:
        return "BTC"
    if "eth" in lowered or "ethereum" in lowered:
        return "ETH"
    if "sol" in lowered:
        return "SOL"
    return None


def fear_bucket(question: str) -> str:
    symbol = detect_asset_symbol(question) or "crypto"
    if contains_keyword(question, "below,under,fall,crash,drop"):
        return f"{symbol}_crash"
    return f"{symbol}_fear"
