import { ClobPublicClient } from "../polymarket/clobPublicClient";
import { MarketEvent } from "../types";
import { bestAsk, bestBid, orderBookAgeMs, spread } from "./orderBookMath";
import { MarketEventQueue, scoreEvent } from "./eventQueue";
import { OrderBook, QuoteCacheEntry } from "../types";
import { QuoteDaemon } from "../marketData/quoteDaemon";

export interface CachedTopOfBook {
  tokenId: string;
  bestBid?: number;
  bestAsk?: number;
  spread: number;
  dataAgeMs: number;
  updatedAt: string;
  stale: boolean;
  staleReason?: string;
  source: "websocket" | "rest" | "quote-daemon";
}

export class OrderBookCache {
  private readonly books = new Map<string, { book: OrderBook; updatedAtMs: number; source: "websocket" | "rest" | "quote-daemon" }>();
  private readonly noOrderBookUntilMs = new Map<string, number>();
  private readonly noOrderBookTtlMs = 10 * 60_000;

  constructor(
    private readonly clobClient: ClobPublicClient,
    private readonly options: {
      maxDataAgeMs: number;
      maxQuoteDelayMs?: number;
      eventQueue?: MarketEventQueue;
      quoteDaemon?: QuoteDaemon;
    }
  ) {}

  getTopOfBook(tokenId: string): CachedTopOfBook | undefined {
    const cached = this.books.get(tokenId);
    if (!cached) return undefined;
    return this.toTopOfBook(tokenId, cached.book, cached.updatedAtMs, cached.source);
  }

  async getFreshOrderBook(tokenId: string): Promise<{ book: OrderBook; top: CachedTopOfBook; fromCache: boolean }> {
    if (this.isNoOrderBookCached(tokenId)) {
      throw new Error(`CLOB orderbook missing for token id ${tokenId} (cached).`);
    }

    const cached = this.getFreshCachedOrderBook(tokenId);
    if (cached) return cached;

    const book = await this.clobClient.getOrderBook(tokenId).catch((error) => {
      if (this.isNoOrderBookError(error)) this.cacheNoOrderBook(tokenId, "rest");
      throw error;
    });
    this.observeOrderBook(book, "rest");
    const top = this.getTopOfBook(tokenId);
    if (!top) {
      throw new Error(`Order book cache failed to store token ${tokenId}.`);
    }
    return { book, top, fromCache: false };
  }

  async getFreshOrderBooks(tokenIds: string[]): Promise<Map<string, OrderBook>> {
    const output = new Map<string, OrderBook>();
    const missingTokenIds: string[] = [];

    for (const tokenId of [...new Set(tokenIds.filter(Boolean))]) {
      if (this.isNoOrderBookCached(tokenId)) continue;
      const cached = this.getFreshCachedOrderBook(tokenId);
      if (cached) {
        output.set(tokenId, cached.book);
      } else {
        missingTokenIds.push(tokenId);
      }
    }

    if (missingTokenIds.length > 0) {
      const books = await this.clobClient.getOrderBooks(missingTokenIds);
      for (const book of books.values()) {
        this.observeOrderBook(book, "rest");
        output.set(book.asset_id, book);
      }
    }

    return output;
  }

  private getFreshCachedOrderBook(tokenId: string): { book: OrderBook; top: CachedTopOfBook; fromCache: boolean } | undefined {
    if (this.isNoOrderBookCached(tokenId)) {
      throw new Error(`CLOB orderbook missing for token id ${tokenId} (cached).`);
    }

    const quote = this.options.quoteDaemon?.getQuote(tokenId);
    const usableQuote =
      quote && quote.quoteDelayMs <= (this.options.maxQuoteDelayMs ?? this.options.maxDataAgeMs) ? quote : undefined;

    const quoteBook = this.options.quoteDaemon?.getOrderBook(tokenId);
    if (quoteBook) {
      this.observeOrderBook(quoteBook, "quote-daemon");
      const top = this.getTopOfBook(tokenId);
      if (top && !top.stale) return { book: quoteBook, top, fromCache: true };
    }

    const patchedBook = usableQuote ? this.mergeQuoteIntoCachedBook(tokenId, usableQuote) : undefined;
    if (patchedBook) {
      this.observeOrderBook(patchedBook, "quote-daemon");
      const top = this.getTopOfBook(tokenId);
      if (top && !top.stale) return { book: patchedBook, top, fromCache: true };
    }

    const cachedTop = this.getTopOfBook(tokenId);
    if (cachedTop && !cachedTop.stale) {
      const cached = this.books.get(tokenId);
      if (cached) return { book: cached.book, top: cachedTop, fromCache: true };
    }

    return undefined;
  }

