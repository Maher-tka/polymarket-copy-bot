from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.app.storage.models import MarketModel, PositionModel, TradeModel
from backend.app.strategy.signal_types import Market


class MarketRepository:
    def __init__(self, session: Session) -> None:
        self.session = session

    def upsert_many(self, markets: list[Market]) -> None:
        for market in markets:
            model = self.session.get(MarketModel, market.id) or MarketModel(id=market.id)
            model.question = market.question
            model.slug = market.slug
            model.yes_token_id = market.yes_token_id
            model.no_token_id = market.no_token_id
            model.liquidity = market.liquidity
            model.volume = market.volume
            model.end_ts = market.end_ts
            self.session.merge(model)
        self.session.commit()

    def list_active(self, limit: int = 100) -> list[MarketModel]:
        return list(self.session.scalars(select(MarketModel).limit(limit)))


class TradeRepository:
    def __init__(self, session: Session) -> None:
        self.session = session

    def record_trade(self, trade: TradeModel) -> TradeModel:
        self.session.add(trade)
        self.session.commit()
        self.session.refresh(trade)
        return trade

    def list_trades(self, limit: int = 100) -> list[TradeModel]:
        return list(self.session.scalars(select(TradeModel).order_by(TradeModel.created_at.desc()).limit(limit)))


class PositionRepository:
    def __init__(self, session: Session) -> None:
        self.session = session

    def list_positions(self) -> list[PositionModel]:
        return list(self.session.scalars(select(PositionModel)))
