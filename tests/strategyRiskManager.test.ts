import { describe, expect, it } from "vitest";
import { StrategyRiskManager } from "../src/risk/strategyRiskManager";
import { RiskManager } from "../src/risk/riskManager";
import { BotConfig, PortfolioSnapshot, StrategyEngineState, StrategyOpportunity } from "../src/types";

const config = {
  maxTradeUsd: 2,
  maxTradeSizeUsd: 5,
  maxMarketExposureUsd: 5,
  maxDailyLossUsd: 8,
  maxOpenPositions: 5,
  stopAfterErrors: 3,
  maxDailyLossPct: 0.03,
  maxDeployedCapitalPct: 0.25,
  maxPositionSizePct: 0.01,
  maxOneMarketExposureUsd: 5,
  maxStrategyOpenPositions: 10,
  maxSlippage: 0.01,
  stopAfterFailedFills: 3,
  stopAfterConsecutiveLosses: 3
} satisfies Partial<BotConfig> as BotConfig;

const portfolio: PortfolioSnapshot = {
  mode: "PAPER",
  balanceUsd: 100,
  equityUsd: 100,
  startingBalanceUsd: 100,
  realizedPnlUsd: 0,
  unrealizedPnlUsd: 0,
  dailyRealizedPnlUsd: 0,
  winRate: 0,
  maxDrawdownUsd: 0,
  maxDrawdownPct: 0,
  openPositions: [],
  closedPositions: [],
  latestSignals: [],
  skippedTrades: []
};

const state: StrategyEngineState = {
  activeMode: "Paper",
  realTradingEnabled: false,
  realTradingUiConfirmed: false,
  emergencyStopped: false,
  activeStrategies: ["net-arbitrage"],
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
    strategyRanking: []
  },
  makerOrders: [],
  metrics: [],
  marketEvents: [],
  recorder: { enabled: true, snapshotsRecorded: 0, path: "data/orderBookSnapshot.jsonl" },
  backtest: { enabled: false, availableSnapshots: 0 }
};

const opportunity: StrategyOpportunity = {
  id: "opp",
  strategy: "net-arbitrage",
  conditionId: "condition",
  edge: 0.02,
  status: "accepted",
  createdAt: new Date().toISOString()
};

describe("StrategyRiskManager", () => {
  it("allows a position within MAX_TRADE_SIZE_USD", () => {
    const risk = new StrategyRiskManager(config, new RiskManager(config));
    expect(risk.evaluate(opportunity, portfolio, state, 1, 0.001)).toHaveLength(0);
  });

  it("rejects oversized positions and high slippage", () => {
    const risk = new StrategyRiskManager(config, new RiskManager(config));
    const reasons = risk.evaluate(opportunity, portfolio, state, 6, 0.02);

    expect(reasons.join(" ")).toContain("MAX_TRADE_SIZE_USD");
    expect(reasons.join(" ")).toContain("slippage");
  });
});
