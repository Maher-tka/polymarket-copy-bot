from backend.app.config import Settings
from backend.app.data.news_feed import NewsFeed
from backend.app.strategy.base import Strategy
from backend.app.strategy.signal_types import Market, OrderBook, Signal


class NewsReactionStrategy(Strategy):
    name = "news_reaction"

    def __init__(self, settings: Settings, feed: NewsFeed) -> None:
        self.settings = settings
        self.feed = feed

    async def evaluate(self, market: Market, orderbook: OrderBook) -> Signal | None:
        if not self.settings.enable_news:
            return None
        events = await self.feed.latest(market.question)
        if not events:
            return None
        return Signal(self.name, market.id, "YES", 0.0, 0.0, 0.0, ["News module disabled for live trading until backtested."])
