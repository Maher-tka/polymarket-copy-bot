import { CopySignal, PositionSizeDecision, TradeExecutionResult } from "../types";
import { logger } from "../logger";
import { Portfolio } from "./portfolio";

export class PaperTrader {
  constructor(private readonly portfolio: Portfolio) {}

  execute(signal: CopySignal, entryPrice: number, size: PositionSizeDecision): TradeExecutionResult {
    if (!size.accepted) {
      const skipped = this.portfolio.addSkipped(size.reasons, signal);
      return { success: false, skipped };
    }

    if (signal.side === "BUY") {
      const position = this.portfolio.openOrIncrease(signal, entryPrice, size.tradeUsd, size.shares);
      logger.info("Paper BUY simulated.", {
        signalId: signal.id,
        market: signal.marketTitle,
        tradeUsd: size.tradeUsd,
        entryPrice
      });
      return { success: true, position };
    }

    const closedPosition = this.portfolio.closeOrReduce(signal, entryPrice, size.shares);
    if (!closedPosition) {
      const skipped = this.portfolio.addSkipped(["SELL signal received, but no matching paper position exists."], signal);
      logger.info("Paper SELL skipped because there is no matching open position.", { signalId: signal.id });
      return { success: false, skipped };
    }

    logger.info("Paper SELL simulated.", {
      signalId: signal.id,
      market: signal.marketTitle,
      proceedsUsd: closedPosition.proceedsUsd,
      realizedPnlUsd: closedPosition.realizedPnlUsd
    });
    return { success: true, closedPosition };
  }
}
