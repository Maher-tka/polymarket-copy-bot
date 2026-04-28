import { describe, expect, it } from "vitest";
import { QuoteDaemon } from "../src/marketData/quoteDaemon";
import { OrderBookCache } from "../src/strategy/orderBookCache";
import { OrderBook } from "../src/types";

describe("QuoteDaemon", () => {
  it("updates quote cache from market WebSocket events", () => {
    const daemon = new QuoteDaemon({
      enabled: false,
      apiPort: 0,
      maxQuoteDelayMs: 1_000,
      quoteFreshnessMs: 10_000
    });
    const timestamp = Date.now();

    daemon.handleMarketMessage([
      {
        event_type: "best_bid_ask",
        asset_id: "asset-1",
        best_bid: "0.48",
        best_ask: "0.52",
        timestamp
      },
      {
        event_type: "last_trade_price",
        asset_id: "asset-1",
        price: "0.51",
        timestamp
      }
    ]);

    const quote = daemon.getQuote("asset-1");
    expect(quote?.bestBid).toBe(0.48);
    expect(quote?.bestAsk).toBe(0.52);
    expect(quote?.spread).toBeCloseTo(0.04);
    expect(quote?.lastTradePrice).toBe(0.51);
    expect(quote?.isFresh).toBe(true);
  });

  it("lets the order book cache use daemon book events before REST", async () => {
    let restCalls = 0;
    const daemon = new QuoteDaemon({
      enabled: false,
      apiPort: 0,
      maxQuoteDelayMs: 1_000,
      quoteFreshnessMs: 10_000
    });
    daemon.handleMarketMessage({
      event_type: "book",
      asset_id: "asset-2",
      market: "condition",
      timestamp: Date.now(),
      bids: [{ price: "0.49", size: "10" }],
      asks: [{ price: "0.51", size: "10" }]
    });

    const cache = new OrderBookCache(
      {
        getOrderBook: async () => {
          restCalls += 1;
          return orderBook("asset-2");
        }
      } as never,
      { maxDataAgeMs: 1_000, maxQuoteDelayMs: 1_000, quoteDaemon: daemon }
    );

    const result = await cache.getFreshOrderBook("asset-2");
    expect(result.fromCache).toBe(true);
    expect(result.top.source).toBe("quote-daemon");
    expect(restCalls).toBe(0);
  });

  it("rejects stale daemon quotes instead of silently trading on delayed data", async () => {
    const daemon = new QuoteDaemon({
      enabled: false,
      apiPort: 0,
      maxQuoteDelayMs: 10,
      quoteFreshnessMs: 10_000
    });
    daemon.handleMarketMessage({
      event_type: "best_bid_ask",
      asset_id: "asset-3",
      best_bid: "0.49",
      best_ask: "0.51",
      timestamp: Date.now() - 1_000
    });

    const cache = new OrderBookCache({ getOrderBook: async () => orderBook("asset-3") } as never, {
      maxDataAgeMs: 1_000,
      maxQuoteDelayMs: 10,
      quoteDaemon: daemon
    });

    await expect(cache.getFreshOrderBook("asset-3")).rejects.toThrow("MAX_QUOTE_DELAY_MS");
  });
});

function orderBook(assetId: string): OrderBook {
  return {
    market: "condition",
    asset_id: assetId,
    timestamp: String(Date.now()),
    hash: "hash",
    bids: [{ price: "0.49", size: "10" }],
    asks: [{ price: "0.51", size: "10" }],
    min_order_size: "1",
    tick_size: "0.01",
    neg_risk: false
  };
}
