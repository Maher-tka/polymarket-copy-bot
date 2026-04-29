from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.app.api.routes_bot import router as bot_router
from backend.app.api.routes_dashboard import router as dashboard_router
from backend.app.api.routes_health import router as health_router
from backend.app.api.routes_markets import router as markets_router
from backend.app.api.routes_settings import router as settings_router
from backend.app.api.routes_trades import router as trades_router
from backend.app.config import get_settings
from backend.app.core.bot_engine import BotEngine
from backend.app.logging_config import configure_logging, logger
from backend.app.storage.db import init_db


settings = get_settings()
engine = BotEngine(settings)


@asynccontextmanager
async def lifespan(app: FastAPI):
    configure_logging()
    init_db(settings.sqlite_url)
    logger.info("Backend starting in %s mode", settings.bot_mode)
    app.state.engine = engine
    yield
    await engine.shutdown()


app = FastAPI(title="Polymarket Trading Bot", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.backend_cors_origin, "http://localhost:5173"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health_router)
app.include_router(dashboard_router)
app.include_router(bot_router)
app.include_router(markets_router)
app.include_router(trades_router)
app.include_router(settings_router)
