from collections import deque
from dataclasses import dataclass, field


@dataclass
class RuntimeState:
    status: str = "STOPPED"
    mode: str = "PAPER"
    balance: float = 1000.0
    nav: float = 1000.0
    daily_pnl: float = 0.0
    realized_pnl: float = 0.0
    unrealized_pnl: float = 0.0
    max_drawdown_pct: float = 0.0
    blocked_reasons: list[str] = field(default_factory=list)
    markets: list[dict] = field(default_factory=list)
    positions: list[dict] = field(default_factory=list)
    open_orders: list[dict] = field(default_factory=list)
    trades: list[dict] = field(default_factory=list)
    logs: deque[str] = field(default_factory=lambda: deque(maxlen=200))
    last_decisions: list[dict] = field(default_factory=list)
    websocket_connected: bool = False
    stale_data: bool = False


class StateStore:
    def __init__(self, starting_balance: float, mode: str) -> None:
        self.state = RuntimeState(mode=mode, balance=starting_balance, nav=starting_balance)

    def snapshot(self) -> dict:
        data = self.state.__dict__.copy()
        data["logs"] = list(self.state.logs)
        return data

    def log(self, message: str) -> None:
        self.state.logs.appendleft(message)
