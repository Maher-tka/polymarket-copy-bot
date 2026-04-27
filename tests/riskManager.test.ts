import { describe, expect, it } from "vitest";
import { RiskManager } from "../src/risk/riskManager";
import { BotConfig, CopySignal, PortfolioSnapshot } from "../src/types";

const config = {
  maxTradeUsd: 2,
  maxMarketExposureUsd: 5,
  maxDailyLossUsd: 8,
  maxOpenPositions: 1,
  stopAfterErrors: 3
} satisfies Partial<BotConfig> as BotConfig;

const signal: CopySignal = {
  id: "s1",
  traderWallet: "0x1111111111111111111111111111111111111111",
  traderScore: 90,
  side: "BUY",
  assetId: "asset-2",
  conditionId: "condition-1",
  traderSize: 10,
  traderPrice: 0.5,
  traderNotionalUsd: 5,
  traderTradeTimestamp: Math.floor(Date.now() / 1000),
  copyDelaySeconds: 1,
  createdAt: new Date().toISOString(),
  sourceTradeId: "trade"
};

const portfolio: PortfolioSnapshot = {
  mode: "PAPER",
  balanceUsd: 10,
  equityUsd: 10,
  startingBalanceUsd: 10,
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

describe("RiskManager", () => {
  it("accepts a small trade inside limits", () => {
    const result = new RiskManager(config).evaluate(signal, portfolio, 2);
    expect(result.accepted).toBe(true);
  });

  it("rejects trades over max size", () => {
    const result = new RiskManager(config).evaluate(signal, portfolio, 3);
    expect(result.accepted).toBe(false);
    expect(result.reasons.join(" ")).toContain("MAX_TRADE_USD");
  });

  it("enforces daily loss and kill switch", () => {
    const risk = new RiskManager(config);
    risk.setKillSwitch(true);
    const result = risk.evaluate(signal, { ...portfolio, dailyRealizedPnlUsd: -9 }, 1);

    expect(result.accepted).toBe(false);
    expect(result.reasons.join(" ")).toContain("Kill switch");
    expect(result.reasons.join(" ")).toContain("MAX_DAILY_LOSS_USD");
  });
});