  observeOrderBook(book: OrderBook, source: "websocket" | "rest" | "quote-daemon" = "rest"): void {
    const tokenId = book.asset_id;
    const previous = this.getTopOfBook(tokenId);
    this.books.set(tokenId, { book, updatedAtMs: Date.now(), source });
    const next = this.getTopOfBook(tokenId);
    if (next) this.detectEvents(previous, next, book.market, tokenId);
  }

  observeWebSocketMessage(message: unknown): void {
    if (!message || typeof message !== "object") return;
    const records = Array.isArray(message) ? message : [message];
    for (const record of records) {
      if (!record || typeof record !== "object") continue;
      const item = record as Record<string, unknown>;
      const assetId = String(item.asset_id ?? item.assetId ?? item.token_id ?? "");
      const market = String(item.market ?? item.condition_id ?? "");
      if (!assetId) continue;

      const bids = Array.isArray(item.bids) ? item.bids : [];
      const asks = Array.isArray(item.asks) ? item.asks : [];
      if (bids.length === 0 && asks.length === 0) continue;

      this.observeOrderBook(
        {
          market,
          asset_id: assetId,
          timestamp: String(item.timestamp ?? Date.now()),
          hash: String(item.hash ?? `${assetId}-${Date.now()}`),
          bids: normalizeLevels(bids),
          asks: normalizeLevels(asks),
          min_order_size: String(item.min_order_size ?? "0"),
          tick_size: String(item.tick_size ?? "0.01"),
          neg_risk: Boolean(item.neg_risk),
          last_trade_price: item.last_trade_price === undefined ? undefined : String(item.last_trade_price)
        },
        "websocket"
      );
    }
  }

  getStaleReason(tokenId: string): string | undefined {
    return this.getTopOfBook(tokenId)?.staleReason;
  }

  snapshot(): CachedTopOfBook[] {
    return [...this.books.keys()].flatMap((tokenId) => {
      const top = this.getTopOfBook(tokenId);
      return top ? [top] : [];
    });
  }

  private toTopOfBook(
    tokenId: string,
    book: OrderBook,
    updatedAtMs: number,
    source: "websocket" | "rest"
      | "quote-daemon"
  ): CachedTopOfBook {
    const dataAgeMs = Math.max(Date.now() - updatedAtMs, orderBookAgeMs(book));
    const stale = dataAgeMs > this.options.maxDataAgeMs;
    return {
      tokenId,
      bestBid: bestBid(book),
      bestAsk: bestAsk(book),
      spread: spread(book),
      dataAgeMs,
      updatedAt: new Date(updatedAtMs).toISOString(),
      stale,
      staleReason: stale ? `Cached order book is stale: ${Math.round(dataAgeMs)}ms old.` : undefined,
      source
    };
  }

  private mergeQuoteIntoCachedBook(tokenId: string, quote: QuoteCacheEntry): OrderBook | undefined {
    if (!quote.isFresh) return undefined;
    const cached = this.books.get(tokenId);
    if (!cached) return undefined;
    return {
      ...cached.book,
      timestamp: quote.eventTimestamp ?? quote.receivedAt,
      hash: `${cached.book.hash}-quote-${Date.now()}`,
      bids: quote.bestBid === undefined ? cached.book.bids : replaceTopLevel(cached.book.bids, quote.bestBid, "bid"),
      asks: quote.bestAsk === undefined ? cached.book.asks : replaceTopLevel(cached.book.asks, quote.bestAsk, "ask"),
      last_trade_price: quote.lastTradePrice === undefined ? cached.book.last_trade_price : String(quote.lastTradePrice)
    };
  }

