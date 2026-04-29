import { EventEmitter } from "events";
import http from "http";
import express from "express";
import WebSocket from "ws";
import { logger } from "../logger";
import { OrderBook, OrderBookLevel, QuoteCacheEntry, QuoteDaemonHealth } from "../types";

const MARKET_WS_URL = "wss://ws-subscriptions-clob.polymarket.com/ws/market";
const LOCAL_HOST = "127.0.0.1";
const HEARTBEAT_MS = 10_000;
const WATCHDOG_INTERVAL_MS = 5_000;
const MIN_SILENCE_RECONNECT_MS = 30_000;

export interface QuoteDaemonOptions {
  enabled: boolean;
  apiPort: number;
  maxQuoteDelayMs: number;
  quoteFreshnessMs: number;
}

interface MutableQuote {
  assetId: string;
  bestBid?: number;
  bestAsk?: number;
  lastTradePrice?: number;
  eventTimestampMs?: number;
  receivedAtMs: number;
}

export class QuoteDaemon extends EventEmitter {
  private ws?: WebSocket;
  private server?: http.Server;
  private reconnectTimer?: NodeJS.Timeout;
  private pingTimer?: NodeJS.Timeout;
  private watchdogTimer?: NodeJS.Timeout;
  private readonly subscribedAssetIds = new Set<string>();
  private readonly quotes = new Map<string, MutableQuote>();
  private readonly books = new Map<string, OrderBook>();
  private connected = false;
  private lastMessageAtMs?: number;
  private lastSubscriptionAtMs?: number;
  private reconnects = 0;
  private reconnectAttempt = 0;

  constructor(private readonly options: QuoteDaemonOptions) {
    super();
  }

  async start(): Promise<void> {
    await this.startApi();
    if (this.options.enabled) this.connect();
  }

