import { EventEmitter } from "events";
import WebSocket from "ws";
import { logger } from "../logger";

const MARKET_WS_URL = "wss://ws-subscriptions-clob.polymarket.com/ws/market";

export class MarketWebSocket extends EventEmitter {
  private ws?: WebSocket;
  private pingTimer?: NodeJS.Timeout;
  private readonly subscribedAssetIds = new Set<string>();
  private connected = false;
  private lastMessageAt?: string;
  private lastPingSentAt?: number;
  private latencyMs?: number;

  connect(initialAssetIds: string[] = []): void {
    for (const assetId of initialAssetIds) this.subscribedAssetIds.add(assetId);
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return;

    this.ws = new WebSocket(MARKET_WS_URL);

    this.ws.on("open", () => {
      this.connected = true;
      logger.info("Market WebSocket connected.");
      this.emit("status", this.getStatus());
      this.sendSubscription("market");
      this.pingTimer = setInterval(() => {
        this.lastPingSentAt = Date.now();
        this.ws?.send("PING");
      }, 10_000);
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
        this.lastMessageAt = new Date().toISOString();
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
    });

    this.ws.on("error", (error) => {
      this.connected = false;
      logger.warn("Market WebSocket error.", { message: error.message });
      this.emit("status", this.getStatus());
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

  close(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.connected = false;
    this.ws?.close();
  }

  getStatus(): { connected: boolean; subscribedAssets: number; lastMessageAt?: string; latencyMs?: number } {
    return {
      connected: this.connected,
      subscribedAssets: this.subscribedAssetIds.size,
      lastMessageAt: this.lastMessageAt,
      latencyMs: this.latencyMs
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
}
