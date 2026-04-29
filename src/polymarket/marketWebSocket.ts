import { EventEmitter } from "events";
import WebSocket from "ws";
import { logger } from "../logger";
import { OrderBook, OrderBookLevel } from "../types";

const MARKET_WS_URL = "wss://ws-subscriptions-clob.polymarket.com/ws/market";

export class MarketWebSocket extends EventEmitter {
  private ws?: WebSocket;
  private pingTimer?: NodeJS.Timeout;
  private silenceTimer?: NodeJS.Timeout;
  private reconnectTimer?: NodeJS.Timeout;
  private readonly subscribedAssetIds = new Set<string>();
  private connected = false;
  private lastMessageAt?: string;
  private lastDataMessageAtMs?: number;
  private lastPingSentAt?: number;
  private latencyMs?: number;
  private readonly orderBooks = new Map<string, OrderBook>();
  private reconnectAttempts = 0;
  private manuallyClosed = false;
  private readonly maxSilenceMs = 45_000;

  connect(initialAssetIds: string[] = []): void {
    for (const assetId of initialAssetIds) this.subscribedAssetIds.add(assetId);
    this.manuallyClosed = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }

    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;

    this.ws = new WebSocket(MARKET_WS_URL);

    this.ws.on("open", () => {
      this.connected = true;
      this.reconnectAttempts = 0;
      logger.info("Market WebSocket connected.");
      this.emit("status", this.getStatus());
      this.sendSubscription("market");
      this.pingTimer = setInterval(() => {
        this.lastPingSentAt = Date.now();
        this.ws?.send("PING");
      }, 10_000);

      if (this.silenceTimer) clearInterval(this.silenceTimer);
      this.silenceTimer = setInterval(() => {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
        const last = this.lastDataMessageAtMs ?? 0;
        const silenceMs = last ? Date.now() - last : Number.POSITIVE_INFINITY;
        if (silenceMs > this.maxSilenceMs) {
          logger.warn("Market WebSocket silent; forcing reconnect.", {
            silenceMs: Math.round(silenceMs),
            reconnectAfterMs: this.maxSilenceMs,
            subscribedAssets: this.subscribedAssetIds.size
          });
          this.ws.terminate();
        }
      }, 5_000);
    });

    this.ws.on("message", (raw) => {
      const text = raw.toString();
      if (text === "PONG") {
        if (this.lastPingSentAt) this.latencyMs = Date.now() - this.lastPingSentAt;
        this.emit("status", this.getStatus());
        return;
      }

      try {
        const parsed = JSON.parse(text);
        this.lastDataMessageAtMs = Date.now();
        this.lastMessageAt = new Date().toISOString();
        this.updateOrderBookCache(parsed);
        this.emit("status", this.getStatus());
        this.emit("message", parsed);
      } catch {
        logger.debug("Ignoring non-JSON WebSocket market message.", { text });
      }
    });

    this.ws.on("close", () => {
      this.connected = false;
      logger.warn("Market WebSocket closed.");
      this.emit("status", this.getStatus());
      if (this.pingTimer) clearInterval(this.pingTimer);
      if (this.silenceTimer) clearInterval(this.silenceTimer);
      this.pingTimer = undefined;
      this.silenceTimer = undefined;
      this.ws = undefined;
      this.scheduleReconnect("close");
    });

