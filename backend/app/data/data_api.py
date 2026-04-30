import httpx

from backend.app.config import Settings


class DataApi:
    def __init__(self, settings: Settings) -> None:
        self.client = httpx.AsyncClient(base_url=settings.data_api_base, timeout=15)

    async def close(self) -> None:
        await self.client.aclose()

    async def trades(self, user: str | None = None, limit: int = 100, offset: int = 0) -> list[dict]:
        params = {"limit": limit}
        if offset:
            params["offset"] = offset
        if user:
            params["user"] = user
        response = await self.client.get("/trades", params=params)
        response.raise_for_status()
        data = response.json()
        return data if isinstance(data, list) else data.get("trades", [])

    async def positions(self, user: str, limit: int = 100) -> list[dict]:
        response = await self.client.get("/positions", params={"user": user, "limit": limit})
        response.raise_for_status()
        data = response.json()
        return data if isinstance(data, list) else data.get("positions", [])
