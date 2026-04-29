import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { LockedRealExecutionLayer, PaperExecutionLayer } from "../src/execution/executionLayer";
import { StrategyStateStore } from "../src/strategy/strategyState";
import { LocalDatabase } from "../src/storage/localDatabase";
import { PaperTrader } from "../src/trading/paperTrader";
import { Portfolio } from "../src/trading/portfolio";
import { StrategyPaperTrader } from "../src/trading/strategyPaperTrader";
import { CopySignal, FillSimulation, StrategyOpportunity } from "../src/types";

describe("PaperExecutionLayer", () => {
  it("routes copy signals through the paper portfolio execution path", () => {
    const portfolio = new Portfolio(100, "PAPER");
    const execution = new PaperExecutionLayer({ copyTrader: new PaperTrader(portfolio) });

    const result = execution.executeCopySignal(copySignal(), 0.5, {
      accepted: true,
      reasons: [],
      tradeUsd: 2,
      shares: 4
    });

    expect(result.success).toBe(true);
    expect(portfolio.getSnapshot().openPositions).toHaveLength(1);
    expect(portfolio.getSnapshot().balanceUsd).toBeCloseTo(98);
    expect(portfolio.getSnapshot().exposure.totalExposureUsd).toBeCloseTo(2);
    expect(portfolio.getSnapshot().exposure.byMarket[0].label).toBe("Test market");
    expect(portfolio.getSnapshot().exposure.byTrader[0].key).toBe("0xabc");
  });

  it("routes strategy fills through the strategy paper execution path", () => {
    const store = makeStore();
    const execution = new PaperExecutionLayer({ strategyTrader: new StrategyPaperTrader(store) });

    const trade = execution.executePairedArbitrage(
      opportunity(),
      fill(0.45, 10),
      fill(0.5, 10)
    );

    expect(trade.unrealizedPnlUsd).toBeCloseTo(0.5);
    expect(store.getState().paperTrades).toHaveLength(1);
  });

  it("keeps real execution locked", async () => {
    await expect(new LockedRealExecutionLayer().execute()).rejects.toThrow("Real execution is locked");
  });
});

function makeStore(): StrategyStateStore {
  return new StrategyStateStore(new LocalDatabase(mkdtempSync(join(tmpdir(), "poly-test-"))), {
    realTradingEnabled: false,
    recorderEnabled: false,
    backtestMode: false
  });
}

function copySignal(): CopySignal {
  return {
    id: "copy-signal-1",
    traderWallet: "0xabc",
    traderScore: 90,
    side: "BUY",
    assetId: "yes-token",
    conditionId: "condition",
    marketTitle: "Test market",
    outcome: "Yes",
    traderSize: 10,
    traderPrice: 0.5,
    traderNotionalUsd: 5,
    traderTradeTimestamp: Date.now() / 1000,
    copyDelaySeconds: 1,
    createdAt: new Date().toISOString(),
    sourceTradeId: "trade-1"
  };
}

function opportunity(): StrategyOpportunity {
  return {
    id: "opp-1",
    strategy: "net-arbitrage",
    marketTitle: "Test pair",
    conditionId: "condition",
    edge: 0.05,
    status: "accepted",
    createdAt: new Date().toISOString()
  };
}

function fill(price: number, shares: number): FillSimulation {
  return {
    requestedShares: shares,
    filledShares: shares,
    fillRate: 1,
    averagePrice: price,
    topOfBookPrice: price,
    notionalUsd: price * shares,
    slippageUsd: 0,
    slippagePct: 0,
    feeUsd: 0,
    spreadCostUsd: 0,
    staleDataPenaltyUsd: 0,
    queueUncertaintyUsd: 0,
    adverseSelectionUsd: 0,
    partial: false,
    depthUsd: price * shares * 10
  };
}
