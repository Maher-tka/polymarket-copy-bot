import time

import httpx

from backend.app.config import Settings
from backend.app.strategy.signal_types import Market


class GammaApi:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.client = httpx.AsyncClient(base_url=settings.gamma_api_base, timeout=15)

    async def close(self) -> None:
        await self.client.aclose()

    async def active_markets(self, limit: int = 100) -> list[Market]:
        response = await self.client.get("/markets", params={"active": "true", "closed": "false", "limit": limit})
        response.raise_for_status()
        raw = response.json()
        items = raw if isinstance(raw, list) else raw.get("markets", [])
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
            )
            if market.liquidity >= self.settings.min_liquidity and market.volume >= self.settings.min_volume:
                if market.end_ts and market.end_ts - time.time() < self.settings.market_close_buffer_minutes * 60:
                    continue
                markets.append(market)
        return markets


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
