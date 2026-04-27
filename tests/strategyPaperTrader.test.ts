import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { buildLosingDiagnostics } from "../src/diagnostics/analyzer";
import { StrategyStateStore } from "../src/strategy/strategyState";
import { LocalDatabase } from "../src/storage/localDatabase";
import { StrategyPaperTrader } from "../src/trading/strategyPaperTrader";
import { FillSimulation, StrategyOpportunity } from "../src/types";

const opportunity: StrategyOpportunity = {
  id: "arb-1",
  strategy: "net-arbitrage",
  conditionId: "condition",
  marketTitle: "Test binary market",
  edge: 0.03,
  status: "accepted",
  createdAt: new Date().toISOString()
};

function fill(price: number, shares: number, feeRate = 0): FillSimulation {
  return {
    requestedShares: shares,
    filledShares: shares,
    fillRate: 1,
    averagePrice: price,
    topOfBookPrice: price,
    notionalUsd: price * shares,
    slippageUsd: 0,
    slippagePct: 0,
    feeUsd: price * shares * feeRate,
    partial: false,
    depthUsd: price * shares * 10
  };
}

describe("StrategyPaperTrader", () => {
  it("calculates paired arbitrage PnL after fees", () => {
    const store = new StrategyStateStore(new LocalDatabase(mkdtempSync(join(tmpdir(), "poly-test-"))), {
      realTradingEnabled: false,
      recorderEnabled: false,
      backtestMode: false
    });
    const trader = new StrategyPaperTrader(store);

    const trade = trader.executePairedArbitrage(opportunity, fill(0.48, 10, 0.01), fill(0.49, 10, 0.01));

    expect(trade.grossPnlUsd).toBeCloseTo(0.3);
    expect(trade.feesUsd).toBeCloseTo(0.097);
    expect(trade.unrealizedPnlUsd).toBeCloseTo(0.203);
    expect(trade.actualEdge).toBeGreaterThan(0);
  });

  it("summarizes fees, slippage, win rate, and best strategy", () => {
    const summary = buildLosingDiagnostics({
      diagnostics: [],
      rejections: [],
      trades: [
        {
          id: "trade",
          strategy: "net-arbitrage",
          conditionId: "condition",
          side: "ARBITRAGE_PAIR",
          shares: 10,
          entryCostUsd: 9.797,
          exitValueUsd: 10,
          grossPnlUsd: 0.3,
          realizedPnlUsd: 0.203,
          unrealizedPnlUsd: 0,
          feesUsd: 0.097,
          slippageUsd: 0,
          edge: 0.03,
          actualEdge: 0.0207,
          fillRate: 1,
          status: "filled",
          openedAt: new Date().toISOString(),
          closedAt: new Date().toISOString()
        }
      ]
    });

    expect(summary.winRate).toBe(1);
    expect(summary.netPnlUsd).toBeCloseTo(0.203);
    expect(summary.grossPnlUsd).toBeCloseTo(0.3);
    expect(summary.totalFeesUsd).toBeCloseTo(0.097);
    expect(summary.mostProfitableStrategy).toBe("net-arbitrage");
  });
});
