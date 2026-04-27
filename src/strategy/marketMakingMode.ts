import { logger } from "../logger";
import { ClobPublicClient } from "../polymarket/clobPublicClient";
import { StrategyPaperTrader } from "../trading/strategyPaperTrader";
import { BinaryMarketCandidate, BotConfig, FillSimulation, PortfolioSnapshot, StrategyOpportunity } from "../types";
import {
  bestAsk,
  bestBid,
  calculateBinaryTakerFeeUsd,
  isInsideFinalEntryWindow,
  midpoint,
  orderBookAgeMs,
  secondsUntilClose,
  spread
} from "./orderBookMath";
import { StrategyStateStore } from "./strategyState";

export class MarketMakingMode {
  constructor(
    private readonly clobClient: ClobPublicClient,
    private readonly store: StrategyStateStore,
    private readonly paperTrader: StrategyPaperTrader,
    private readonly config: Pick<
      BotConfig,
      | "minMarketVolumeUsd"
      | "maxSpread"
      | "makerFeeRate"
      | "arbitrageTargetShares"
      | "maxDataAgeMs"
      | "marketMakingMaxDataAgeMs"
      | "marketMakingMinEdge"
      | "maxTradeSizeUsd"
      | "maxPositionSizePct"
      | "minDepthMultiplier"
      | "minNetArbEdge"
      | "finalEntryBufferSeconds"
    >
  ) {}

  async tick(candidates: BinaryMarketCandidate[], portfolio: PortfolioSnapshot): Promise<void> {
    for (const candidate of candidates.slice(0, 10)) {
      if (candidate.volumeUsd < this.config.minMarketVolumeUsd) continue;
      const book = await this.clobClient.getOrderBook(candidate.yesTokenId);
      const bid = bestBid(book);
      const ask = bestAsk(book);
      const mid = midpoint(book);
      const bookSpread = spread(book);
      const dataAgeMs = orderBookAgeMs(book);
      if (bid === undefined || ask === undefined || mid === undefined) continue;

      const edge = bookSpread / 2 - mid * this.config.makerFeeRate;
      const tightEnough = bookSpread <= this.config.maxSpread;
      const visibleDepthUsd = depthUsd(book.bids) + depthUsd(book.asks);
      const maxTradeCapUsd = Math.min(
        this.config.maxTradeSizeUsd,
        portfolio.equityUsd * Math.max(0.0001, this.config.maxPositionSizePct)
      );
      const targetShares = Math.max(0.01, Math.min(this.config.arbitrageTargetShares / 2, maxTradeCapUsd / Math.max(0.01, bid)));
      const targetNotionalUsd = targetShares * bid;
      const reasons: string[] = [];
      const maxDataAge = this.config.marketMakingMaxDataAgeMs;
      if (dataAgeMs > maxDataAge) reasons.push(`Stale order book data: ${Math.round(dataAgeMs)}ms old.`);
      if (isInsideFinalEntryWindow(candidate.endDate, this.config.finalEntryBufferSeconds)) {
        reasons.push(`Market is inside final ${this.config.finalEntryBufferSeconds}s entry buffer.`);
      }
      if (!tightEnough) reasons.push("Spread is wider than MAX_SPREAD for market making.");
      if (edge < this.config.marketMakingMinEdge) reasons.push("Maker spread edge is too small after fee estimate.");
      if (visibleDepthUsd < targetNotionalUsd * this.config.minDepthMultiplier) reasons.push("Insufficient depth for market making inventory.");

      this.store.addDiagnostic({
        id: `diag-mm-${candidate.conditionId}-${Date.now()}`,
        timestamp: new Date().toISOString(),
        market: candidate.title,
        strategy: "market-making",
        yesBestBid: round(bid),
        yesBestAsk: round(ask),
        spread: round(bookSpread),
        orderBookDepthUsd: round(visibleDepthUsd),
        dataAgeMs: round(dataAgeMs),
        rawEdge: round(bookSpread / 2),
        estimatedFeesUsd: round(calculateBinaryTakerFeeUsd(bid, targetShares, this.config.makerFeeRate)),
        estimatedSlippageUsd: 0,
        netEdge: round(edge),
        accepted: reasons.length === 0,
        rejectionReasons: reasons,
        simulatedEntryPrice: round(bid),
        secondsToClose: roundOptional(secondsUntilClose(candidate.endDate)),
        tooCloseToClose: isInsideFinalEntryWindow(candidate.endDate, this.config.finalEntryBufferSeconds),
        createdAt: new Date().toISOString()
      });

      if (reasons.length > 0) {
        this.store.addRejection({
          id: `reject-mm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          strategy: "market-making",
          marketTitle: candidate.title,
          conditionId: candidate.conditionId,
          reasons,
          edge: round(edge),
          createdAt: new Date().toISOString()
        });
        continue;
      }

      // This is a conservative paper maker simulation: assume one side fills
      // only when the visible spread can pay for fees and inventory mark risk.
      const fill = makerFill(bid, targetShares, this.config.makerFeeRate);
      const opportunity: StrategyOpportunity = {
        id: `mm-${candidate.conditionId}-${Date.now()}`,
        strategy: "market-making",
        marketTitle: candidate.title,
        marketSlug: candidate.slug,
        conditionId: candidate.conditionId,
        yesTokenId: candidate.yesTokenId,
        side: "BUY",
        marketEndDate: candidate.endDate,
        secondsToClose: roundOptional(secondsUntilClose(candidate.endDate)),
        edge: round(edge),
        score: round(Math.min(100, candidate.volumeUsd / 1000 + (1 / Math.max(0.001, bookSpread)))),
        targetShares: fill.requestedShares,
        targetNotionalUsd: fill.notionalUsd,
        status: fill.partial ? "partial" : "filled",
        createdAt: new Date().toISOString()
      };
      this.store.addOpportunity(opportunity);
      this.paperTrader.executeSingleLeg("market-making", opportunity, fill, edge * fill.filledShares);
      logger.info("Market making paper quote simulated.", { market: candidate.title, mid, spread: bookSpread, edge });
      break;
    }
  }
}

function makerFill(limitPrice: number, shares: number, feeRate: number): FillSimulation {
  const notionalUsd = limitPrice * shares;
  return {
    requestedShares: shares,
    filledShares: shares,
    fillRate: 1,
    averagePrice: limitPrice,
    topOfBookPrice: limitPrice,
    notionalUsd,
    slippageUsd: 0,
    slippagePct: 0,
    feeUsd: calculateBinaryTakerFeeUsd(limitPrice, shares, feeRate),
    partial: false,
    depthUsd: notionalUsd
  };
}

function depthUsd(levels: Array<{ price: string; size: string }>): number {
  return levels.reduce((total, level) => {
    const price = Number(level.price);
    const size = Number(level.size);
    return Number.isFinite(price) && Number.isFinite(size) ? total + price * size : total;
  }, 0);
}

function round(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function roundOptional(value: number | undefined): number | undefined {
  return value === undefined ? undefined : round(value);
}
