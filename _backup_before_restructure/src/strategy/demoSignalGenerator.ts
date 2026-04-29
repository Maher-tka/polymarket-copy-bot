import { BotStatus } from "../botStatus";
import { logger } from "../logger";
import { bestPrice, ClobPublicClient } from "../polymarket/clobPublicClient";
import { GammaClient } from "../polymarket/gammaClient";
import { BotConfig, CopySignal, GammaMarket, PaperPosition } from "../types";
import { Portfolio } from "../trading/portfolio";

type SignalHandler = (signal: CopySignal) => Promise<void>;

interface DemoMarketCandidate {
  market: GammaMarket;
  tokenIds: string[];
  outcomes: string[];
}

export class DemoSignalGenerator {
  private timer?: NodeJS.Timeout;
  private marketCache: DemoMarketCandidate[] = [];
  private marketCacheLoadedAt = 0;
  private cursor = 0;
  private tickCount = 0;

  constructor(
    private readonly gammaClient: GammaClient,
    private readonly clobPublicClient: ClobPublicClient,
    private readonly portfolio: Portfolio,
    private readonly config: Pick<
      BotConfig,
      | "simulateSignalIntervalSeconds"
      | "minMarketVolumeUsd"
      | "maxSpread"
      | "minEntryPrice"
      | "maxEntryPrice"
      | "maxTradeUsd"
    >,
    private readonly status: BotStatus
  ) {}

  async start(onSignal: SignalHandler): Promise<void> {
    this.status.setSimulationEnabled(true);
    logger.warn("SIMULATE_SIGNALS=true: demo mode is generating fake PAPER signals only.");

    await this.generateOnce(onSignal);
    this.timer = setInterval(() => {
      this.generateOnce(onSignal).catch((error) => {
        logger.warn("Demo signal generation failed.", {
          error: error instanceof Error ? error.message : String(error)
        });
      });
    }, this.config.simulateSignalIntervalSeconds * 1000);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.status.setSimulationEnabled(false);
  }

  async generateOnce(onSignal: SignalHandler): Promise<void> {
    this.tickCount += 1;

    const signal =
      this.tickCount % 3 === 0
        ? await this.createSellSignalFromOpenPosition()
        : await this.createBuySignalFromActiveMarket();

    if (!signal) {
      logger.warn("SIMULATED signal generation skipped because no usable active market/orderbook was found.");
      return;
    }

    this.status.setLastSimulatedSignal();
    logger.info("SIMULATED signal generated", {
      side: signal.side,
      market: signal.marketTitle,
      outcome: signal.outcome,
      price: signal.traderPrice,
      note: "fake paper signal only"
    });

    await onSignal(signal);
  }

  private async createBuySignalFromActiveMarket(): Promise<CopySignal | undefined> {
    await this.refreshMarketCacheIfNeeded();
    if (this.marketCache.length === 0) return undefined;

    for (let attempts = 0; attempts < this.marketCache.length; attempts += 1) {
      const candidate = this.marketCache[this.cursor % this.marketCache.length];
      this.cursor += 1;

      for (let outcomeIndex = 0; outcomeIndex < candidate.tokenIds.length; outcomeIndex += 1) {
        const assetId = candidate.tokenIds[outcomeIndex];
        const orderBook = await this.clobPublicClient.getOrderBook(assetId);
        const bestAsk = bestPrice(orderBook.asks, "ask");
        const bestBid = bestPrice(orderBook.bids, "bid");

        if (bestAsk === undefined || bestBid === undefined) continue;
        if (bestAsk < this.config.minEntryPrice || bestAsk > this.config.maxEntryPrice) continue;
        if (bestAsk - bestBid > this.config.maxSpread) continue;

        return this.buildSignal({
          side: "BUY",
          market: candidate.market,
          assetId,
          outcome: candidate.outcomes[outcomeIndex] ?? `Outcome ${outcomeIndex + 1}`,
          outcomeIndex,
          price: bestAsk,
          size: Math.max(5, (this.config.maxTradeUsd * 1.5) / bestAsk)
        });
      }
    }

    return undefined;
  }

