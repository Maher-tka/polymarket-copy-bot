import {
  BinaryMarketCandidate,
  FillSimulation,
  GammaMarket,
  OrderBook,
  OrderBookLevel,
  TradeSide
} from "../types";

export function parseBinaryMarket(market: GammaMarket): BinaryMarketCandidate | undefined {
  const tokenIds = parseJsonArray(market.clobTokenIds);
  const outcomes = parseJsonArray(market.outcomes);
  if (!market.conditionId || tokenIds.length < 2) return undefined;

  return {
    conditionId: market.conditionId,
    slug: market.slug,
    title: market.question,
    volumeUsd: Number(market.volume24hr ?? market.volumeNum ?? market.volume ?? 0) || 0,
    liquidityUsd: Number(market.liquidityNum ?? market.liquidity ?? 0) || 0,
    yesTokenId: tokenIds[0],
    noTokenId: tokenIds[1],
    yesOutcome: outcomes[0] ?? "Yes",
    noOutcome: outcomes[1] ?? "No",
    endDate: market.endDateIso ?? market.endDateTime ?? market.endDate ?? market.gameStartTime
  };
}

export function isCryptoUpDownMarket(market: GammaMarket): boolean {
  const text = `${market.question ?? ""} ${market.slug ?? ""}`.toLowerCase();
  const crypto = ["bitcoin", "btc", "ethereum", "eth", "solana", "sol", "xrp", "doge", "crypto"].some((term) =>
    text.includes(term)
  );
  const upDown = text.includes("up or down") || text.includes("updown") || text.includes("up-down");
  return crypto && upDown;
}

export function isShortTermCryptoBinaryMarket(market: GammaMarket): boolean {
  const text = `${market.question ?? ""} ${market.slug ?? ""}`.toLowerCase();
  const crypto = ["bitcoin", "btc", "ethereum", "eth", "solana", "sol", "xrp", "doge", "crypto"].some((term) =>
    text.includes(term)
  );
  const shortTermBinary =
    isCryptoUpDownMarket(market) ||
    ["above", "below", "reach", "hit", "dip", "by april", "on april", "april 20-26"].some((term) =>
      text.includes(term)
    );

  return crypto && shortTermBinary;
}

export function isFiveOrFifteenMinuteCryptoMarket(input: { question?: string; title?: string; slug?: string }): boolean {
  const name = input.title ?? input.question ?? "";
  const text = `${name} ${input.slug ?? ""}`.toLowerCase();
  const crypto = ["bitcoin", "btc", "ethereum", "eth", "solana", "sol", "xrp", "doge"].some((term) =>
    text.includes(term)
  );
  const shortWindow =
    text.includes("5 minute") ||
    text.includes("5-minute") ||
    text.includes("5m") ||
    text.includes("15 minute") ||
    text.includes("15-minute") ||
    text.includes("15m") ||
    text.includes("up or down");
  return crypto && shortWindow;
}

export function effectiveTakerFeeRate(
  candidate: Pick<BinaryMarketCandidate, "title" | "slug">,
  rates: { takerFeeRate: number; cryptoTakerFeeRate?: number }
): number {
  return isFiveOrFifteenMinuteCryptoMarket(candidate)
    ? (rates.cryptoTakerFeeRate ?? rates.takerFeeRate)
    : rates.takerFeeRate;
}

export function calculateBinaryTakerFeeUsd(price: number, shares: number, feeRate: number): number {
  if (!Number.isFinite(price) || !Number.isFinite(shares) || !Number.isFinite(feeRate)) return 0;
  if (price <= 0 || shares <= 0 || feeRate <= 0) return 0;
  return shares * feeRate * price * (1 - price);
}

export function secondsUntilClose(endDate?: string, nowMs = Date.now()): number | undefined {
  if (!endDate) return undefined;
  const closeMs = new Date(endDate).getTime();
  if (!Number.isFinite(closeMs)) return undefined;
  return Math.max(0, (closeMs - nowMs) / 1000);
}

