import asyncio
from collections.abc import Awaitable, Callable


class Scheduler:
    def __init__(self) -> None:
        self.tasks: list[asyncio.Task] = []

    def every(self, seconds: float, fn: Callable[[], Awaitable[None]]) -> None:
        async def loop() -> None:
            while True:
                await fn()
                await asyncio.sleep(seconds)

        self.tasks.append(asyncio.create_task(loop()))

    async def stop(self) -> None:
        for task in self.tasks:
            task.cancel()
        await asyncio.gather(*self.tasks, return_exceptions=True)
        self.tasks.clear()
