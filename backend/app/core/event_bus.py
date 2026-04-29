import asyncio
from collections import defaultdict
from collections.abc import Awaitable, Callable
from typing import Any


Handler = Callable[[dict[str, Any]], Awaitable[None]]


class EventBus:
    def __init__(self) -> None:
        self.handlers: dict[str, list[Handler]] = defaultdict(list)

    def subscribe(self, topic: str, handler: Handler) -> None:
        self.handlers[topic].append(handler)

    async def publish(self, topic: str, payload: dict[str, Any]) -> None:
        await asyncio.gather(*(handler(payload) for handler in self.handlers.get(topic, [])), return_exceptions=True)
