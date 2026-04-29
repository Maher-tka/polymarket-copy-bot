from fastapi import APIRouter, Body, Depends, HTTPException, Request, status
from pydantic import BaseModel

from backend.app.api.security import require_local_request

router = APIRouter(prefix="/api/bot", tags=["bot"], dependencies=[Depends(require_local_request)])


class StartRequest(BaseModel):
    confirm_real_money_risk: bool = False


@router.post("/start")
async def start_bot(request: Request, payload: StartRequest | None = Body(default=None)) -> dict:
    engine = request.app.state.engine
    if engine.settings.bot_mode == "REAL" and not (payload and payload.confirm_real_money_risk):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="REAL mode start requires explicit runtime confirmation.",
        )
    await request.app.state.engine.start()
    return request.app.state.engine.dashboard_state()


@router.post("/pause")
async def pause_bot(request: Request) -> dict:
    await request.app.state.engine.pause()
    return request.app.state.engine.dashboard_state()


@router.post("/stop")
async def stop_bot(request: Request) -> dict:
    await request.app.state.engine.stop()
    return request.app.state.engine.dashboard_state()


@router.post("/emergency-stop")
async def emergency_stop(request: Request) -> dict:
    await request.app.state.engine.emergency_stop()
    return request.app.state.engine.dashboard_state()


@router.post("/demo-tick")
async def demo_tick(request: Request) -> dict:
    if request.app.state.engine.settings.bot_mode == "REAL":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Demo ticks are disabled in REAL mode.",
        )
    result = await request.app.state.engine.demo_tick()
    return {"result": serialize_result(result), "state": request.app.state.engine.dashboard_state()}


def serialize_result(result: dict) -> dict:
    output = dict(result)
    if output.get("decision"):
        decision = output["decision"]
        output["decision"] = {
            "market_id": decision.market_id,
            "decision": decision.decision.value,
            "final_score": decision.final_score,
            "expected_edge": decision.expected_edge,
            "reasons": decision.reasons,
            "components": decision.components,
        }
    if output.get("risk"):
        risk = output["risk"]
        output["risk"] = {"accepted": risk.accepted, "reasons": risk.reasons}
    return output
