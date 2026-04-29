import csv
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


class ResearchAuditLog:
    """CSV audit trail for offline paper-trading analysis."""

    SIGNAL_HEADERS = [
        "timestamp",
        "market_id",
        "question",
        "decision",
        "final_score",
        "expected_edge",
        "adjusted_edge",
        "risk_accepted",
        "components_json",
        "reasons_json",
    ]
    TRADE_HEADERS = [
        "timestamp",
        "market_id",
        "question",
        "decision",
        "size_usd",
        "shares",
        "avg_price",
        "partial",
        "fees_usd",
        "slippage_usd",
        "signal_source",
        "adjusted_edge",
    ]

    def __init__(self, log_dir: str | Path) -> None:
        self.log_dir = Path(log_dir)
        self.signal_file = self.log_dir / "signals.csv"
        self.trade_file = self.log_dir / "paper_trades.csv"
        self.log_dir.mkdir(parents=True, exist_ok=True)
        self._ensure_header(self.signal_file, self.SIGNAL_HEADERS)
        self._ensure_header(self.trade_file, self.TRADE_HEADERS)
        self._signal_count = self._data_rows(self.signal_file)
        self._trade_count = self._data_rows(self.trade_file)

    def log_decision(self, market, decision, risk) -> None:
        self._append(
            self.signal_file,
            [
                self._now(),
                market.id,
                self._clean_text(market.question),
                decision.decision.value,
                round(float(decision.final_score), 6),
                round(float(decision.expected_edge), 6),
                round(float(risk.adjusted_edge), 6),
                bool(risk.accepted),
                json.dumps(decision.components, sort_keys=True),
                json.dumps(decision.reasons + risk.reasons),
            ],
        )
        self._signal_count += 1

    def log_trade(self, trade: dict[str, Any]) -> None:
        self._append(
            self.trade_file,
            [
                self._now(),
                trade.get("market_id", ""),
                self._clean_text(str(trade.get("question", ""))),
                trade.get("decision", ""),
                round(float(trade.get("size_usd", 0.0)), 6),
                round(float(trade.get("shares", 0.0)), 6),
                round(float(trade.get("avg_price", 0.0)), 6),
                bool(trade.get("partial", False)),
                round(float(trade.get("fees_usd", 0.0)), 6),
                round(float(trade.get("slippage_usd", 0.0)), 6),
                trade.get("signal_source", ""),
                round(float(trade.get("adjusted_edge", 0.0)), 6),
            ],
        )
        self._trade_count += 1

    def summary(self) -> dict[str, Any]:
        return {
            "enabled": True,
            "log_dir": str(self.log_dir),
            "signals": self._signal_count,
            "paper_trades": self._trade_count,
        }

    def _ensure_header(self, path: Path, headers: list[str]) -> None:
        if path.exists():
            return
        with path.open("w", newline="", encoding="utf-8") as handle:
            csv.writer(handle).writerow(headers)

    def _append(self, path: Path, row: list[Any]) -> None:
        with path.open("a", newline="", encoding="utf-8") as handle:
            csv.writer(handle).writerow(row)

    def _data_rows(self, path: Path) -> int:
        if not path.exists():
            return 0
        with path.open("r", newline="", encoding="utf-8") as handle:
            return max(0, sum(1 for _ in handle) - 1)

    def _now(self) -> str:
        return datetime.now(timezone.utc).isoformat()

    def _clean_text(self, value: str) -> str:
        return " ".join(value.split())[:180]
