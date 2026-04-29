import time
from dataclasses import dataclass


@dataclass(slots=True)
class ManagedOrder:
    id: str
    market_id: str
    price: float
    size_usd: float
    created_at: float
    status: str = "OPEN"


class OrderManager:
    def __init__(self, max_order_age_seconds: int, cooldown_seconds: int) -> None:
        self.max_order_age_seconds = max_order_age_seconds
        self.cooldown_seconds = cooldown_seconds
        self.orders: dict[str, ManagedOrder] = {}
        self.last_order_by_market: dict[str, float] = {}

    def can_place(self, market_id: str) -> bool:
        return time.time() - self.last_order_by_market.get(market_id, 0.0) >= self.cooldown_seconds

    def add(self, order: ManagedOrder) -> None:
        self.orders[order.id] = order
        self.last_order_by_market[order.market_id] = time.time()

    def stale_orders(self) -> list[ManagedOrder]:
        now = time.time()
        return [order for order in self.orders.values() if order.status == "OPEN" and now - order.created_at > self.max_order_age_seconds]
