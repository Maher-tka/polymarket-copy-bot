import asyncio
import contextlib
import json
import time
from collections import deque
from collections.abc import Awaitable, Callable

import websockets

from backend.app.logging_config import logger
from backend.app.strategy.signal_types import OrderBook, OrderBookLevel

MARKET_WS_URL = "wss://ws-subscriptions-clob.polymarket.com/ws/market"


class ClobMarketWebSocket:
    def __init__(self, stale_data_seconds: int, heartbeat_seconds: int = 10) -> None:
        self.stale_data_seconds = stale_data_seconds
        self.heartbeat_seconds = heartbeat_seconds
        self.orderbooks: dict[str, OrderBook] = {}
        self.token_ids: set[str] = set()
        self.connected = False
        self.last_message_at = 0.0
        self.last_stale_reason = "not_connected"
        self._task: asyncio.Task | None = None
        self._subscription_version = 0
        self._trade_flow: dict[str, deque[tuple[str, float]]] = {}

    def subscribe(self, token_ids: list[str]) -> None:
        before = len(self.token_ids)
        self.token_ids.update(x for x in token_ids if x)
        if len(self.token_ids) != before:
            self._subscription_version += 1

    async def start(self, on_update: Callable[[OrderBook], Awaitable[None]] | None = None) -> None:
        if self._task and not self._task.done():
            return
        self._task = asyncio.create_task(self._run(on_update))

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._task
        self.connected = False

    def is_stale(self, token_id: str) -> bool:
        book = self.orderbooks.get(token_id)
        return book is None or time.time() - book.updated_at > self.stale_data_seconds

    def stale_reason(self, token_id: str) -> str | None:
        book = self.orderbooks.get(token_id)
        if book is None:
            return "missing_orderbook"
        age = time.time() - book.updated_at
        if age > self.stale_data_seconds:
            return f"stale_orderbook_age_seconds={age:.2f}"
        return None

    async def _run(self, on_update: Callable[[OrderBook], Awaitable[None]] | None) -> None:
        while True:
            try:
                async with websockets.connect(MARKET_WS_URL, ping_interval=10, ping_timeout=10) as ws:
                    self.connected = True
                    self.last_stale_reason = ""
                    sent_subscription_version = -1
                    heartbeat_task = asyncio.create_task(self._heartbeat(ws))
                    try:
                        while True:
                            if self.token_ids and sent_subscription_version != self._subscription_version:
                                await ws.send(
                                    json.dumps(
                                        {
                                            "type": "market",
                                            "assets_ids": sorted(self.token_ids),
                                            "custom_feature_enabled": True,
                                        }
                                    )
                                )
                                sent_subscription_version = self._subscription_version
                            try:
                                message = await asyncio.wait_for(ws.recv(), timeout=1)
                            except TimeoutError:
                                continue
                            if message == "PONG":
                                continue
                            self.last_message_at = time.time()
                            for update in parse_trade_updates(message):
                                self._record_trade_flow(update["asset_id"], update["side"], update["size"])
                                if update["asset_id"] in self.orderbooks and update.get("price") is not None:
                                    self.orderbooks[update["asset_id"]].last_trade_price = update["price"]
                                    self.orderbooks[update["asset_id"]].last_event_type = update["event_type"]
                            for book in parse_market_message(message):
                                self._attach_trade_flow(book)
                                self.orderbooks[book.yes_token_id] = book
                                if on_update:
                                    await on_update(book)
                    finally:
                        heartbeat_task.cancel()
                        with contextlib.suppress(asyncio.CancelledError):
                            await heartbeat_task
                    self.connected = False
                    self.last_stale_reason = "websocket_closed"
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                self.connected = False
                self.last_stale_reason = str(exc)
                logger.warning("CLOB market websocket reconnecting after error: %s", exc)
                await asyncio.sleep(2)

    async def _heartbeat(self, ws) -> None:
        while True:
            await asyncio.sleep(self.heartbeat_seconds)
            await ws.send(json.dumps({"type": "ping"}))

    def _record_trade_flow(self, token_id: str, side: str, size: float) -> None:
        if not token_id or size <= 0:
            return
        if token_id not in self._trade_flow:
            self._trade_flow[token_id] = deque(maxlen=40)
        self._trade_flow[token_id].append((side.upper(), size))

    def _attach_trade_flow(self, book: OrderBook) -> None:
        history = self._trade_flow.get(book.yes_token_id)
        if not history:
            return
        buy_volume = sum(size for side, size in history if side in {"BUY", "BID"})
        sell_volume = sum(size for side, size in history if side in {"SELL", "ASK"})
        total = buy_volume + sell_volume
        if total <= 0:
            return
        book.trade_flow_imbalance = round((buy_volume - sell_volume) / total, 4)
        book.recent_trade_count = len(history)


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
        event_type = str(item.get("event_type") or item.get("type") or "")
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
                last_event_type=event_type or None,
            )
        )
    return books


def parse_trade_updates(message: str) -> list[dict]:
    try:
        raw = json.loads(message)
    except json.JSONDecodeError:
        return []
    records = raw if isinstance(raw, list) else [raw]
    updates: list[dict] = []
    for item in records:
        if not isinstance(item, dict):
            continue
        event_type = str(item.get("event_type") or item.get("type") or "")
        if event_type not in {"last_trade_price", "trade"}:
            continue
        asset_id = str(item.get("asset_id") or item.get("assetId") or item.get("market") or "")
        side = str(item.get("side") or item.get("taker_side") or item.get("aggressor_side") or "").upper()
        size = safe_float(first_present(item, "size", "amount", "matched_amount", "shares")) or 0.0
        price = safe_float(first_present(item, "price", "last_trade_price", "lastTradePrice"))
        if asset_id and side and size > 0:
            updates.append({"asset_id": asset_id, "side": side, "size": size, "price": price, "event_type": event_type})
    return updates


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
