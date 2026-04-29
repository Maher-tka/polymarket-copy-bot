from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from backend.app.storage.db import get_session
from backend.app.storage.repositories import PositionRepository, TradeRepository

router = APIRouter(prefix="/api", tags=["trades"])


@router.get("/trades")
async def trades(session: Session = Depends(get_session)) -> list[dict]:
    return [
        {
            "id": trade.id,
            "mode": trade.mode,
            "market_id": trade.market_id,
            "side": trade.side,
            "price": trade.price,
            "size_usd": trade.size_usd,
            "shares": trade.shares,
            "realized_pnl": trade.realized_pnl,
            "created_at": trade.created_at.isoformat(),
        }
        for trade in TradeRepository(session).list_trades()
    ]


@router.get("/positions")
async def positions(session: Session = Depends(get_session)) -> list[dict]:
    return [
        {
            "id": position.id,
            "market_id": position.market_id,
            "side": position.side,
            "shares": position.shares,
            "avg_price": position.avg_price,
            "cost_basis": position.cost_basis,
        }
        for position in PositionRepository(session).list_positions()
    ]
