import math


def win_rate(trades: list[dict]) -> float:
    closed = [trade for trade in trades if "realized_pnl" in trade]
    if not closed:
        return 0.0
    return sum(1 for trade in closed if float(trade.get("realized_pnl", 0)) > 0) / len(closed)


def rough_sharpe(returns: list[float]) -> float:
    if len(returns) < 2:
        return 0.0
    mean = sum(returns) / len(returns)
    variance = sum((x - mean) ** 2 for x in returns) / (len(returns) - 1)
    std = math.sqrt(variance)
    return 0.0 if std == 0 else mean / std
