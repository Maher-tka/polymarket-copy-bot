import { describe, expect, it } from "vitest";
import { calculateExpectancyStats, misleadingWinRateWarning } from "../src/diagnostics/expectancy";
import { evaluateLatency } from "../src/latency/latencyEngine";
import { SignalThrottle } from "../src/risk/signalThrottle";
import { scoreEvent, MarketEventQueue } from "../src/strategy/eventQueue";
import { shouldSkipSmartCopy, scoreSignal } from "../src/strategy/signalScoring";
import { simulateOrderBookFill } from "../src/strategy/orderBookMath";
import { BotConfig, CopySignal, MarketSnapshot, OrderBook, StrategyPaperTrade } from "../src/types";

describe("expectancy-first diagnostics", () => {
  it("calculates expectancy, profit factor, average win, and average loss", () => {
    const stats = calculateExpectancyStats([
      trade("t1", 0.4),
      trade("t2", 0.2),
      trade("t3", -0.1)
    ]);

    expect(stats.netProfitPerTrade).toBeCloseTo(0.1667);
    expect(stats.averageWin).toBeCloseTo(0.3);
    expect(stats.averageLoss).toBeCloseTo(0.1);
    expect(stats.profitFactor).toBeCloseTo(6);
    expect(stats.expectancyPerTrade).toBeCloseTo(0.1667);
  });

  it("warns when a high win rate hides tiny profit per trade", () => {
    expect(
      misleadingWinRateWarning({
        winRate: 0.98,
        netProfitPerTrade: 0.002
      })
    ).toContain("High win rate is misleading");
  });
});

describe("latency and signal quality gates", () => {
  it("rejects stale/high-latency traces and applies latency penalty", () => {
    const result = evaluateLatency(
      {
        sourceEventTimestampMs: 0,
        detectedAtMs: 700,
        decisionStartedAtMs: 700,
        decisionCompletedAtMs: 900,
        simulatedExecutionAtMs: 1_300,
        dataTimestampMs: 0
      },
      { maxDataAgeMs: 1_000, maxTotalLatencyMs: 1_000, latencyPenaltyBpsPerSecond: 10 }
    );

    expect(result.accepted).toBe(false);
    expect(result.reasons.join(" ")).toContain("Total latency");
    expect(result.penaltyEdge).toBeGreaterThan(0);
  });

  it("scores high quality signals above threshold", () => {
    const result = scoreSignal(
      {
        signal: copySignal(),
        snapshot: snapshot(),
        realEdge: 0.03,
        expectedProfitUsd: 0.2,
        latency: {
          dataAgeMs: 100,
          signalDetectionLatencyMs: 100,
          decisionLatencyMs: 50,
          simulatedExecutionLatencyMs: 10,
          totalLatencyMs: 160
        },
        confirmations: ["copy-trader", "fresh-book", "tight-spread", "positive-edge"],
        highRisk: true
      },
      config()
    );

    expect(result.accepted).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(70);
    expect(result.confirmations.length).toBeGreaterThanOrEqual(2);
  });

  it("skips dumb copy trades when price already moved and data is stale", () => {
    const reasons = shouldSkipSmartCopy({
      signal: copySignal(),
      snapshot: snapshot({ currentEntryPrice: 0.6 }),
      latency: {
        dataAgeMs: 2_000,
        signalDetectionLatencyMs: 100,
        decisionLatencyMs: 50,
        simulatedExecutionLatencyMs: 10,
        totalLatencyMs: 2_160
      },
      config: config()
    });

    expect(reasons.join(" ")).toContain("price already moved");
    expect(reasons.join(" ")).toContain("stale");
    expect(reasons.join(" ")).toContain("latency");
  });

  it("throttles repeated low-quality signals", () => {
    const throttle = new SignalThrottle({
      maxSignalsPerMinute: 10,
      maxTradesPerMinute: 5,
      maxActiveMarkets: 5,
      lossCooldownSeconds: 60
    });
    for (let index = 0; index < 5; index += 1) throttle.recordSignal("condition", false, 1_000 + index);

    expect(throttle.evaluateSignal("condition", [], 2_000).join(" ")).toContain("repeated");
  });
});

describe("realistic fills and event queue", () => {
  it("records realistic fill friction fields", () => {
    const fill = simulateOrderBookFill(orderBook(), "BUY", 20, 0.01);

    expect(fill.partial).toBe(true);
    expect(fill.feeUsd).toBeGreaterThan(0);
    expect(fill.spreadCostUsd).toBeGreaterThanOrEqual(0);
  });

  it("drains highest priority market events first", () => {
    const queue = new MarketEventQueue();
    queue.enqueue({ type: "spread-widened", priority: scoreEvent("spread-widened"), reason: "wide" });
    queue.enqueue({ type: "whale-trade", priority: scoreEvent("whale-trade"), reason: "large trade" });

    expect(queue.drain(1)[0].type).toBe("whale-trade");
  });
});

function trade(id: string, pnl: number): StrategyPaperTrade {
  return {
    id,
    strategy: "market-making",
    conditionId: "condition",
    side: "BUY",
    shares: 1,
    entryCostUsd: 1,
    grossPnlUsd: pnl,
    realizedPnlUsd: pnl,
    unrealizedPnlUsd: 0,
    feesUsd: 0,
    slippageUsd: 0,
    edge: pnl,
    fillRate: 1,
    status: "filled",
    openedAt: new Date().toISOString(),
    closedAt: new Date().toISOString()
  };
}

function copySignal(): CopySignal {
  return {
    id: "signal",
    traderWallet: "0x1111111111111111111111111111111111111111",
    traderScore: 90,
    side: "BUY",
    assetId: "asset",
    conditionId: "condition",
    traderSize: 10,
    traderPrice: 0.5,
    traderNotionalUsd: 5,
    traderTradeTimestamp: Math.floor(Date.now() / 1000),
    copyDelaySeconds: 1,
    createdAt: new Date().toISOString(),
    sourceTradeId: "source"
  };
}

function snapshot(overrides: Partial<MarketSnapshot> = {}): MarketSnapshot {
  return {
    assetId: "asset",
    conditionId: "condition",
    spread: 0.01,
    bestBid: 0.49,
    bestAsk: 0.5,
    currentEntryPrice: 0.5,
    volumeUsd: 100_000,
    liquidityUsd: 50_000,
    availableLiquidityUsd: 1_000,
    ...overrides
  };
}

function config(): BotConfig {
  return {
    minSignalScore: 70,
    highRiskConfirmationCount: 2,
    minTraderScore: 75,
    minMarketVolumeUsd: 10_000,
    maxSpread: 0.015,
    maxDataAgeMs: 1_000,
    maxTotalLatencyMs: 1_000,
    minRealEdge: 0.01,
    minCopyTradeUsd: 5,
    maxCopyPriceDifference: 0.03
  } as BotConfig;
}

function orderBook(): OrderBook {
  return {
    market: "condition",
    asset_id: "asset",
    timestamp: String(Date.now()),
    hash: "hash",
    bids: [{ price: "0.49", size: "10" }],
    asks: [{ price: "0.50", size: "5" }],
    min_order_size: "1",
    tick_size: "0.01",
    neg_risk: false
  };
}
