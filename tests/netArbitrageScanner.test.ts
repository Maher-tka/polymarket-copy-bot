import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { RiskManager } from "../src/risk/riskManager";
import { StrategyRiskManager } from "../src/risk/strategyRiskManager";
import { NetArbitrageScanner } from "../src/strategy/netArbitrageScanner";
import { StrategyStateStore } from "../src/strategy/strategyState";
import { LocalDatabase } from "../src/storage/localDatabase";
import { StrategyPaperTrader } from "../src/trading/strategyPaperTrader";
import { BinaryMarketCandidate, BotConfig, OrderBook, PortfolioSnapshot } from "../src/types";

const now = String(Date.now());
const candidate: BinaryMarketCandidate = {
  conditionId: "condition",
  title: "Bitcoin Up or Down test",
  volumeUsd: 100000,
  liquidityUsd: 100000,
  yesTokenId: "yes",
  noTokenId: "no",
  yesOutcome: "Up",
  noOutcome: "Down"
};

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

const config = {
  maxTradeUsd: 5,
  maxTradeSizeUsd: 5,
  maxMarketExposureUsd: 5,
  maxDailyLossUsd: 8,
  maxOpenPositions: 2,
  stopAfterErrors: 3,
  maxDailyLossPct: 0.02,
  maxDeployedCapitalPct: 0.25,
  maxPositionSizePct: 0.05,
  maxOneMarketExposureUsd: 5,
  maxStrategyOpenPositions: 2,
  maxSlippage: 0.003,
  stopAfterFailedFills: 3,
  stopAfterConsecutiveLosses: 3,
  minNetArbEdge: 0.025,
  minOrderBookDepthUsd: 25,
  minDepthMultiplier: 5,
  maxStaleDataMs: 500,
  maxDataAgeMs: 500,
  maxSpread: 0.02,
  arbitrageTargetShares: 5,
  takerFeeRate: 0,
  cryptoTakerFeeRate: 0,
  finalEntryBufferSeconds: 45,
  forcedRiskCheckSeconds: 60,
  makerFailedFillRiskBps: 30,
  requireBothLegsFillable: true,
  rejectPartialFills: true
} satisfies Partial<BotConfig> as BotConfig;

describe("NetArbitrageScanner", () => {
  it("rejects partial fills instead of pretending the pair was filled", async () => {
    const store = new StrategyStateStore(new LocalDatabase(mkdtempSync(join(tmpdir(), "poly-test-"))), {
      realTradingEnabled: false,
      recorderEnabled: false,
      backtestMode: false
    });
    const scanner = new NetArbitrageScanner(
      fakeClob({
        yes: book("yes", [{ price: "0.45", size: "1" }]),
        no: book("no", [{ price: "0.50", size: "20" }])
      }),
      store,
      new StrategyPaperTrader(store),
      new StrategyRiskManager(config, new RiskManager(config)),
      config
    );

    await scanner.scan([candidate], portfolio);

    const state = store.getState();
    expect(state.paperTrades).toHaveLength(0);
    expect(state.rejectedSignals[0].reasons.join(" ")).toContain("Partial fills");
    expect(state.diagnostics[0].partialFill).toBe(true);
  });

  it("calculates YES plus NO net arbitrage edge before taking a paper trade", async () => {
    const store = makeStore();
    const scanner = makeScanner(
      store,
      fakeClob({
        yes: book("yes", [{ price: "0.45", size: "200" }]),
        no: book("no", [{ price: "0.50", size: "200" }])
      }),
      { minOrderBookDepthUsd: 1, minDepthMultiplier: 1, maxSpread: 0.1 }
    );

    await scanner.scan([candidate], portfolio);

    const state = store.getState();
    expect(state.paperTrades).toHaveLength(1);
    expect(state.diagnostics[0].rawEdge).toBeCloseTo(0.05);
    expect(state.diagnostics[0].netEdge).toBeCloseTo(0.05);
  });

  it("rejects stale data older than MAX_DATA_AGE_MS", async () => {
    const store = makeStore();
    const scanner = makeScanner(
      store,
      fakeClob({
        yes: book("yes", [{ price: "0.45", size: "200" }], Date.now() - 2_000),
        no: book("no", [{ price: "0.50", size: "200" }], Date.now() - 2_000)
      }),
      { minOrderBookDepthUsd: 1, minDepthMultiplier: 1, maxDataAgeMs: 300, maxStaleDataMs: 300 }
    );

    await scanner.scan([candidate], portfolio);

    expect(store.getState().paperTrades).toHaveLength(0);
    expect(store.getState().rejectedSignals[0].reasons.join(" ")).toContain("Stale order book data");
  });

  it("rejects markets inside the final 45 second entry window", async () => {
    const store = makeStore();
    const scanner = makeScanner(
      store,
      fakeClob({
        yes: book("yes", [{ price: "0.45", size: "200" }]),
        no: book("no", [{ price: "0.50", size: "200" }])
      }),
      { minOrderBookDepthUsd: 1, minDepthMultiplier: 1 }
    );

    await scanner.scan([{ ...candidate, endDate: new Date(Date.now() + 30_000).toISOString() }], portfolio);

    expect(store.getState().paperTrades).toHaveLength(0);
    expect(store.getState().diagnostics[0].tooCloseToClose).toBe(true);
    expect(store.getState().rejectedSignals[0].reasons.join(" ")).toContain("final 45s entry buffer");
  });

  it("rejects quotes without 5x orderbook depth even when top size can fill", async () => {
    const store = makeStore();
    const scanner = makeScanner(
      store,
      fakeClob({
        yes: book("yes", [{ price: "0.45", size: "5" }]),
        no: book("no", [{ price: "0.50", size: "5" }])
      }),
      { minOrderBookDepthUsd: 25, minDepthMultiplier: 5 }
    );

    await scanner.scan([candidate], portfolio);

    expect(store.getState().paperTrades).toHaveLength(0);
    expect(store.getState().rejectedSignals[0].reasons.join(" ")).toContain("Insufficient order book depth");
  });
});

function makeStore() {
  return new StrategyStateStore(new LocalDatabase(mkdtempSync(join(tmpdir(), "poly-test-"))), {
    realTradingEnabled: false,
    recorderEnabled: false,
    backtestMode: false
  });
}

function makeScanner(
  store: StrategyStateStore,
  clob: never,
  overrides: Partial<BotConfig> = {}
): NetArbitrageScanner {
  const merged = { ...config, ...overrides } as BotConfig;
  return new NetArbitrageScanner(
    clob,
    store,
    new StrategyPaperTrader(store),
    new StrategyRiskManager(merged, new RiskManager(merged)),
    merged
  );
}

function fakeClob(books: Record<string, OrderBook>) {
  return {
    getOrderBook: async (tokenId: string) => books[tokenId]
  } as never;
}

function book(assetId: string, asks: Array<{ price: string; size: string }>, timestampMs = Date.now()): OrderBook {
  return {
    market: "condition",
    asset_id: assetId,
    timestamp: String(timestampMs),
    hash: `${assetId}-hash`,
    bids: [{ price: "0.44", size: "100" }],
    asks,
    min_order_size: "1",
    tick_size: "0.01",
    neg_risk: false
  };
}
