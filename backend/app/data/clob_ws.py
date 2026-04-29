import asyncio
import json
import time
from collections.abc import Awaitable, Callable

import websockets

from backend.app.logging_config import logger
from backend.app.strategy.signal_types import OrderBook, OrderBookLevel

MARKET_WS_URL = "wss://ws-subscriptions-clob.polymarket.com/ws/market"


class ClobMarketWebSocket:
    def __init__(self, stale_data_seconds: int) -> None:
        self.stale_data_seconds = stale_data_seconds
        self.orderbooks: dict[str, OrderBook] = {}
        self.token_ids: set[str] = set()
        self.connected = False
        self.last_message_at = 0.0
        self._task: asyncio.Task | None = None

    def subscribe(self, token_ids: list[str]) -> None:
        self.token_ids.update(x for x in token_ids if x)

    async def start(self, on_update: Callable[[OrderBook], Awaitable[None]] | None = None) -> None:
        if self._task and not self._task.done():
            return
        self._task = asyncio.create_task(self._run(on_update))

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()

    def is_stale(self, token_id: str) -> bool:
        book = self.orderbooks.get(token_id)
        return book is None or time.time() - book.updated_at > self.stale_data_seconds

    async def _run(self, on_update: Callable[[OrderBook], Awaitable[None]] | None) -> None:
        while True:
            try:
                async with websockets.connect(MARKET_WS_URL, ping_interval=10, ping_timeout=10) as ws:
                    self.connected = True
                    if self.token_ids:
                        await ws.send(json.dumps({"type": "market", "assets_ids": list(self.token_ids), "custom_feature_enabled": True}))
                    async for message in ws:
                        if message == "PONG":
                            continue
                        self.last_message_at = time.time()
                        for book in parse_market_message(message):
                            self.orderbooks[book.yes_token_id] = book
                            if on_update:
                                await on_update(book)
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                self.connected = False
                logger.warning("CLOB market websocket reconnecting after error: %s", exc)
                await asyncio.sleep(2)


def parse_market_message(message: str) -> list[OrderBook]:
    try:
        raw = json.loads(message)
    except json.JSONDecodeError:
        return []
    records = raw if isinstance(raw, list) else [raw]
    books: list[OrderBook] = []
    for item in records:
        if not isinstance(item, dict):
            continue
        asset_id = str(item.get("asset_id") or item.get("assetId") or "")
        best_bid = first_present(item, "best_bid", "bestBid", "bid")
        best_ask = first_present(item, "best_ask", "bestAsk", "ask")
        bids = item.get("bids")
        asks = item.get("asks")
        if bids is None and best_bid is not None:
            bids = [{"price": best_bid, "size": item.get("bid_size") or item.get("bidSize") or 0}]
        if asks is None and best_ask is not None:
            asks = [{"price": best_ask, "size": item.get("ask_size") or item.get("askSize") or 0}]
        if not asset_id or (bids is None and asks is None):
            continue
        last_trade = first_present(item, "last_trade_price", "lastTradePrice", "price")
        books.append(
            OrderBook(
                market_id=str(item.get("market") or item.get("condition_id") or asset_id),
                yes_token_id=asset_id,
                bids=parse_levels(bids or []),
                asks=parse_levels(asks or []),
                last_trade_price=safe_float(last_trade),
                updated_at=time.time(),
                source="websocket",
            )
        )
    return books


def first_present(item: dict, *keys: str):
    for key in keys:
        if key in item and item[key] is not None:
            return item[key]
    return None


def parse_levels(levels: list[dict]) -> list[OrderBookLevel]:
    parsed: list[OrderBookLevel] = []
    for level in levels:
        if isinstance(level, dict):
            raw_price = level.get("price")
            raw_size = level.get("size")
        elif isinstance(level, (list, tuple)) and len(level) >= 2:
            raw_price, raw_size = level[0], level[1]
        else:
            continue
        price = safe_float(raw_price)
        size = safe_float(raw_size) or 0.0
        if price is not None:
            parsed.append(OrderBookLevel(price, size))
    return parsed


def safe_float(value) -> float | None:
    if value in (None, ""):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


class ClobUserWebSocket:
    async def start(self) -> None:
        raise RuntimeError("User websocket requires REAL mode credentials and is disabled by default.")
