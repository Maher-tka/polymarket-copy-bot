import { logger } from "../logger";
import { DataClient } from "../polymarket/dataClient";
import { ClobPublicClient } from "../polymarket/clobPublicClient";
import { StrategyExecutionPort } from "../execution/executionLayer";
import { BotConfig, DataApiTrade, PortfolioSnapshot, StrategyOpportunity } from "../types";
import {
  bestAsk,
  bestBid,
  effectiveTakerFeeRate,
  isFiveOrFifteenMinuteCryptoMarket,
  orderBookAgeMs,
  simulateOrderBookFill,
  spread
} from "./orderBookMath";
import { StrategyStateStore } from "./strategyState";
import { MarketEventQueue, scoreEvent } from "./eventQueue";

export class WhaleTracker {
  private readonly seenTrades = new Set<string>();

  constructor(
    private readonly dataClient: DataClient,
    private readonly clobClient: Pick<ClobPublicClient, "getOrderBook">,
    private readonly store: StrategyStateStore,
    private readonly execution: StrategyExecutionPort,
    private readonly config: Pick<
      BotConfig,
      | "whaleMinTradeUsd"
      | "takerFeeRate"
      | "cryptoTakerFeeRate"
      | "arbitrageTargetShares"
      | "maxDataAgeMs"
      | "rejectPartialFills"
      | "strategyLabAllMarkets"
    >,
    private readonly eventQueue?: MarketEventQueue
  ) {}

  async poll(portfolio: PortfolioSnapshot): Promise<void> {
    const trades = await this.dataClient.getTrades({ limit: 80, takerOnly: true });
    for (const trade of trades.reverse()) {
      const id = stableTradeId(trade);
      if (this.seenTrades.has(id)) continue;
      this.seenTrades.add(id);

      const notionalUsd = Number(trade.price) * Number(trade.size);
      if (!Number.isFinite(notionalUsd) || notionalUsd < this.config.whaleMinTradeUsd) continue;
      if (!this.config.strategyLabAllMarkets && !isFiveOrFifteenMinuteCryptoMarket(trade)) continue;

      const score = this.scoreTrade(trade, notionalUsd);
      const opportunity: StrategyOpportunity = {
        id: `whale-${id}`,
        strategy: "whale-tracker",
        marketTitle: trade.title,
        marketSlug: trade.slug,
        conditionId: trade.conditionId,
        side: trade.side,
        edge: round((score - 50) / 5000),
        score,
        targetShares: Math.min(this.config.arbitrageTargetShares, Math.max(0.01, portfolio.equityUsd * 0.01)),
        targetNotionalUsd: Math.min(notionalUsd, portfolio.equityUsd * 0.01),
        status: score >= 70 ? "alert" : "rejected",
        reason: score < 70 ? "Large trade score below threshold; alert suppressed." : undefined,
        createdAt: new Date().toISOString()
      };
      const book = score >= 70 ? await this.clobClient.getOrderBook(trade.asset).catch(() => undefined) : undefined;
      const bid = book ? bestBid(book) : undefined;
      const ask = book ? bestAsk(book) : undefined;
      const dataAgeMs = book ? orderBookAgeMs(book) : undefined;
      const reasons = score < 70 ? ["Whale signal score is below threshold.", "Direction was not blindly copied."] : [];
      if (dataAgeMs !== undefined && dataAgeMs > this.config.maxDataAgeMs) reasons.push(`Stale order book data: ${Math.round(dataAgeMs)}ms old.`);

      this.store.addOpportunity({ ...opportunity, status: reasons.length > 0 ? "rejected" : opportunity.status, reason: reasons.join(" | ") || undefined });
      this.store.addDiagnostic({
        id: `diag-whale-${id}`,
        opportunityId: opportunity.id,
        timestamp: new Date().toISOString(),
        market: trade.title,
        strategy: "whale-tracker",
        yesBestBid: bid,
        yesBestAsk: ask,
        spread: book ? round(spread(book)) : undefined,
        orderBookDepthUsd: book ? round(depthUsd(book.asks) + depthUsd(book.bids)) : undefined,
        dataAgeMs: dataAgeMs === undefined ? undefined : round(dataAgeMs),
        rawEdge: opportunity.edge,
        estimatedFeesUsd: 0,
        estimatedSlippageUsd: 0,
        netEdge: opportunity.edge,
        accepted: reasons.length === 0 && score >= 85,
        rejectionReasons: reasons,
        simulatedEntryPrice: trade.price,
        createdAt: new Date().toISOString()
      });
      logger.info("Large trade evaluated by whale tracker.", { market: trade.title, notionalUsd, score });
      this.eventQueue?.enqueue({
        type: "whale-trade",
        priority: scoreEvent("whale-trade", score / 20),
        conditionId: trade.conditionId,
        tokenId: trade.asset,
        marketTitle: trade.title,
        reason: `Large trade detected: $${notionalUsd.toFixed(2)} notional, score ${score}.`
      });

      if (reasons.length > 0) {
        this.store.addRejection({
          id: `reject-whale-${id}`,
          strategy: "whale-tracker",
          marketTitle: trade.title,
          conditionId: trade.conditionId,
          reasons,
          edge: opportunity.edge,
          createdAt: new Date().toISOString()
        });
        continue;
      }

      if (score >= 85) {
        if (!book) continue;
        const fill = simulateOrderBookFill(
          book,
          trade.side === "BUY" ? "BUY" : "SELL",
          opportunity.targetShares ?? 1,
          effectiveTakerFeeRate({ title: trade.title, slug: trade.slug }, this.config)
        );
        if (this.config.rejectPartialFills && fill.partial) {
          this.store.addRejection({
            id: `reject-whale-fill-${id}`,
            strategy: "whale-tracker",
            marketTitle: trade.title,
            conditionId: trade.conditionId,
            reasons: ["Whale paper trade rejected because visible order book only gave a partial fill."],
            edge: opportunity.edge,
            createdAt: new Date().toISOString()
          });
          continue;
        }
        this.execution.executeSingleLeg("whale-tracker", { ...opportunity, status: "filled" }, fill, opportunity.edge * fill.filledShares);
      }
    }
  }

  private scoreTrade(trade: DataApiTrade, notionalUsd: number): number {
    const delaySeconds = Math.max(0, Date.now() / 1000 - Number(trade.timestamp));
    const sizeScore = Math.min(35, Math.log10(notionalUsd + 1) * 8);
    const liquidityProxy = trade.title?.toLowerCase().includes("bitcoin") || trade.title?.toLowerCase().includes("ethereum") ? 20 : 10;
    const delayScore = Math.max(0, 20 - delaySeconds / 3);
    const directionPenalty = trade.side === "SELL" ? 5 : 0;
    return round(Math.min(100, 30 + sizeScore + liquidityProxy + delayScore - directionPenalty));
  }
}

function depthUsd(levels: Array<{ price: string; size: string }>): number {
  return levels.reduce((total, level) => {
    const price = Number(level.price);
    const size = Number(level.size);
    return Number.isFinite(price) && Number.isFinite(size) ? total + price * size : total;
  }, 0);
}

function stableTradeId(trade: DataApiTrade): string {
  return trade.transactionHash || `${trade.proxyWallet}:${trade.asset}:${trade.timestamp}:${trade.side}:${trade.size}:${trade.price}`;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
