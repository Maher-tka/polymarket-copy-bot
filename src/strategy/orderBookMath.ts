import {
  BinaryMarketCandidate,
  FillSimulation,
  GammaMarket,
  OrderBook,
  OrderBookLevel,
  TradeSide
} from "../types";

export function parseBinaryMarket(market: GammaMarket): BinaryMarketCandidate | undefined {
  const tokenIds = parseLosslessTokenIdArray(market.clobTokenIds);
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

function parseLosslessTokenIdArray(value: string | undefined): string[] {
  if (!value) return [];
  const trimmed = value.trim();

  // Gamma's `clobTokenIds` is often a JSON-encoded array of *numbers*. JSON.parse would coerce
  // those into JS Numbers and lose precision for 256-bit-like token IDs, producing invalid
  // token IDs (and downstream CLOB 404s). Instead, extract the raw digits directly.
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    const matches = [...trimmed.matchAll(/"(\d+)"|(\d+)/g)];
    const extracted = matches.map((match) => match[1] ?? match[2]).filter(Boolean) as string[];
    if (extracted.length > 0) return extracted;
  }

  // Fallback for non-JSON or unexpected formats (comma-separated, etc.).
  return parseJsonArray(value);
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
    /\b5\s*-?\s*(minute|minutes|min)\b/.test(text) ||
    /\b15\s*-?\s*(minute|minutes|min)\b/.test(text) ||
    /\b5m\b/.test(text) ||
    /\b15m\b/.test(text) ||
    /\d{1,2}:\d{2}\s*(am|pm)?\s*-\s*\d{1,2}:\d{2}\s*(am|pm)?/.test(text);
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

export function secondsUntilCandidateClose(
  candidate: Pick<BinaryMarketCandidate, "endDate" | "title" | "slug">,
  nowMs = Date.now()
): number | undefined {
  const titleCloseMs = parseEtWindowEndMs(candidate.title ?? candidate.slug, nowMs);
  if (titleCloseMs !== undefined) return Math.max(0, (titleCloseMs - nowMs) / 1000);
  return secondsUntilClose(candidate.endDate, nowMs);
}

export function isInsideCandidateFinalEntryWindow(
  candidate: Pick<BinaryMarketCandidate, "endDate" | "title" | "slug">,
  bufferSeconds: number,
  nowMs = Date.now()
): boolean {
  const seconds = secondsUntilCandidateClose(candidate, nowMs);
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
  const spreadCostUsd =
    topOfBookPrice === undefined ? 0 : Math.max(0, Math.abs(averagePrice - topOfBookPrice)) * filledShares;
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
    spreadCostUsd,
    staleDataPenaltyUsd: 0,
    queueUncertaintyUsd: 0,
    adverseSelectionUsd: 0,
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

const MONTH_INDEX: Record<string, number> = {
  january: 0,
  february: 1,
  march: 2,
  april: 3,
  may: 4,
  june: 5,
  july: 6,
  august: 7,
  september: 8,
  october: 9,
  november: 10,
  december: 11
};

function parseEtWindowEndMs(text: string | undefined, nowMs: number): number | undefined {
  if (!text) return undefined;
  const match = text.match(
    /(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2}),\s+\d{1,2}(?::\d{2})?\s*(am|pm)\s*-\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)\s*et/i
  );
  if (!match) return undefined;

  const month = MONTH_INDEX[match[1].toLowerCase()];
  const day = Number(match[2]);
  const hour = toTwentyFourHour(Number(match[4]), match[6]);
  const minute = Number(match[5] ?? 0);
  if (month === undefined || !Number.isFinite(day) || !Number.isFinite(hour) || !Number.isFinite(minute)) return undefined;

  const now = new Date(nowMs);
  const year = closestYearForMonth(now.getUTCFullYear(), month, nowMs, day, hour, minute);
  return zonedNewYorkTimeToUtcMs(year, month, day, hour, minute);
}

function toTwentyFourHour(hour: number, period: string): number {
  const normalized = hour % 12;
  return period.toLowerCase() === "pm" ? normalized + 12 : normalized;
}

function closestYearForMonth(baseYear: number, month: number, nowMs: number, day: number, hour: number, minute: number): number {
  const candidates = [baseYear - 1, baseYear, baseYear + 1];
  return candidates
    .map((year) => ({ year, distance: Math.abs(zonedNewYorkTimeToUtcMs(year, month, day, hour, minute) - nowMs) }))
    .sort((a, b) => a.distance - b.distance)[0].year;
}

function zonedNewYorkTimeToUtcMs(year: number, month: number, day: number, hour: number, minute: number): number {
  const guess = Date.UTC(year, month, day, hour, minute);
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  });
  const parts = Object.fromEntries(formatter.formatToParts(new Date(guess)).map((part) => [part.type, part.value]));
  const zonedAsUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) % 24,
    Number(parts.minute),
    Number(parts.second)
  );
  return guess - (zonedAsUtc - guess);
}
