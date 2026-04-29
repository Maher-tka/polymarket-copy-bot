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

  it("handles official price_changes payloads and patches cached book top levels", () => {
    const daemon = new QuoteDaemon({
      enabled: false,
      apiPort: 0,
      maxQuoteDelayMs: 1_000,
      quoteFreshnessMs: 10_000
    });
    const timestamp = Date.now();

    daemon.handleMarketMessage({
      event_type: "book",
      asset_id: "asset-quote",
      market: "condition",
      timestamp,
      bids: [{ price: "0.48", size: "10" }],
      asks: [{ price: "0.52", size: "10" }]
    });
    daemon.handleMarketMessage({
      event_type: "price_change",
      market: "condition",
      timestamp,
      price_changes: [
        {
          asset_id: "asset-quote",
          price: "0.5",
          size: "25",
          side: "BUY",
          best_bid: "0.5",
          best_ask: "0.51"
        }
      ]
    });

    const quote = daemon.getQuote("asset-quote");
    const book = daemon.getOrderBook("asset-quote");
    expect(quote?.bestBid).toBe(0.5);
    expect(quote?.bestAsk).toBe(0.51);
    expect(book?.bids[0]).toEqual({ price: "0.5", size: "25" });
    expect(book?.asks[0]?.price).toBe("0.51");
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

  it("falls back to REST when daemon quotes are too delayed", async () => {
    let restCalls = 0;
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

    const cache = new OrderBookCache({ getOrderBook: async () => {
      restCalls += 1;
      return orderBook("asset-3");
    } } as never, {
      maxDataAgeMs: 1_000,
      maxQuoteDelayMs: 10,
      quoteDaemon: daemon
    });

    const result = await cache.getFreshOrderBook("asset-3");
    expect(result.fromCache).toBe(false);
    expect(restCalls).toBe(1);
  });

  it("prunes quotes outside the active subscription set", () => {
    const daemon = new QuoteDaemon({
      enabled: false,
      apiPort: 0,
      maxQuoteDelayMs: 1_000,
      quoteFreshnessMs: 10_000
    });

    daemon.handleMarketMessage([
      {
        event_type: "best_bid_ask",
        asset_id: "old-asset",
        best_bid: "0.49",
        best_ask: "0.51",
        timestamp: Date.now()
      },
      {
        event_type: "best_bid_ask",
        asset_id: "active-asset",
        best_bid: "0.48",
        best_ask: "0.52",
        timestamp: Date.now()
      }
    ]);

    daemon.setSubscriptions(["active-asset"]);

    expect(daemon.getQuote("old-asset")).toBeUndefined();
    expect(daemon.getQuote("active-asset")).toBeDefined();
    expect(daemon.getHealth().quoteCount).toBe(1);
  });

  it("uses one batch REST fallback for books missing from the low-latency cache", async () => {
    let batchCalls = 0;
    let singleCalls = 0;
    const daemon = new QuoteDaemon({
      enabled: false,
      apiPort: 0,
      maxQuoteDelayMs: 1_000,
      quoteFreshnessMs: 10_000
    });
    daemon.handleMarketMessage({
      event_type: "book",
      asset_id: "cached",
      market: "condition",
      timestamp: Date.now(),
      bids: [{ price: "0.49", size: "10" }],
      asks: [{ price: "0.51", size: "10" }]
    });

    const cache = new OrderBookCache(
      {
        getOrderBook: async (tokenId: string) => {
          singleCalls += 1;
          return orderBook(tokenId);
        },
        getOrderBooks: async (tokenIds: string[]) => {
          batchCalls += 1;
          return new Map(tokenIds.map((tokenId) => [tokenId, orderBook(tokenId)]));
        }
      } as never,
      { maxDataAgeMs: 1_000, maxQuoteDelayMs: 1_000, quoteDaemon: daemon }
    );

    const books = await cache.getFreshOrderBooks(["cached", "missing"]);

    expect(books.get("cached")?.asset_id).toBe("cached");
    expect(books.get("missing")?.asset_id).toBe("missing");
    expect(batchCalls).toBe(1);
    expect(singleCalls).toBe(0);
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
