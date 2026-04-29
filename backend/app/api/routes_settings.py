from fastapi import APIRouter

from backend.app.config import get_settings

router = APIRouter(prefix="/api/settings", tags=["settings"])


@router.get("")
async def settings() -> dict:
    cfg = get_settings()
    safe = cfg.model_dump(exclude={"polymarket_private_key"})
    safe["has_private_key"] = bool(cfg.polymarket_private_key)
    return safe
