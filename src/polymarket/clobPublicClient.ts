import { BotConfig, GammaMarket, MarketSnapshot, OrderBook, OrderBookLevel, TradeSide } from "../types";

export interface LiveOrderBookProvider {
  getCachedOrderBook(tokenId: string): OrderBook | undefined;
  subscribe?(tokenIds: string[]): void;
}

export interface MarketByTokenResponse {
  condition_id: string;
  primary_token_id: string;
  secondary_token_id: string;
  end_date_iso?: string;
  end_date?: string;
}

export class ClobPublicClient {
  private liveOrderBookProvider?: LiveOrderBookProvider;

  constructor(
    private readonly config: Pick<BotConfig, "clobHost"> & Partial<Pick<BotConfig, "maxDataAgeMs" | "maxStaleDataMs">>
  ) {}

  setLiveOrderBookProvider(provider: LiveOrderBookProvider): void {
    this.liveOrderBookProvider = provider;
  }

  async getOrderBook(tokenId: string): Promise<OrderBook> {
    const cached = this.getFreshCachedBook(tokenId);
    if (cached) return cached;
    return this.request<OrderBook>("/book", { token_id: tokenId });
  }

  async getOrderBooks(tokenIds: string[]): Promise<Map<string, OrderBook>> {
    const uniqueTokenIds = [...new Set(tokenIds.filter(Boolean))];
    if (uniqueTokenIds.length === 0) return new Map();

    const output = new Map<string, OrderBook>();
    const missingTokenIds: string[] = [];

    for (const tokenId of uniqueTokenIds) {
      const cached = this.getFreshCachedBook(tokenId);
      if (cached) {
        output.set(tokenId, cached);
      } else {
        missingTokenIds.push(tokenId);
      }
    }

    if (missingTokenIds.length > 0) {
      const books = await this.post<OrderBook[]>(
        "/books",
        missingTokenIds.map((tokenId) => ({ token_id: tokenId }))
      );

      for (const book of books) output.set(book.asset_id, book);
    }

    return output;
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

    const response = await fetchWithRetry(url);
    if (!response.ok) {
      const detail = await readErrorDetail(response);
      const suffix = detail ? `: ${detail}` : "";
      throw new Error(`CLOB public API ${response.status} ${response.statusText}: ${url.toString()}${suffix}`);
    }

    return response.json() as Promise<T>;
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const url = new URL(path, this.config.clobHost);
    const response = await fetchWithRetry(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    });
    if (!response.ok) {
      const detail = await readErrorDetail(response);
      const suffix = detail ? `: ${detail}` : "";
      throw new Error(`CLOB public API ${response.status} ${response.statusText}: ${url.toString()}${suffix}`);
    }

    return response.json() as Promise<T>;
  }

  private getFreshCachedBook(tokenId: string): OrderBook | undefined {
    const cached = this.liveOrderBookProvider?.getCachedOrderBook(tokenId);
    if (!cached) return undefined;
    return orderBookAgeMs(cached) <= this.cachedBookFreshMs() ? cached : undefined;
  }

  private cachedBookFreshMs(): number {
    return Math.max(250, Math.min(this.config.maxDataAgeMs ?? 1000, this.config.maxStaleDataMs ?? 1000));
  }
}

async function fetchWithRetry(url: URL, init?: RequestInit): Promise<Response> {
  const maxAttempts = 2;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await fetch(url, init);
      if (response.ok || !shouldRetryStatus(response.status) || attempt >= maxAttempts) return response;
    } catch (error) {
      if (!isRetryableNetworkError(error) || attempt >= maxAttempts) throw error;
    }

    await sleep(250 * attempt);
  }

  return fetch(url, init);
}

function shouldRetryStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599);
}

function isRetryableNetworkError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const anyError = error as { name?: unknown; code?: unknown; cause?: unknown; message?: unknown };
  const code = typeof anyError.code === "string" ? anyError.code : undefined;
  const name = typeof anyError.name === "string" ? anyError.name : undefined;
  const message = typeof anyError.message === "string" ? anyError.message : "";
  const cause = anyError.cause as { code?: unknown; message?: unknown } | undefined;
  const causeCode = typeof cause?.code === "string" ? cause.code : undefined;
  const causeMessage = typeof cause?.message === "string" ? cause.message : undefined;

  const text = `${name ?? ""} ${message} ${code ?? ""} ${causeCode ?? ""} ${causeMessage ?? ""}`.toLowerCase();
  return (
    text.includes("econnreset") ||
    text.includes("etimedout") ||
    text.includes("eai_again") ||
    text.includes("enotfound") ||
    text.includes("socket hang up") ||
    text.includes("fetch failed")
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readErrorDetail(response: Response): Promise<string | undefined> {
  try {
    const text = await response.text();
    if (!text) return undefined;
    try {
      const parsed = JSON.parse(text) as { error?: unknown };
      if (typeof parsed?.error === "string" && parsed.error.trim()) return parsed.error.trim();
    } catch {
      // ignore json parse errors
    }
    return text.trim().slice(0, 200);
  } catch {
    return undefined;
  }
}

function orderBookAgeMs(orderBook: OrderBook): number {
  const raw = Number(orderBook.timestamp);
  if (!Number.isFinite(raw)) {
    const parsed = new Date(orderBook.timestamp).getTime();
    return Number.isFinite(parsed) ? Math.max(0, Date.now() - parsed) : Number.POSITIVE_INFINITY;
  }
  const timestampMs = raw > 10_000_000_000 ? raw : raw * 1000;
  return Math.max(0, Date.now() - timestampMs);
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
