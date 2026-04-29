from fastapi import APIRouter, Request

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])


@router.get("")
async def dashboard(request: Request) -> dict:
    return request.app.state.engine.dashboard_state()
