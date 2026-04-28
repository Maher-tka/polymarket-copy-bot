import { describe, expect, it } from "vitest";
import { PaperLearningOptimizer } from "../src/learning/paperLearningOptimizer";
import { BotConfig, StrategyEngineState } from "../src/types";

describe("PaperLearningOptimizer", () => {
  it("stays disabled unless the bot is safely paper-only", () => {
    const config = learningConfig({
      paperTradingOnly: false,
      realTradingEnabled: true
    });
    const learning = new PaperLearningOptimizer(config);

    const state = learning.evaluate(strategyState());

    expect(state.enabled).toBe(false);
    expect(state.appliedAdjustments).toHaveLength(0);
    expect(learning.shouldRun("net-arbitrage")).toBe(true);
  });

  it("tightens stale quote tolerance when paper diagnostics show high data delay", () => {
    const config = learningConfig({
      marketMakingMaxDataAgeMs: 5_000,
      maxDataAgeMs: 300
    });
    const learning = new PaperLearningOptimizer(config);

    const state = learning.evaluate(strategyState({
      averageDataDelayMs: 6_500,
      totalSignals: 300,
      tradesTaken: 0
    }));

    expect(state.enabled).toBe(true);
    expect(state.appliedAdjustments[0]).toMatchObject({
      setting: "marketMakingMaxDataAgeMs",
      to: 4_000
    });
    expect(config.marketMakingMaxDataAgeMs).toBe(4_000);

    const repeated = learning.evaluate(strategyState({
      averageDataDelayMs: 6_500,
      totalSignals: 300,
      tradesTaken: 0
    }));
    expect(repeated.appliedAdjustments).toHaveLength(1);
    expect(config.marketMakingMaxDataAgeMs).toBe(4_000);
  });

  it("pauses losing non-market-making strategy loops after enough paper samples", () => {
    const config = learningConfig();
    const learning = new PaperLearningOptimizer(config);

    const state = learning.evaluate(strategyState({
      totalSignals: 400,
      tradesTaken: 35,
      strategyRanking: [
        {
          strategy: "market-making",
          label: "Market Making",
          trades: 35,
          signals: 400,
          netPnlUsd: 1.25,
          winRate: 0.64,
          averageNetEdge: 0.002,
          averageActualEdge: 0.001,
          netProfitPerTrade: 0.03,
          profitFactor: 1.8,
          expectancyPerTrade: 0.03,
          maxDrawdownUsd: 0.1,
          latencyAdjustedPnlUsd: 1.1,
          status: "paper-candidate"
        },
        {
          strategy: "net-arbitrage",
          label: "Net Arbitrage",
          trades: 30,
          signals: 350,
          netPnlUsd: -0.8,
          winRate: 0.37,
          averageNetEdge: -0.001,
          averageActualEdge: -0.002,
          netProfitPerTrade: -0.026,
          profitFactor: 0.5,
          expectancyPerTrade: -0.026,
          maxDrawdownUsd: 0.8,
          latencyAdjustedPnlUsd: -0.9,
          status: "losing"
        }
      ]
    }));

    expect(state.disabledStrategies).toContain("net-arbitrage");
    expect(learning.shouldRun("net-arbitrage")).toBe(false);
    expect(learning.shouldRun("market-making")).toBe(true);
  });
});

function learningConfig(overrides: Partial<BotConfig> = {}): BotConfig {
  return {
    paperTradingOnly: true,
    realTradingEnabled: false,
    paperLearningEnabled: true,
    paperLearningAutoApply: true,
    paperLearningMinSignals: 250,
    paperLearningMinTrades: 30,
    marketMakingMaxDataAgeMs: 5_000,
    marketMakingMinEdge: 0.0005,
    maxDataAgeMs: 300,
    ...overrides
  } as BotConfig;
}

function strategyState(overrides: Partial<StrategyEngineState["losingDiagnostics"]> = {}): StrategyEngineState {
  return {
    activeMode: "Paper",
    realTradingEnabled: false,
    realTradingUiConfirmed: false,
    emergencyStopped: false,
    activeStrategies: ["net-arbitrage", "maker-arbitrage", "market-making", "whale-tracker"],
    opportunities: [],
    paperTrades: [],
    rejectedSignals: [],
    diagnostics: [],
    losingDiagnostics: {
      totalSignals: 0,
      tradesTaken: 0,
      rejectedSignals: 0,
      rejectionReasons: [],
      winRate: 0,
      netPnlUsd: 0,
      grossPnlUsd: 0,
      totalFeesUsd: 0,
      totalSlippageUsd: 0,
      estimatedFeesUsd: 0,
      estimatedSlippageUsd: 0,
      averageSpread: 0,
      averageDataDelayMs: 0,
      failedFills: 0,
      partialFills: 0,
      failedHedges: 0,
      tradesTooCloseToClose: 0,
      lossesCausedByFees: 0,
      lossesCausedBySlippage: 0,
      lossesCausedByStaleData: 0,
      lossesCausedByIlliquidity: 0,
      averageRawEdge: 0,
      averageNetEdge: 0,
      averageEdge: 0,
      averageActualEdge: 0,
      averageDepthUsd: 0,
      netProfitPerTrade: 0,
      averageWin: 0,
      averageLoss: 0,
      profitFactor: 0,
      expectancyPerTrade: 0,
      latencyAdjustedPnlUsd: 0,
      latencyAverageMs: 0,
      latencyP95Ms: 0,
      staleDataCount: 0,
      staleDataPct: 0,
      strategyRanking: [],
      ...overrides
    },
    makerOrders: [],
    metrics: [],
    marketEvents: [],
    recorder: {
      enabled: false,
      snapshotsRecorded: 0,
      path: "data/orderBookSnapshot.jsonl"
    },
    backtest: {
      enabled: false,
      availableSnapshots: 0
    }
  };
}
