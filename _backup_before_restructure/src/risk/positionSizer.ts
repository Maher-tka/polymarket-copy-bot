import { BotConfig, CopySignal, PortfolioSnapshot, PositionSizeDecision } from "../types";

export class PositionSizer {
  constructor(private readonly config: Pick<BotConfig, "maxTradeUsd">) {}

  calculate(
    signal: CopySignal,
    portfolio: PortfolioSnapshot,
    entryPrice: number | undefined,
    availableLiquidityUsd: number
  ): PositionSizeDecision {
    const reasons: string[] = [];

    if (entryPrice === undefined || !Number.isFinite(entryPrice) || entryPrice <= 0) {
      reasons.push("Cannot size position without a valid entry price.");
      return { accepted: false, reasons, tradeUsd: 0, shares: 0 };
    }

    // BUYs need paper cash. SELLs close/reduce an existing simulated position,
    // so they should not be blocked just because most cash is already deployed.
    const cashCap = signal.side === "BUY" ? portfolio.balanceUsd : Number.POSITIVE_INFINITY;

    // We copy the smaller of: configured max, trader's own notional, visible liquidity, and cash when buying.
    const tradeUsd = Math.min(
      this.config.maxTradeUsd,
      signal.traderNotionalUsd,
      availableLiquidityUsd,
      cashCap
    );

    if (tradeUsd <= 0.01) {
      reasons.push("Calculated trade size is too small after risk/liquidity caps.");
    }

    return {
      accepted: reasons.length === 0,
      reasons,
      tradeUsd: round(tradeUsd),
      shares: round(tradeUsd / entryPrice)
    };
  }
}

function round(value: number): number {
  return Math.round(value * 10000) / 10000;
}
