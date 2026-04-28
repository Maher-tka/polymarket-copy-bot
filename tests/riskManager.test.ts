import { describe, expect, it } from "vitest";
import { LiveOrderIntent, LiveRiskContext, RiskManager } from "../src/risk/riskManager";
import { BotConfig, CopySignal, PortfolioSnapshot } from "../src/types";

const config = {
  mode: "paper",
  enableLiveTrading: false,
  realTradingEnabled: false,
  liveTrading: false,
  paperTrading: true,
  maxTradeUsd: 2,
  maxTradeSizeUsdc: 2,
  maxMarketExposureUsd: 5,
  maxDailyLossUsd: 8,
  maxDailyLossUsdc: 8,
  maxOpenPositions: 1,
  stopAfterErrors: 3,
  minDepthMultiplier: 5
} satisfies Partial<BotConfig> as BotConfig;

const liveConfig = {
  ...config,
  mode: "live",
  enableLiveTrading: true,
  realTradingEnabled: true,
  liveTrading: true,
  paperTrading: false,
  maxTradeSizeUsdc: 5,
  maxOpenPositions: 2
} satisfies Partial<BotConfig> as BotConfig;

const liveIntent: LiveOrderIntent = {
  strategy: "stink-bid",
  marketId: "market-1",
  estimatedNotionalUsd: 2,
  marketLiquidityUsd: 25,
  approvedForLive: true
};

const liveContext: LiveRiskContext = {
  mode: "live",
  openPositions: 0,
  dailyPnlUsd: 0,
  hourlyPnlUsd: 0,
  apiErrorCount: 0,
  abnormalFillBehavior: false
};

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

  it("rejects real orders in paper-safe config", () => {
    const result = new RiskManager(config).evaluateLiveOrder(liveIntent, liveContext);

    expect(result.accepted).toBe(false);
    expect(result.reasons.join(" ")).toContain("ENABLE_LIVE_TRADING is false");
    expect(result.reasons.join(" ")).toContain("REAL_TRADING_ENABLED is false");
    expect(result.reasons.join(" ")).toContain("MODE must be live");
  });

  it("accepts a live order only when every live risk check passes", () => {
    const result = new RiskManager(liveConfig).evaluateLiveOrder(liveIntent, liveContext);

    expect(result.accepted).toBe(true);
    expect(result.reasons).toEqual([]);
  });

  it("rejects unsafe live orders with specific reasons", () => {
    const result = new RiskManager(liveConfig).evaluateLiveOrder(
      {
        ...liveIntent,
        approvedForLive: false,
        estimatedNotionalUsd: 6,
        marketLiquidityUsd: 10
      },
      {
        ...liveContext,
        openPositions: 2,
        dailyPnlUsd: -9,
        apiErrorCount: 3,
        abnormalFillBehavior: true
      }
    );

    const reasons = result.reasons.join(" ");
    expect(result.accepted).toBe(false);
    expect(reasons).toContain("Strategy is not approved");
    expect(reasons).toContain("MAX_TRADE_SIZE_USDC");
    expect(reasons).toContain("MAX_DAILY_LOSS_USDC");
    expect(reasons).toContain("MAX_OPEN_POSITIONS");
    expect(reasons).toContain("Market liquidity is too low");
    expect(reasons).toContain("STOP_AFTER_ERRORS");
    expect(reasons).toContain("abnormal");
  });
});