  async stop(): Promise<void> {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.watchdogTimer) clearInterval(this.watchdogTimer);
    this.ws?.close();
    await new Promise<void>((resolve) => {
      if (!this.server) return resolve();
      this.server.close(() => resolve());
    });
  }

  subscribe(assetIds: string[]): void {
    const nextIds = assetIds.filter(Boolean);
    const added = nextIds.filter((assetId) => !this.subscribedAssetIds.has(assetId));
    for (const assetId of added) this.subscribedAssetIds.add(assetId);
    if (!this.options.enabled || added.length === 0) return;

    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.connect();
      return;
    }

    this.sendSubscription(added);
  }

  setSubscriptions(assetIds: string[]): void {
    const nextAssetIds = [...new Set(assetIds.filter(Boolean))];
    const next = new Set(nextAssetIds);
    const removed = [...this.subscribedAssetIds].some((assetId) => !next.has(assetId));
    const added = nextAssetIds.filter((assetId) => !this.subscribedAssetIds.has(assetId));
    if (!removed && added.length === 0) return;

    this.subscribedAssetIds.clear();
    for (const assetId of nextAssetIds) this.subscribedAssetIds.add(assetId);
    for (const assetId of [...this.quotes.keys()]) {
      if (!next.has(assetId)) this.quotes.delete(assetId);
    }
    for (const assetId of [...this.books.keys()]) {
      if (!next.has(assetId)) this.books.delete(assetId);
    }
    if (!this.options.enabled) return;

    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.connect();
      return;
    }

    if (removed) {
      logger.info("Quote daemon subscriptions changed; reconnecting with active universe.", {
        subscribedAssets: nextAssetIds.length,
        removed: true
      });
      this.ws.terminate();
      this.scheduleReconnect("subscriptions");
      return;
    }

    this.sendSubscription(added);
  }

  getQuote(assetId: string): QuoteCacheEntry | undefined {
    const quote = this.quotes.get(assetId);
    return quote ? this.toQuoteEntry(quote) : undefined;
  }

  getQuotes(): QuoteCacheEntry[] {
    return [...this.quotes.values()].map((quote) => this.toQuoteEntry(quote));
  }

  getOrderBook(assetId: string): OrderBook | undefined {
    const quote = this.getQuote(assetId);
    const book = this.books.get(assetId);
    if (!quote?.isFresh || !book) return undefined;
    return {
      ...book,
      timestamp: quote.receivedAt,
      last_trade_price: quote.lastTradePrice === undefined ? book.last_trade_price : String(quote.lastTradePrice),
      bids: quote.bestBid === undefined ? [...book.bids] : replaceTopLevel(book.bids, quote.bestBid, "bid"),
      asks: quote.bestAsk === undefined ? [...book.asks] : replaceTopLevel(book.asks, quote.bestAsk, "ask")
    };
  }

  getCachedOrderBook(assetId: string): OrderBook | undefined {
    return this.getOrderBook(assetId);
  }

  getHealth(): QuoteDaemonHealth {
    const quotes = this.getQuotes();
    const delays = quotes.map((quote) => quote.quoteDelayMs).filter(Number.isFinite);
    const lastMessageAgeMs = this.lastMessageAtMs === undefined ? undefined : Math.max(0, Date.now() - this.lastMessageAtMs);
    return {
      enabled: this.options.enabled,
      connected: this.connected,
      subscribedAssets: this.subscribedAssetIds.size,
      quoteCount: quotes.length,
      lastMessageAt: this.lastMessageAtMs === undefined ? undefined : new Date(this.lastMessageAtMs).toISOString(),
      lastMessageAgeMs,
      averageQuoteDelayMs: round(delays.length === 0 ? 0 : delays.reduce((total, delay) => total + delay, 0) / delays.length),
      staleQuoteCount: quotes.filter((quote) => !quote.isFresh).length,
      reconnects: this.reconnects,
      apiHost: LOCAL_HOST,
      apiPort: this.options.apiPort
    };
  }

  handleMarketMessage(message: unknown): void {
    const records = Array.isArray(message) ? message : [message];
    for (const record of records) this.handleRecord(record);
    this.emit("status", this.getHealth());
  }

  private async startApi(): Promise<void> {
    const app = express();
    app.get("/quotes", (_req, res) => res.json(this.getQuotes()));
    app.get("/quotes/:assetId", (req, res) => {
      const quote = this.getQuote(req.params.assetId);
      if (!quote) return res.status(404).json({ error: "Quote not found." });
      return res.json(quote);
    });
    app.get("/health", (_req, res) => res.json(this.getHealth()));

    await new Promise<void>((resolve) => {
      this.server = app.listen(this.options.apiPort, LOCAL_HOST, () => resolve());
    });
    logger.info("Quote daemon local API started.", { host: LOCAL_HOST, port: this.options.apiPort });
  }

  private connect(): void {
    if (!this.options.enabled) return;
    if (this.ws && (this.ws.readyState === WebSocket.CONNECTING || this.ws.readyState === WebSocket.OPEN)) return;

    this.ws = new WebSocket(MARKET_WS_URL);
    this.ws.on("open", () => {
      this.connected = true;
      this.reconnectAttempt = 0;
      logger.info("Quote daemon WebSocket connected.", { subscribedAssets: this.subscribedAssetIds.size });
      this.emit("status", this.getHealth());
      this.sendSubscription([...this.subscribedAssetIds]);
      if (this.pingTimer) clearInterval(this.pingTimer);
      if (this.watchdogTimer) clearInterval(this.watchdogTimer);
      this.pingTimer = setInterval(() => this.ws?.send("PING"), HEARTBEAT_MS);
      this.watchdogTimer = setInterval(() => this.checkForSilentConnection(), WATCHDOG_INTERVAL_MS);
    });

    this.ws.on("message", (raw) => {
      const text = raw.toString();
      if (text === "PONG") return;
      try {
        this.lastMessageAtMs = Date.now();
        this.handleMarketMessage(JSON.parse(text));
      } catch {
        logger.debug("Quote daemon ignored non-JSON market message.", { text });
      }
    });

    this.ws.on("close", () => this.scheduleReconnect("closed"));
    this.ws.on("error", (error) => {
      logger.warn("Quote daemon WebSocket error.", { message: error.message });
      this.scheduleReconnect("error");
    });
  }

  private scheduleReconnect(reason: "closed" | "error" | "silent" | "subscriptions"): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.watchdogTimer) clearInterval(this.watchdogTimer);
    this.pingTimer = undefined;
    this.watchdogTimer = undefined;
    this.connected = false;
    this.emit("status", this.getHealth());
    if (!this.options.enabled || this.reconnectTimer) return;

    this.reconnects += 1;
    this.reconnectAttempt += 1;
    const delayMs = Math.min(30_000, 1_000 * 2 ** Math.min(5, this.reconnectAttempt));
    logger.warn("Quote daemon WebSocket reconnect scheduled.", { reason, delayMs, reconnects: this.reconnects });
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      this.connect();
    }, delayMs);
  }

  private sendSubscription(assetIds: string[]): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || assetIds.length === 0) return;
    this.lastSubscriptionAtMs = Date.now();
    this.ws.send(
      JSON.stringify({
        type: "market",
        assets_ids: assetIds,
        custom_feature_enabled: true
      })
    );
    logger.info("Quote daemon subscribed market assets.", { count: assetIds.length });
  }

  private handleRecord(record: unknown): void {
    if (!record || typeof record !== "object") return;
    const item = record as Record<string, unknown>;
    const eventType = String(item.event_type ?? item.type ?? "").toLowerCase();

    const priceChanges = Array.isArray(item.price_changes)
      ? item.price_changes
      : Array.isArray(item.changes)
        ? item.changes
        : undefined;
    if (eventType === "price_change" && priceChanges) {
      for (const change of priceChanges) this.handlePriceChange(change, item);
      return;
    }

    if (eventType === "book" || Array.isArray(item.bids) || Array.isArray(item.asks)) {
      this.handleBook(item);
      return;
    }

    if (eventType === "best_bid_ask") {
      this.upsertQuote(item, {
        bestBid: numberFrom(item.best_bid ?? item.bestBid ?? item.bid),
        bestAsk: numberFrom(item.best_ask ?? item.bestAsk ?? item.ask)
      });
      return;
    }

    if (eventType === "last_trade_price") {
      this.upsertQuote(item, {
        lastTradePrice: numberFrom(item.price ?? item.last_trade_price ?? item.lastTradePrice)
      });
      return;
    }

    if (item.asset_id || item.assetId) this.handlePriceChange(item, item);
  }

  private handleBook(item: Record<string, unknown>): void {
    const assetId = assetIdFrom(item);
    if (!assetId) return;
    const bids = normalizeLevels(Array.isArray(item.bids) ? item.bids : []);
    const asks = normalizeLevels(Array.isArray(item.asks) ? item.asks : []);
    const book: OrderBook = {
      market: String(item.market ?? item.condition_id ?? ""),
      asset_id: assetId,
      timestamp: String(item.timestamp ?? item.event_timestamp ?? Date.now()),
      hash: String(item.hash ?? `${assetId}-${Date.now()}`),
      bids,
      asks,
      min_order_size: String(item.min_order_size ?? "0"),
      tick_size: String(item.tick_size ?? "0.01"),
      neg_risk: Boolean(item.neg_risk),
      last_trade_price: item.last_trade_price === undefined ? undefined : String(item.last_trade_price)
    };
    this.books.set(assetId, book);
    this.upsertQuote(item, {
      bestBid: bestBid(bids),
      bestAsk: bestAsk(asks),
      lastTradePrice: numberFrom(item.last_trade_price)
    });
  }

  private handlePriceChange(change: unknown, parent: Record<string, unknown>): void {
    if (!change || typeof change !== "object") return;
    const item = change as Record<string, unknown>;
    const merged = { ...parent, ...item };
    const price = numberFrom(merged.price);
    const side = String(merged.side ?? merged.side_type ?? "").toLowerCase();
    const patch: Partial<MutableQuote> = {};

    patch.bestBid = numberFrom(merged.best_bid ?? merged.bestBid ?? merged.bid);
    patch.bestAsk = numberFrom(merged.best_ask ?? merged.bestAsk ?? merged.ask);

    if (patch.bestBid === undefined && (side.includes("buy") || side.includes("bid"))) patch.bestBid = price;
    if (patch.bestAsk === undefined && (side.includes("sell") || side.includes("ask"))) patch.bestAsk = price;
    if (patch.bestBid === undefined && patch.bestAsk === undefined) patch.lastTradePrice = price;

    this.applyPriceChangeToBook(merged, patch);
    this.upsertQuote(merged, patch);
  }

  private applyPriceChangeToBook(input: Record<string, unknown>, patch: Partial<MutableQuote>): void {
    const assetId = assetIdFrom(input);
    const book = assetId ? this.books.get(assetId) : undefined;
    if (!assetId || !book) return;

    const side = String(input.side ?? input.side_type ?? "").toLowerCase();
    const price = input.price;
    const size = input.size;
    if (price !== undefined && size !== undefined) {
      if (side.includes("buy") || side.includes("bid")) updateLevel(book.bids, String(price), String(size));
      if (side.includes("sell") || side.includes("ask")) updateLevel(book.asks, String(price), String(size));
    }

    if (patch.bestBid !== undefined) book.bids = replaceTopLevel(book.bids, patch.bestBid, "bid");
    if (patch.bestAsk !== undefined) book.asks = replaceTopLevel(book.asks, patch.bestAsk, "ask");
    book.timestamp = String(input.timestamp ?? input.event_timestamp ?? Date.now());
    book.market = String(input.market ?? book.market);
    if (input.hash !== undefined) book.hash = String(input.hash);
  }

  private upsertQuote(input: Record<string, unknown>, patch: Partial<MutableQuote>): void {
    const assetId = assetIdFrom(input);
    if (!assetId) return;
    const previous = this.quotes.get(assetId);
    const eventTimestampMs = timestampMs(input.timestamp ?? input.event_timestamp ?? input.ts) ?? previous?.eventTimestampMs ?? Date.now();
    const receivedAtMs = Date.now();
    const next: MutableQuote = {
      assetId,
      bestBid: patch.bestBid ?? previous?.bestBid,
      bestAsk: patch.bestAsk ?? previous?.bestAsk,
      lastTradePrice: patch.lastTradePrice ?? previous?.lastTradePrice,
      eventTimestampMs,
      receivedAtMs
    };
    this.quotes.set(assetId, next);
  }

  private toQuoteEntry(quote: MutableQuote): QuoteCacheEntry {
    const now = Date.now();
    const quoteDelayMs = Math.max(0, quote.receivedAtMs - (quote.eventTimestampMs ?? quote.receivedAtMs));
    const ageMs = Math.max(0, now - quote.receivedAtMs);
    return {
      assetId: quote.assetId,
      bestBid: quote.bestBid,
      bestAsk: quote.bestAsk,
      spread: quote.bestBid === undefined || quote.bestAsk === undefined ? undefined : Math.max(0, quote.bestAsk - quote.bestBid),
      lastTradePrice: quote.lastTradePrice,
      eventTimestamp: quote.eventTimestampMs === undefined ? undefined : new Date(quote.eventTimestampMs).toISOString(),
      receivedAt: new Date(quote.receivedAtMs).toISOString(),
      quoteDelayMs: round(quoteDelayMs),
      isFresh: quoteDelayMs <= this.options.maxQuoteDelayMs && ageMs <= this.options.quoteFreshnessMs
    };
  }

  private checkForSilentConnection(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || this.subscribedAssetIds.size === 0) return;
    const referenceMs = this.lastMessageAtMs ?? this.lastSubscriptionAtMs;
    if (!referenceMs) return;

    const silenceMs = Date.now() - referenceMs;
    const reconnectAfterMs = Math.max(
      MIN_SILENCE_RECONNECT_MS,
      this.options.maxQuoteDelayMs * 3,
      this.options.quoteFreshnessMs * 10
    );
    if (silenceMs <= reconnectAfterMs) return;

    logger.warn("Quote daemon WebSocket silent; forcing reconnect.", {
      silenceMs: Math.round(silenceMs),
      reconnectAfterMs,
      subscribedAssets: this.subscribedAssetIds.size
    });
    this.ws.terminate();
    this.scheduleReconnect("silent");
  }
}

