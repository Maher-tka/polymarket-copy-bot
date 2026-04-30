import time
from collections import defaultdict
import re

import httpx

from backend.app.config import Settings
from backend.app.risk.correlation import infer_correlation_group
from backend.app.strategy.signal_types import Market


class GammaApi:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.client = httpx.AsyncClient(base_url=settings.gamma_api_base, timeout=15)

    async def close(self) -> None:
        await self.client.aclose()

    async def active_markets(self, limit: int = 100) -> list[Market]:
        items = await self._fetch_market_pool(limit)
        markets: list[Market] = []
        for item in items:
            tokens = parse_jsonish_list(item.get("clobTokenIds"))
            outcomes = parse_jsonish_list(item.get("outcomes"))
            if len(tokens) < 1 or not item.get("conditionId"):
                continue
            end_ts = parse_ts(item.get("endDateIso") or item.get("endDate") or item.get("endDateTime"))
            market = Market(
                id=item["conditionId"],
                question=item.get("question") or item.get("title") or item["conditionId"],
                slug=item.get("slug"),
                yes_token_id=str(tokens[0]),
                no_token_id=str(tokens[1]) if len(tokens) > 1 else None,
                liquidity=float(item.get("liquidityNum") or item.get("liquidity") or 0),
                volume=float(item.get("volumeNum") or item.get("volume") or item.get("volume24hr") or 0),
                end_ts=end_ts,
                active=item.get("active") is not False,
                correlation_group=infer_correlation_group(
                    item.get("question") or item.get("title") or item["conditionId"],
                    item.get("slug"),
                ),
                research_bucket=infer_research_bucket(item.get("question") or item.get("title") or "", item.get("slug")),
            )
            if should_include_market(market, self.settings):
                if market.end_ts and market.end_ts - time.time() < self.settings.market_close_buffer_minutes * 60:
                    continue
                markets.append(market)
        allowed_buckets = parse_csv(self.settings.market_allowed_buckets)
        markets = [market for market in markets if not allowed_buckets or market.research_bucket in allowed_buckets]
        return diversify_markets(markets, self.settings.market_bucket_order, self.settings.market_focus_keywords)

    async def _fetch_market_pool(self, limit: int) -> list[dict]:
        pool: list[dict] = []
        seen: set[str] = set()
        page_size = min(100, max(1, limit))
        for offset in range(0, limit, page_size):
            response = await self.client.get(
                "/markets",
                params={
                    "active": "true",
                    "closed": "false",
                    "limit": page_size,
                    "offset": offset,
                    "order": "volume",
                    "ascending": "false",
                },
            )
            response.raise_for_status()
            raw = response.json()
            items = raw if isinstance(raw, list) else raw.get("markets", [])
            if not items:
                break
            for item in items:
                market_id = item.get("conditionId") or item.get("id") or item.get("slug")
                if not market_id or market_id in seen:
                    continue
                seen.add(market_id)
                pool.append(item)
            if len(items) < page_size:
                break
        return pool


def diversify_markets(markets: list[Market], bucket_order: str, focus_keywords: str = "") -> list[Market]:
    grouped: dict[str, list[Market]] = defaultdict(list)
    for market in markets:
        grouped[market.research_bucket].append(market)
    for bucket_markets in grouped.values():
        bucket_markets.sort(
            key=lambda market: (is_focus_market(market, focus_keywords), market.volume, market.liquidity),
            reverse=True,
        )

    ordered_buckets = [bucket.strip() for bucket in bucket_order.split(",") if bucket.strip()]
    ordered_buckets.extend(bucket for bucket in grouped if bucket not in ordered_buckets)
    diversified: list[Market] = []
    while True:
        added = False
        for bucket in ordered_buckets:
            if grouped.get(bucket):
                diversified.append(grouped[bucket].pop(0))
                added = True
        if not added:
            return diversified


def infer_research_bucket(question: str, slug: str | None = None) -> str:
    text = f"{question} {slug or ''}".lower()
    if any(word in text for word in ("weather", "temperature", "rain", "snow", "hurricane", "storm", "heat", "cold")):
        return "weather"
    if has_any_token(text, ("bitcoin", "btc", "ethereum", "eth", "solana", "sol", "crypto")):
        if any(word in text for word in ("below", "under", "fall", "drop", "crash", "down", "lower")):
            return "crypto_down"
        if any(word in text for word in ("above", "over", "rise", "rally", "up", "higher", "hit", "reach")):
            return "crypto_up"
        return "crypto_fear"
    if any(word in text for word in ("nba", "nfl", "nhl", "mlb", "fifa", "cup", "finals", "championship")):
        return "sports"
    if any(word in text for word in ("trump", "election", "president", "senate", "house", "government")):
        return "politics"
    return "general"


def has_any_token(text: str, tokens: tuple[str, ...]) -> bool:
    return any(re.search(rf"(^|[^a-z0-9]){re.escape(token)}([^a-z0-9]|$)", text) for token in tokens)


def is_focus_market(market: Market, focus_keywords: str) -> bool:
    text = f"{market.question} {market.slug or ''}".lower()
    return any(keyword.strip().lower() in text for keyword in focus_keywords.split(",") if keyword.strip())


def should_include_market(market: Market, settings: Settings) -> bool:
    if market.liquidity >= settings.min_liquidity and market.volume >= settings.min_volume:
        return True
    if not is_focus_market(market, settings.market_focus_keywords):
        return False
    return market.liquidity >= settings.learning_min_liquidity and market.volume >= settings.learning_min_volume


def parse_csv(value: str) -> set[str]:
    return {item.strip() for item in value.split(",") if item.strip()}


def parse_jsonish_list(value) -> list[str]:
    if isinstance(value, list):
        return [str(x) for x in value]
    if not value:
        return []
    import json

    try:
        parsed = json.loads(value)
        return [str(x) for x in parsed]
    except Exception:
        return []


def parse_ts(value) -> float | None:
    if not value:
        return None
    from datetime import datetime

    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")).timestamp()
    except Exception:
        return time.time() + 86400
