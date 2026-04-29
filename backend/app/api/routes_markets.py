from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from backend.app.data.gamma_api import GammaApi
from backend.app.storage.db import get_session
from backend.app.storage.repositories import MarketRepository

router = APIRouter(prefix="/api/markets", tags=["markets"])


@router.get("")
async def markets(session: Session = Depends(get_session)) -> list[dict]:
    return [
        {
            "id": market.id,
            "question": market.question,
            "liquidity": market.liquidity,
            "volume": market.volume,
            "yes_token_id": market.yes_token_id,
            "no_token_id": market.no_token_id,
        }
        for market in MarketRepository(session).list_active()
    ]


@router.post("/discover")
async def discover_markets(request: Request, session: Session = Depends(get_session)) -> dict:
    client = GammaApi(request.app.state.engine.settings)
    try:
        markets = await client.active_markets()
    finally:
        await client.close()
    MarketRepository(session).upsert_many(markets)
    request.app.state.engine.state.state.markets = [
        {"id": market.id, "question": market.question, "liquidity": market.liquidity, "volume": market.volume}
        for market in markets
    ]
    return {"count": len(markets), "markets": request.app.state.engine.state.state.markets}
