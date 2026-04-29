import httpx


class PolygonRpc:
    def __init__(self, rpc_url: str | None) -> None:
        self.rpc_url = rpc_url

    async def call(self, method: str, params: list) -> dict:
        if not self.rpc_url:
            raise RuntimeError("POLYGON_RPC_URL is not configured.")
        async with httpx.AsyncClient(timeout=15) as client:
            response = await client.post(self.rpc_url, json={"jsonrpc": "2.0", "id": 1, "method": method, "params": params})
            response.raise_for_status()
            return response.json()
