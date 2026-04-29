from functools import lru_cache
from typing import Literal

from pydantic import Field, SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_env: str = "development"
    bot_mode: Literal["PAPER", "REAL"] = "PAPER"
    paper_start_balance: float = 1000.0

    real_trading_enabled: bool = False
    i_understand_real_money_risk: bool = False

    polymarket_host: str = "https://clob.polymarket.com"
    polymarket_chain_id: int = 137
    polymarket_private_key: SecretStr | None = None
    polymarket_funder_address: str | None = None

    gamma_api_base: str = "https://gamma-api.polymarket.com"
    data_api_base: str = "https://data-api.polymarket.com"
    polygon_rpc_url: str | None = None

    max_trade_nav_pct: float = 0.01
    max_market_nav_pct: float = 0.02
    max_daily_loss_pct: float = 0.05
    max_total_drawdown_pct: float = 0.10
    cash_reserve_pct: float = 0.20
    max_spread_cents: float = 3.0
    min_expected_edge: float = 0.05
    min_liquidity: float = 1000.0
    min_volume: float = 5000.0
    max_order_age_seconds: int = 30
    stale_data_seconds: int = 10
    kelly_fraction: float = 0.50
    final_score_threshold: float = 0.45
    market_close_buffer_minutes: int = 30
    order_cooldown_seconds: int = 10
    estimated_fee_bps: float = 0.0
    slippage_bps: float = 20.0
    resolution_fee_pct: float = 0.02
    annual_capital_cost_pct: float = 0.08
    max_open_markets: int = 20
    max_correlated_nav_pct: float = 0.04
    websocket_heartbeat_seconds: int = 10
    paper_loop_interval_seconds: int = 15
    market_refresh_seconds: int = 300
    market_discovery_limit: int = 60
    market_scan_limit: int = 12
    max_paper_trades_per_cycle: int = 2
    audit_log_dir: str = "data/research_audit"
    external_probability_provider: Literal["mock", "metaculus"] = "mock"
    metaculus_cache_ttl_seconds: int = 900
    metaculus_search_limit: int = 5

    enable_calibration: bool = True
    enable_microstructure: bool = True
    enable_spread_capture: bool = True
    enable_smart_money: bool = False
    enable_news: bool = False

    sqlite_url: str = "sqlite:///./backend/app/storage/polymarket_bot.db"
    backend_cors_origin: str = "http://127.0.0.1:5173"

    @model_validator(mode="after")
    def validate_real_mode(self) -> "Settings":
        if self.bot_mode == "REAL":
            if not self.real_trading_enabled:
                raise ValueError("REAL mode requires REAL_TRADING_ENABLED=true.")
            if not self.i_understand_real_money_risk:
                raise ValueError("REAL mode requires I_UNDERSTAND_REAL_MONEY_RISK=true.")
            if not self.polymarket_private_key:
                raise ValueError("REAL mode requires POLYMARKET_PRIVATE_KEY.")
            if not self.polymarket_funder_address:
                raise ValueError("REAL mode requires POLYMARKET_FUNDER_ADDRESS.")
        return self

    @property
    def max_spread(self) -> float:
        return self.max_spread_cents / 100


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
