def realized_pnl(trades: list[dict]) -> float:
    return round(sum(float(trade.get("realized_pnl", 0.0)) for trade in trades), 4)


def unrealized_pnl(positions: list[dict]) -> float:
    return round(sum(float(position.get("market_value", 0.0)) - float(position.get("cost_basis", 0.0)) for position in positions), 4)