    this.ws.on("error", (error) => {
      this.connected = false;
      logger.warn("Market WebSocket error.", { message: error.message });
      this.emit("status", this.getStatus());
      this.scheduleReconnect("error");
    });
  }

  subscribe(assetIds: string[]): void {
    const newIds = assetIds.filter((assetId) => !this.subscribedAssetIds.has(assetId));
    if (newIds.length === 0) return;

    for (const assetId of newIds) this.subscribedAssetIds.add(assetId);

    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.connect([...this.subscribedAssetIds]);
      return;
    }

    this.ws.send(
      JSON.stringify({
        assets_ids: newIds,
        operation: "subscribe",
        custom_feature_enabled: true
      })
    );
  }

  setSubscriptions(assetIds: string[]): void {
    const nextAssetIds = [...new Set(assetIds.filter(Boolean))];
    const next = new Set(nextAssetIds);
    const removed = [...this.subscribedAssetIds].some((assetId) => !next.has(assetId));
    const added = nextAssetIds.filter((assetId) => !this.subscribedAssetIds.has(assetId));
    if (!removed && added.length === 0) return;

    this.subscribedAssetIds.clear();
    for (const assetId of nextAssetIds) this.subscribedAssetIds.add(assetId);
    for (const assetId of [...this.orderBooks.keys()]) {
      if (!next.has(assetId)) this.orderBooks.delete(assetId);
    }

    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.connect([...this.subscribedAssetIds]);
      return;
    }

    if (removed) {
      logger.info("Market WebSocket subscriptions changed; reconnecting with active universe.", {
        subscribedAssets: nextAssetIds.length,
        removed: true
      });
      this.ws.terminate();
      return;
    }

    this.ws.send(
      JSON.stringify({
        assets_ids: added,
        operation: "subscribe",
        custom_feature_enabled: true
      })
    );
  }

  close(): void {
    this.manuallyClosed = true;
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.silenceTimer) clearInterval(this.silenceTimer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.connected = false;
    this.pingTimer = undefined;
    this.silenceTimer = undefined;
    this.reconnectTimer = undefined;
    this.ws?.close();
    this.ws = undefined;
  }

  getStatus(): { connected: boolean; subscribedAssets: number; lastMessageAt?: string; latencyMs?: number } {
    return {
      connected: this.connected,
      subscribedAssets: this.subscribedAssetIds.size,
      lastMessageAt: this.lastMessageAt,
      latencyMs: this.latencyMs
    };
  }

  getCachedOrderBook(tokenId: string): OrderBook | undefined {
    const book = this.orderBooks.get(tokenId);
    if (!book) return undefined;
    return {
      ...book,
      bids: [...book.bids],
      asks: [...book.asks]
    };
  }

  private sendSubscription(type: "market"): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || this.subscribedAssetIds.size === 0) {
      return;
    }

    this.ws.send(
      JSON.stringify({
        assets_ids: [...this.subscribedAssetIds],
        type,
        custom_feature_enabled: true
      })
    );
  }

  private updateOrderBookCache(message: unknown): void {
    if (!isRecord(message)) return;

    if (message.event_type === "book" && typeof message.asset_id === "string") {
      this.orderBooks.set(message.asset_id, normalizeBookMessage(message));
      return;
    }

    if (message.event_type !== "price_change" || !Array.isArray(message.price_changes)) return;
    const timestamp = typeof message.timestamp === "string" ? message.timestamp : String(Date.now());
    const market = typeof message.market === "string" ? message.market : "";
    for (const rawChange of message.price_changes) {
      if (!isRecord(rawChange) || typeof rawChange.asset_id !== "string") continue;
      const book = this.orderBooks.get(rawChange.asset_id);
      if (!book) continue;

      const levels = rawChange.side === "BUY" ? book.bids : book.asks;
      updateLevel(levels, String(rawChange.price), String(rawChange.size));
      book.timestamp = timestamp;
      book.market = market || book.market;
      if (typeof rawChange.hash === "string") book.hash = rawChange.hash;
    }
  }

  private scheduleReconnect(reason: "close" | "error"): void {
    if (this.manuallyClosed) return;
    if (this.reconnectTimer) return;
    if (this.subscribedAssetIds.size === 0) return;

    const attempt = Math.min(6, this.reconnectAttempts++);
    const baseDelayMs = 1000 * Math.pow(2, attempt);
    const delayMs = Math.min(30_000, Math.max(1000, baseDelayMs + Math.round(Math.random() * 250)));

    logger.warn("Market WebSocket reconnect scheduled.", {
      reason,
      delayMs,
      reconnects: this.reconnectAttempts,
      subscribedAssets: this.subscribedAssetIds.size
    });

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      this.connect([...this.subscribedAssetIds]);
    }, delayMs);
  }
}

function normalizeBookMessage(message: Record<string, unknown>): OrderBook {
  return {
    market: typeof message.market === "string" ? message.market : "",
    asset_id: typeof message.asset_id === "string" ? message.asset_id : "",
    timestamp: typeof message.timestamp === "string" ? message.timestamp : String(Date.now()),
    hash: typeof message.hash === "string" ? message.hash : "",
    bids: normalizeLevels(message.bids),
    asks: normalizeLevels(message.asks),
    min_order_size: typeof message.min_order_size === "string" ? message.min_order_size : "0",
    tick_size: typeof message.tick_size === "string" ? message.tick_size : "0.01",
    neg_risk: typeof message.neg_risk === "boolean" ? message.neg_risk : false,
    last_trade_price: typeof message.last_trade_price === "string" ? message.last_trade_price : undefined
  };
}

function normalizeLevels(value: unknown): OrderBookLevel[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isRecord)
    .map((level) => ({ price: String(level.price), size: String(level.size) }))
    .filter((level) => Number.isFinite(Number(level.price)) && Number.isFinite(Number(level.size)));
}

function updateLevel(levels: OrderBookLevel[], price: string, size: string): void {
  const numericSize = Number(size);
  const index = levels.findIndex((level) => Number(level.price) === Number(price));
  if (!Number.isFinite(numericSize) || numericSize <= 0) {
    if (index >= 0) levels.splice(index, 1);
    return;
  }

  if (index >= 0) {
    levels[index] = { price, size };
  } else {
    levels.push({ price, size });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
