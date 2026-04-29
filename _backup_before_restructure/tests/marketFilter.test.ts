import { describe, expect, it } from "vitest";
import { MarketFilter } from "../src/strategy/marketFilter";
import { BotConfig, CopySignal, MarketSnapshot } from "../src/types";

const config = {
  minTraderScore: 75,
  minMarketVolumeUsd: 10000,
  maxSpread: 0.04,
  maxEntryPrice: 0.85,
  minEntryPrice: 0.1,
  maxCopyPriceDifference: 0.03,
  copyDelayLimitSeconds: 30,
  maxTradeUsd: 2
} satisfies Partial<BotConfig> as BotConfig;

const signal: CopySignal = {
  id: "s1",
  traderWallet: "0x1111111111111111111111111111111111111111",
  traderScore: 80,
  side: "BUY",
  assetId: "token",
  conditionId: "condition",
  traderSize: 10,
  traderPrice: 0.5,
  traderNotionalUsd: 5,
  traderTradeTimestamp: Math.floor(Date.now() / 1000),
  copyDelaySeconds: 5,
  createdAt: new Date().toISOString(),
  sourceTradeId: "trade"
};

const snapshot: MarketSnapshot = {
  assetId: "token",
  conditionId: "condition",
  market: {
    active: true,
    closed: false,
    enableOrderBook: true,
    volumeNum: 20000
  },
  spread: 0.02,
  bestBid: 0.49,
  bestAsk: 0.51,
  currentEntryPrice: 0.51,
  volumeUsd: 20000,
  liquidityUsd: 1000,
  availableLiquidityUsd: 10
};

describe("MarketFilter", () => {
  it("accepts a clean market snapshot", () => {
    const result = new MarketFilter(config).evaluate(signal, snapshot);
    expect(result.accepted).toBe(true);
    expect(result.reasons).toHaveLength(0);
  });

  it("rejects wide spreads and stale copy signals", () => {
    const result = new MarketFilter(config).evaluate(
      { ...signal, copyDelaySeconds: 90 },
      { ...snapshot, spread: 0.1 }
    );

    expect(result.accepted).toBe(false);
    expect(result.reasons.join(" ")).toContain("Spread");
    expect(result.reasons.join(" ")).toContain("Copy delay");
  });
});
