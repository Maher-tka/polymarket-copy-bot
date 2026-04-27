import { BotConfig, GammaMarket, MarketSnapshot, OrderBook, OrderBookLevel, TradeSide } from "../types";

export interface MarketByTokenResponse {
  condition_id: string;
  primary_token_id: string;
  secondary_token_id: string;
  end_date_iso?: string;
  end_date?: string;
}

export class ClobPublicClient {
  constructor(private readonly config: Pick<BotConfig, "clobHost">) {}

  async getOrderBook(tokenId: string): Promise<OrderBook> {
    return this.request<OrderBook>("/book", { token_id: tokenId });
  }

  async getSpread(tokenId: string): Promise<number> {
    const response = await this.request<{ spread: string }>("/spread", { token_id: tokenId });
    return Number(response.spread);
  }

  async getMarketByToken(tokenId: string): Promise<MarketByTokenResponse> {
    return this.request<MarketByTokenResponse>(`/markets-by-token/${encodeURIComponent(tokenId)}`);
  }

  async buildMarketSnapshot(
    tokenId: string,
    side: TradeSide,
    market: GammaMarket | undefined,
    maxCopyPriceDifference: number,
    copiedPrice: number
  ): Promise<MarketSnapshot> {
    const [orderBook, spread] = await Promise.all([
      this.getOrderBook(tokenId),
      this.getSpread(tokenId).catch(() => Number.NaN)
    ]);

    const bestBid = bestPrice(orderBook.bids, "bid");
    const bestAsk = bestPrice(orderBook.asks, "ask");
    const currentEntryPrice = side === "BUY" ? bestAsk : bestBid;
    const limitPrice =
      side === "BUY" ? copiedPrice + maxCopyPriceDifference : copiedPrice - maxCopyPriceDifference;

    return {
      assetId: tokenId,
      conditionId: market?.conditionId ?? orderBook.market,
      market,
      orderBook,
      spread: Number.isFinite(spread) ? spread : calculateSpread(bestBid, bestAsk),
      bestBid,
      bestAsk,
      currentEntryPrice,
      volumeUsd: marketVolumeUsd(market),
      liquidityUsd: marketLiquidityUsd(market),
      availableLiquidityUsd: availableLiquidityUsd(orderBook, side, limitPrice)
    };
  }

  private async request<T>(
    path: string,
    params: Record<string, string | number | boolean | undefined> = {}
  ): Promise<T> {
    const url = new URL(path, this.config.clobHost);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`CLOB public API ${response.status} ${response.statusText}: ${url.toString()}`);
    }

    return response.json() as Promise<T>;
  }
}

export function bestPrice(levels: OrderBookLevel[], side: "bid" | "ask"): number | undefined {
  const prices = levels.map((level) => Number(level.price)).filter(Number.isFinite);
  if (prices.length === 0) return undefined;
  return side === "bid" ? Math.max(...prices) : Math.min(...prices);
}

export function calculateSpread(bestBid?: number, bestAsk?: number): number {
  if (bestBid === undefined || bestAsk === undefined) return Number.POSITIVE_INFINITY;
  return Math.max(0, bestAsk - bestBid);
}

export function availableLiquidityUsd(orderBook: OrderBook, side: TradeSide, limitPrice: number): number {
  const levels = side === "BUY" ? orderBook.asks : orderBook.bids;

  return levels.reduce((total, level) => {
    const price = Number(level.price);
    const size = Number(level.size);
    if (!Number.isFinite(price) || !Number.isFinite(size)) return total;

    const withinLimit = side === "BUY" ? price <= limitPrice : price >= limitPrice;
    return withinLimit ? total + price * size : total;
  }, 0);
}

export function marketVolumeUsd(market?: GammaMarket): number {
  if (!market) return 0;
  return Number(market.volumeNum ?? market.volume ?? 0) || 0;
}

export function marketLiquidityUsd(market?: GammaMarket): number {
  if (!market) return 0;
  return Number(market.liquidityNum ?? market.liquidity ?? 0) || 0;
}
