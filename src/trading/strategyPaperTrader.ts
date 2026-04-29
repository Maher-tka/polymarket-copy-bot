import { FillSimulation, StrategyName, StrategyOpportunity, StrategyPaperTrade } from "../types";
import { StrategyStateStore } from "../strategy/strategyState";
import { logger } from "../logger";
import { actualEdge, explainLoss, tradePnl } from "../diagnostics/analyzer";

export class StrategyPaperTrader {
  constructor(private readonly store: StrategyStateStore) {}

  executePairedArbitrage(
    opportunity: StrategyOpportunity,
    yesFill: FillSimulation,
    noFill: FillSimulation,
    strategy: StrategyName = "net-arbitrage"
  ): StrategyPaperTrade {
    const shares = Math.min(yesFill.filledShares, noFill.filledShares);
    const entryNotionalUsd = yesFill.notionalUsd + noFill.notionalUsd;
    const nonFeeCosts = realisticNonFeeCosts(yesFill) + realisticNonFeeCosts(noFill);
    const entryCostUsd = entryNotionalUsd + yesFill.feeUsd + noFill.feeUsd + nonFeeCosts;
    const lockedExitValueUsd = shares;
    const grossPnlUsd = lockedExitValueUsd - entryNotionalUsd;
    const unrealizedPnlUsd = grossPnlUsd - yesFill.feeUsd - noFill.feeUsd - nonFeeCosts;
    const fillRate = Math.min(yesFill.fillRate, noFill.fillRate);

    const trade = this.buildTrade({
      strategy,
      opportunity,
      side: "ARBITRAGE_PAIR",
      shares,
      entryCostUsd,
      grossPnlUsd,
      unrealizedPnlUsd,
      feesUsd: yesFill.feeUsd + noFill.feeUsd,
      slippageUsd: yesFill.slippageUsd + noFill.slippageUsd + nonFeeCosts,
      fillRate,
      status: fillRate >= 1 ? "filled" : "partial"
    });

    this.store.addPaperTrade(trade);
    logger.info("Strategy paper arbitrage trade simulated.", {
      strategy: trade.strategy,
      market: trade.marketTitle,
      edge: trade.edge,
      fillRate: trade.fillRate,
      unrealizedPnlUsd: trade.unrealizedPnlUsd
    });

    return trade;
  }

  executeSingleLeg(
    strategy: StrategyName,
    opportunity: StrategyOpportunity,
    fill: FillSimulation,
    expectedEdgeUsd: number
  ): StrategyPaperTrade {
    const nonFeeCosts = realisticNonFeeCosts(fill);
    const trade = this.buildTrade({
      strategy,
      opportunity,
      side: opportunity.side ?? "BUY",
      shares: fill.filledShares,
      entryCostUsd: fill.notionalUsd + fill.feeUsd + nonFeeCosts,
      grossPnlUsd: expectedEdgeUsd,
      unrealizedPnlUsd: expectedEdgeUsd - fill.slippageUsd - fill.feeUsd - nonFeeCosts,
      feesUsd: fill.feeUsd,
      slippageUsd: fill.slippageUsd + nonFeeCosts,
      fillRate: fill.fillRate,
      status: fill.fillRate >= 1 ? "filled" : "partial"
    });

    this.store.addPaperTrade(trade);
    logger.info("Strategy paper trade simulated.", {
      strategy: trade.strategy,
      market: trade.marketTitle,
      edge: trade.edge,
      fillRate: trade.fillRate,
      unrealizedPnlUsd: trade.unrealizedPnlUsd
    });

    return trade;
  }

  settleAgedTrades(maxAgeSeconds: number): void {
    const now = Date.now();
    for (const trade of this.store.getState().paperTrades) {
      if (trade.closedAt) continue;
      const ageSeconds = (now - new Date(trade.openedAt).getTime()) / 1000;
      if (ageSeconds < maxAgeSeconds) continue;

      this.store.updatePaperTrade(trade.id, {
        realizedPnlUsd: round(trade.realizedPnlUsd + trade.unrealizedPnlUsd),
        unrealizedPnlUsd: 0,
        exitValueUsd: round(trade.entryCostUsd + trade.unrealizedPnlUsd),
        actualEdge: round((trade.realizedPnlUsd + trade.unrealizedPnlUsd) / Math.max(0.01, trade.entryCostUsd)),
        lossReason: trade.realizedPnlUsd + trade.unrealizedPnlUsd < 0 ? (trade.lossReason ?? explainLoss(trade)) : undefined,
        exitReason: "Paper auto-settle timer elapsed.",
        closedAt: new Date().toISOString(),
        status: "filled"
      });
    }
  }

  private buildTrade(input: {
    strategy: StrategyName;
    opportunity: StrategyOpportunity;
    side: "ARBITRAGE_PAIR" | "BUY" | "SELL";
    shares: number;
    entryCostUsd: number;
    grossPnlUsd: number;
    unrealizedPnlUsd: number;
    feesUsd: number;
    slippageUsd: number;
    fillRate: number;
    status: "filled" | "partial" | "missed";
  }): StrategyPaperTrade {
    const draft = {
      id: `${input.strategy}-paper-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      strategy: input.strategy,
      opportunityId: input.opportunity.id,
      marketTitle: input.opportunity.marketTitle,
      conditionId: input.opportunity.conditionId,
      side: input.side,
      shares: round(input.shares),
      entryCostUsd: round(input.entryCostUsd),
      grossPnlUsd: round(input.grossPnlUsd),
      realizedPnlUsd: 0,
      unrealizedPnlUsd: round(input.unrealizedPnlUsd),
      feesUsd: round(input.feesUsd),
      slippageUsd: round(input.slippageUsd),
      edge: round(input.opportunity.edge),
      fillRate: round(input.fillRate),
      status: input.status,
      yesTokenId: input.opportunity.yesTokenId,
      noTokenId: input.opportunity.noTokenId,
      marketEndDate: input.opportunity.marketEndDate,
      secondsToClose: input.opportunity.secondsToClose,
      paperScout: input.opportunity.paperScout,
      openedAt: new Date().toISOString()
    };

    return {
      ...draft,
      actualEdge: round(actualEdge(draft)),
      lossReason: tradePnl(draft) < 0 ? explainLoss(draft) : undefined
    };
  }
}

function round(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function realisticNonFeeCosts(fill: FillSimulation): number {
  return (
    (fill.spreadCostUsd ?? 0) +
    (fill.staleDataPenaltyUsd ?? 0) +
    (fill.queueUncertaintyUsd ?? 0) +
    (fill.adverseSelectionUsd ?? 0)
  );
}