  private async createSellSignalFromOpenPosition(): Promise<CopySignal | undefined> {
    const positions = this.portfolio.getSnapshot().openPositions;
    if (positions.length === 0) {
      return this.createBuySignalFromActiveMarket();
    }

    const position = positions[(this.tickCount / 3) % positions.length] as PaperPosition | undefined;
    if (!position) return undefined;

    const orderBook = await this.clobPublicClient.getOrderBook(position.assetId);
    const bestBid = bestPrice(orderBook.bids, "bid") ?? position.currentPrice;

    return this.buildSignal({
      side: "SELL",
      market: {
        conditionId: position.conditionId,
        slug: position.marketSlug,
        question: position.marketTitle,
        active: true,
        closed: false,
        enableOrderBook: true,
        volumeNum: this.config.minMarketVolumeUsd + 1
      },
      assetId: position.assetId,
      outcome: position.outcome ?? "Unknown outcome",
      outcomeIndex: 0,
      price: bestBid,
      size: Math.min(position.shares, Math.max(1, this.config.maxTradeUsd / Math.max(bestBid, 0.01)))
    });
  }

  private async refreshMarketCacheIfNeeded(): Promise<void> {
    const cacheAgeMs = Date.now() - this.marketCacheLoadedAt;
    if (this.marketCache.length > 0 && cacheAgeMs < 5 * 60 * 1000) return;

    const markets = await this.gammaClient.listMarkets({
      active: true,
      closed: false,
      limit: 100
    });

    this.marketCache = markets
      .filter((market) => market.active !== false && !market.closed && market.enableOrderBook !== false)
      .filter((market) => Number(market.volumeNum ?? market.volume ?? 0) >= this.config.minMarketVolumeUsd)
      .map((market) => ({
        market,
        tokenIds: parseLosslessTokenIdArray(market.clobTokenIds),
        outcomes: parseJsonArray(market.outcomes)
      }))
      .filter((candidate) => Boolean(candidate.market.conditionId && candidate.market.slug && candidate.tokenIds.length > 0));

    this.marketCacheLoadedAt = Date.now();
    this.status.setApiConnected(true);
    this.status.setMarketsLoaded(this.marketCache.length);
    logger.info("Demo mode loaded active Polymarket markets.", { marketsLoaded: this.marketCache.length });
  }

  private buildSignal(input: {
    side: "BUY" | "SELL";
    market: GammaMarket;
    assetId: string;
    outcome: string;
    outcomeIndex: number;
    price: number;
    size: number;
  }): CopySignal {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const id = `sim-${nowSeconds}-${Math.random().toString(36).slice(2, 8)}`;

    return {
      id,
      traderWallet: "0x000000000000000000000000000000000000dE0",
      traderName: "SIMULATED DEMO WALLET",
      traderScore: 100,
      side: input.side,
      assetId: input.assetId,
      conditionId: input.market.conditionId ?? "",
      marketSlug: input.market.slug,
      marketTitle: input.market.question,
      outcome: input.outcome,
      outcomeIndex: input.outcomeIndex,
      traderSize: round(input.size),
      traderPrice: round(input.price),
      traderNotionalUsd: round(input.size * input.price),
      traderTradeTimestamp: nowSeconds,
      copyDelaySeconds: 0,
      createdAt: new Date().toISOString(),
      sourceTradeId: id,
      simulated: true,
      simulationNote: "Fake copy signal for paper-trading demo mode only."
    };
  }
}

function parseJsonArray(value: string | undefined): string[] {
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

function parseLosslessTokenIdArray(value: string | undefined): string[] {
  if (!value) return [];
  const trimmed = value.trim();

  // Gamma's `clobTokenIds` is often a JSON-encoded array of *numbers*. JSON.parse would coerce
  // those into JS Numbers and lose precision for very large token IDs, producing invalid
  // token IDs (and downstream CLOB 404s). Instead, extract the raw digits directly.
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    const matches = [...trimmed.matchAll(/"(\d+)"|(\d+)/g)];
    const extracted = matches.map((match) => match[1] ?? match[2]).filter(Boolean) as string[];
    if (extracted.length > 0) return extracted;
  }

  return parseJsonArray(value);
}

function round(value: number): number {
  return Math.round(value * 10000) / 10000;
}
