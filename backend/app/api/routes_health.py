from fastapi import APIRouter, Request

router = APIRouter(tags=["health"])


@router.get("/health")
async def health(request: Request) -> dict:
    engine = request.app.state.engine
    state = engine.dashboard_state()
    return {
        "ok": True,
        "mode": state["mode"],
        "status": state["status"],
        "real_trading_enabled": False if state["mode"] == "PAPER" else engine.settings.real_trading_enabled,
    }