function assetIdFrom(item: Record<string, unknown>): string {
  return String(item.asset_id ?? item.assetId ?? item.token_id ?? item.tokenId ?? "");
}

function normalizeLevels(levels: unknown[]): OrderBookLevel[] {
  return levels.flatMap((level) => {
    if (!level || typeof level !== "object") return [];
    const item = level as Record<string, unknown>;
    const price = item.price ?? item.p;
    const size = item.size ?? item.s;
    return price === undefined || size === undefined ? [] : [{ price: String(price), size: String(size) }];
  });
}

function bestBid(levels: OrderBookLevel[]): number | undefined {
  const prices = levels.map((level) => Number(level.price)).filter(Number.isFinite);
  return prices.length > 0 ? Math.max(...prices) : undefined;
}

function bestAsk(levels: OrderBookLevel[]): number | undefined {
  const prices = levels.map((level) => Number(level.price)).filter(Number.isFinite);
  return prices.length > 0 ? Math.min(...prices) : undefined;
}

function replaceTopLevel(levels: OrderBookLevel[], price: number, side: "bid" | "ask"): OrderBookLevel[] {
  const next = [...levels];
  const fallbackSize = next.find((level) => Number(level.price) === price)?.size ?? next[0]?.size ?? "1";
  const level = { price: String(price), size: fallbackSize };
  const existingIndex = next.findIndex((item) => Number(item.price) === price);
  if (existingIndex >= 0) next[existingIndex] = level;
  else next.push(level);
  return side === "bid"
    ? next.sort((a, b) => Number(b.price) - Number(a.price))
    : next.sort((a, b) => Number(a.price) - Number(b.price));
}

function updateLevel(levels: OrderBookLevel[], price: string, size: string): void {
  const numericSize = Number(size);
  const index = levels.findIndex((level) => Number(level.price) === Number(price));
  if (!Number.isFinite(numericSize) || numericSize <= 0) {
    if (index >= 0) levels.splice(index, 1);
    return;
  }

  if (index >= 0) levels[index] = { price, size };
  else levels.push({ price, size });
}

function numberFrom(value: unknown): number | undefined {
  if (value === undefined || value === null || (typeof value === "string" && value.trim() === "")) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function timestampMs(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric > 10_000_000_000 ? numeric : numeric * 1000;
  const parsed = new Date(String(value)).getTime();
  return Number.isFinite(parsed) ? parsed : undefined;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
