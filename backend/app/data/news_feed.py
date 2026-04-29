from dataclasses import dataclass


@dataclass(slots=True)
class NewsEvent:
    title: str
    url: str | None = None
    score: float = 0.0


class NewsFeed:
    async def latest(self, query: str) -> list[NewsEvent]:
        return []