export function isInsideFinalEntryWindow(endDate: string | undefined, bufferSeconds: number, nowMs = Date.now()): boolean {
  const seconds = secondsUntilClose(endDate, nowMs);
  return seconds !== undefined && seconds <= bufferSeconds;
}

export function simulateOrderBookFill(
  orderBook: OrderBook,
  side: TradeSide,
  requestedShares: number,
  feeRate: number
): FillSimulation {
  const levels = side === "BUY" ? sortAsks(orderBook.asks) : sortBids(orderBook.bids);
  const topOfBookPrice = levels[0]?.price;
  let remaining = requestedShares;
  let filledShares = 0;
  let notionalUsd = 0;
  let depthUsd = 0;
  let feeUsd = 0;

  for (const level of levels) {
    depthUsd += level.price * level.size;
    if (remaining <= 0) continue;
    const sharesAtLevel = Math.min(remaining, level.size);
    filledShares += sharesAtLevel;
    notionalUsd += sharesAtLevel * level.price;
    feeUsd += calculateBinaryTakerFeeUsd(level.price, sharesAtLevel, feeRate);
    remaining -= sharesAtLevel;
  }

  const averagePrice = filledShares > 0 ? notionalUsd / filledShares : 0;
  const slippagePerShare =
    topOfBookPrice === undefined
      ? 0
      : side === "BUY"
        ? Math.max(0, averagePrice - topOfBookPrice)
        : Math.max(0, topOfBookPrice - averagePrice);
  const slippageUsd = slippagePerShare * filledShares;
  return {
    requestedShares,
    filledShares,
    fillRate: requestedShares > 0 ? filledShares / requestedShares : 0,
    averagePrice,
    topOfBookPrice,
    notionalUsd,
    slippageUsd,
    slippagePct: topOfBookPrice ? slippagePerShare / topOfBookPrice : 0,
    feeUsd,
    partial: filledShares + 1e-9 < requestedShares,
    depthUsd
  };
}

export function orderBookAgeMs(orderBook: OrderBook): number {
  const raw = Number(orderBook.timestamp);
  if (!Number.isFinite(raw)) {
    const parsed = new Date(orderBook.timestamp).getTime();
    return Number.isFinite(parsed) ? Math.max(0, Date.now() - parsed) : Number.POSITIVE_INFINITY;
  }
  const timestampMs = raw > 10_000_000_000 ? raw : raw * 1000;
  return Math.max(0, Date.now() - timestampMs);
}

export function bestAsk(orderBook: OrderBook): number | undefined {
  return sortAsks(orderBook.asks)[0]?.price;
}

export function bestBid(orderBook: OrderBook): number | undefined {
  return sortBids(orderBook.bids)[0]?.price;
}

export function spread(orderBook: OrderBook): number {
  const bid = bestBid(orderBook);
  const ask = bestAsk(orderBook);
  if (bid === undefined || ask === undefined) return Number.POSITIVE_INFINITY;
  return Math.max(0, ask - bid);
}

export function midpoint(orderBook: OrderBook): number | undefined {
  const bid = bestBid(orderBook);
  const ask = bestAsk(orderBook);
  if (bid === undefined || ask === undefined) return undefined;
  return (bid + ask) / 2;
}

export function parseJsonArray(value: string | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return value
      .split(",")
      .map((item) => item.replace(/[[\]"']/g, "").trim())
      .filter(Boolean);
  }
}

function sortAsks(levels: OrderBookLevel[]): Array<{ price: number; size: number }> {
  return parseLevels(levels).sort((a, b) => a.price - b.price);
}

function sortBids(levels: OrderBookLevel[]): Array<{ price: number; size: number }> {
  return parseLevels(levels).sort((a, b) => b.price - a.price);
}

function parseLevels(levels: OrderBookLevel[]): Array<{ price: number; size: number }> {
  return levels
    .map((level) => ({ price: Number(level.price), size: Number(level.size) }))
    .filter((level) => Number.isFinite(level.price) && Number.isFinite(level.size) && level.price > 0 && level.size > 0);
}
