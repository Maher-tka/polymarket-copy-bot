import time

import httpx

from backend.app.config import Settings
from backend.app.strategy.signal_types import OrderBook, OrderBookLevel


class ClobRestClient:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.client = httpx.AsyncClient(base_url=settings.polymarket_host, timeout=10)

    async def close(self) -> None:
        await self.client.aclose()

    async def get_orderbook(self, token_id: str, market_id: str | None = None) -> OrderBook:
        response = await self.client.get("/book", params={"token_id": token_id})
        response.raise_for_status()
        data = response.json()
        return OrderBook(
            market_id=market_id or data.get("market") or token_id,
            yes_token_id=data.get("asset_id") or token_id,
            bids=[OrderBookLevel(price=float(x["price"]), size=float(x["size"])) for x in data.get("bids", [])],
            asks=[OrderBookLevel(price=float(x["price"]), size=float(x["size"])) for x in data.get("asks", [])],
            last_trade_price=float(data["last_trade_price"]) if data.get("last_trade_price") else None,
            updated_at=time.time(),
            source="rest",
        )
