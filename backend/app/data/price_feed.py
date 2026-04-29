from abc import ABC, abstractmethod


class PriceFeed(ABC):
    is_live: bool = False

    @abstractmethod
    async def spot_price(self, symbol: str) -> float | None:
        """Return current spot price for BTC, ETH, or SOL."""


class StaticPriceFeed(PriceFeed):
    """Test/development price feed. Not safe for REAL trading."""

    is_live = False

    def __init__(self, prices: dict[str, float] | None = None) -> None:
        self.prices = {
            "BTC": 65_000.0,
            "BITCOIN": 65_000.0,
            "ETH": 3_200.0,
            "ETHEREUM": 3_200.0,
            "SOL": 150.0,
        }
        if prices:
            self.prices.update({key.upper(): value for key, value in prices.items()})

    async def spot_price(self, symbol: str) -> float | None:
        return self.prices.get(symbol.upper())
