import { describe, expect, it } from "vitest";
import { GammaMarket, OrderBook } from "../src/types";
import {
  calculateBinaryTakerFeeUsd,
  isCryptoUpDownMarket,
  isFiveOrFifteenMinuteCryptoMarket,
  isInsideFinalEntryWindow,
  isShortTermCryptoBinaryMarket,
  orderBookAgeMs,
  parseBinaryMarket,
  secondsUntilClose,
  simulateOrderBookFill
} from "../src/strategy/orderBookMath";

const book: OrderBook = {
  market: "condition",
  asset_id: "asset",
  timestamp: String(Date.now()),
  hash: "hash",
  bids: [
    { price: "0.49", size: "10" },
    { price: "0.48", size: "10" }
  ],
  asks: [
    { price: "0.51", size: "5" },
    { price: "0.53", size: "10" }
  ],
  min_order_size: "1",
  tick_size: "0.01",
  neg_risk: false
};

describe("simulateOrderBookFill", () => {
  it("walks asks and measures slippage for taker buys", () => {
    const fill = simulateOrderBookFill(book, "BUY", 10, 0.01);

    expect(fill.filledShares).toBe(10);
    expect(fill.averagePrice).toBeCloseTo(0.52);
    expect(fill.slippageUsd).toBeCloseTo(0.1);
    expect(fill.feeUsd).toBeCloseTo(0.02495);
    expect(fill.partial).toBe(false);
  });

  it("uses binary taker fee math that is highest around 50/50 prices", () => {
    const feeAtHalf = calculateBinaryTakerFeeUsd(0.5, 100, 0.072);
    const feeAtNinety = calculateBinaryTakerFeeUsd(0.9, 100, 0.072);

    expect(feeAtHalf).toBeCloseTo(1.8);
    expect(feeAtNinety).toBeCloseTo(0.648);
    expect(feeAtHalf).toBeGreaterThan(feeAtNinety);
  });

  it("marks partial fills when depth is insufficient", () => {
    const fill = simulateOrderBookFill(book, "BUY", 100, 0);

    expect(fill.partial).toBe(true);
    expect(fill.fillRate).toBeLessThan(1);
  });
});

describe("crypto market helpers", () => {
  it("detects true crypto Up/Down markets first", () => {
    const market = { question: "Bitcoin Up or Down - April 26, 4PM ET", slug: "bitcoin-up-or-down-april-26-2026-4pm-et" };

    expect(isCryptoUpDownMarket(market)).toBe(true);
    expect(isShortTermCryptoBinaryMarket(market)).toBe(true);
    expect(isFiveOrFifteenMinuteCryptoMarket(market)).toBe(true);
  });

  it("keeps short-term crypto threshold markets as a fallback universe", () => {
    const market = { question: "Will the price of Bitcoin be above $84,000 on April 27?", slug: "bitcoin-above-84k-on-april-27" };

    expect(isCryptoUpDownMarket(market)).toBe(false);
    expect(isShortTermCryptoBinaryMarket(market)).toBe(true);
  });

  it("uses 24 hour volume when building strategy candidates", () => {
    const endDate = new Date(Date.now() + 120_000).toISOString();
    const market: GammaMarket = {
      conditionId: "condition",
      question: "Bitcoin Up or Down - April 26, 4PM ET",
      clobTokenIds: "[\"yes\", \"no\"]",
      outcomes: "[\"Up\", \"Down\"]",
      volume24hr: 123,
      volumeNum: 999,
      endDateIso: endDate
    };

    expect(parseBinaryMarket(market)?.volumeUsd).toBe(123);
    expect(parseBinaryMarket(market)?.endDate).toBe(endDate);
  });

  it("understands ISO order book timestamps and final entry windows", () => {
    const freshBook = { ...book, timestamp: new Date().toISOString() };
    const closeSoon = new Date(Date.now() + 30_000).toISOString();

    expect(orderBookAgeMs(freshBook)).toBeLessThan(1000);
    expect(secondsUntilClose(closeSoon)).toBeGreaterThan(0);
    expect(isInsideFinalEntryWindow(closeSoon, 45)).toBe(true);
  });
});