  private detectEvents(previous: CachedTopOfBook | undefined, next: CachedTopOfBook, conditionId: string, tokenId: string): void {
    const queue = this.options.eventQueue;
    if (!queue || !previous) {
      if (queue && next.stale) {
        queue.enqueue({
          type: "freshness-lost",
          priority: scoreEvent("freshness-lost"),
          conditionId,
          tokenId,
          reason: next.staleReason ?? "Order book freshness lost.",
          dataAgeMs: next.dataAgeMs
        });
      }
      return;
    }

    const events: Array<Omit<MarketEvent, "id" | "timestamp">> = [];
    if (previous.stale && !next.stale) {
      events.push({
        type: "freshness-restored",
        priority: scoreEvent("freshness-restored"),
        conditionId,
        tokenId,
        reason: "Order book freshness restored.",
        dataAgeMs: next.dataAgeMs
      });
    }
    if (!previous.stale && next.stale) {
      events.push({
        type: "freshness-lost",
        priority: scoreEvent("freshness-lost"),
        conditionId,
        tokenId,
        reason: next.staleReason ?? "Order book freshness lost.",
        dataAgeMs: next.dataAgeMs
      });
    }
    if (Number.isFinite(previous.spread) && Number.isFinite(next.spread)) {
      if (next.spread >= previous.spread * 1.5 && next.spread - previous.spread > 0.005) {
        events.push({
          type: "spread-widened",
          priority: scoreEvent("spread-widened"),
          conditionId,
          tokenId,
          reason: "Spread widened materially.",
          spread: next.spread
        });
      }
      if (previous.spread >= next.spread * 1.5 && previous.spread - next.spread > 0.005) {
        events.push({
          type: "spread-tightened",
          priority: scoreEvent("spread-tightened"),
          conditionId,
          tokenId,
          reason: "Spread tightened materially.",
          spread: next.spread
        });
      }
    }
    const previousMid = midpoint(previous);
    const nextMid = midpoint(next);
    if (previousMid !== undefined && nextMid !== undefined && Math.abs(nextMid - previousMid) > 0.02) {
      events.push({
        type: "price-jump",
        priority: scoreEvent("price-jump"),
        conditionId,
        tokenId,
        reason: "Top-of-book midpoint jumped.",
        spread: next.spread
      });
    }

    for (const event of events) queue.enqueue(event);
  }

  private isNoOrderBookCached(tokenId: string): boolean {
    const until = this.noOrderBookUntilMs.get(tokenId);
    if (!until) return false;
    if (Date.now() < until) return true;
    this.noOrderBookUntilMs.delete(tokenId);
    return false;
  }

  private cacheNoOrderBook(tokenId: string, source: "rest" | "quote-daemon"): void {
    const until = Date.now() + this.noOrderBookTtlMs;
    this.noOrderBookUntilMs.set(tokenId, until);
    this.options.eventQueue?.enqueue({
      type: "freshness-lost",
      priority: scoreEvent("freshness-lost"),
      tokenId,
      reason: `No orderbook exists for token id (source: ${source}).`,
      dataAgeMs: Number.POSITIVE_INFINITY
    });
  }

  private isNoOrderBookError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return message.toLowerCase().includes("no orderbook exists for the requested token id");
  }
}

function replaceTopLevel(levels: Array<{ price: string; size: string }>, price: number, side: "bid" | "ask"): Array<{ price: string; size: string }> {
  const existing = [...levels];
  const fallbackSize = existing[0]?.size ?? "1";
  const nextLevel = { price: String(price), size: fallbackSize };
  if (existing.length === 0) return [nextLevel];

  existing[0] = nextLevel;
  return side === "bid"
    ? existing.sort((a, b) => Number(b.price) - Number(a.price))
    : existing.sort((a, b) => Number(a.price) - Number(b.price));
}

function normalizeLevels(levels: unknown[]): Array<{ price: string; size: string }> {
  return levels.flatMap((level) => {
    if (!level || typeof level !== "object") return [];
    const item = level as Record<string, unknown>;
    const price = item.price ?? item.p;
    const size = item.size ?? item.s;
    return price === undefined || size === undefined ? [] : [{ price: String(price), size: String(size) }];
  });
}

function midpoint(top: CachedTopOfBook): number | undefined {
  if (top.bestBid === undefined || top.bestAsk === undefined) return undefined;
  return (top.bestBid + top.bestAsk) / 2;
}
