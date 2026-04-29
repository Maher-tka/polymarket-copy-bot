from collections import defaultdict


def pnl_by_strategy(trades: list[dict]) -> dict[str, float]:
    result: dict[str, float] = defaultdict(float)
    for trade in trades:
        result[str(trade.get("signal_source", "unknown"))] += float(trade.get("realized_pnl", 0.0))
    return {key: round(value, 4) for key, value in result.items()}


def pnl_by_market(trades: list[dict]) -> dict[str, float]:
    result: dict[str, float] = defaultdict(float)
    for trade in trades:
        result[str(trade.get("market_id", "unknown"))] += float(trade.get("realized_pnl", 0.0))
    return {key: round(value, 4) for key, value in result.items()}
