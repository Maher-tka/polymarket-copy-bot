import { logger } from "../logger";
import { StrategyExecutionPort } from "../execution/executionLayer";
import { ClobPublicClient } from "../polymarket/clobPublicClient";
import {
  BinaryMarketCandidate,
  BotConfig,
  FillSimulation,
  PortfolioSnapshot,
  SimulatedMakerOrder,
  StrategyOpportunity
} from "../types";
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
    private readonly clobClient: Pick<ClobPublicClient, "getOrderBook">,
    private readonly store: StrategyStateStore,
    private readonly execution: StrategyExecutionPort,
    private readonly config: Pick<
      BotConfig,
      | "minMarketVolumeUsd"
      | "maxSpread"
      | "makerFeeRate"
      | "arbitrageTargetShares"
      | "maxDataAgeMs"
      | "marketMakingMaxDataAgeMs"
      | "marketMakingMinEdge"
      | "marketMakingMaxQueueDepthMultiplier"
      | "marketMakingAdverseSelectionBps"
      | "makerOrderTimeoutMs"
      | "maxTradeSizeUsd"
      | "maxPositionSizePct"
      | "minDepthMultiplier"
      | "finalEntryBufferSeconds"
    >
  ) {}

  async tick(candidates: BinaryMarketCandidate[], portfolio: PortfolioSnapshot): Promise<void> {
    await this.cancelOrFillOpenOrders();

    for (const candidate of candidates.slice(0, 10)) {
      if (candidate.volumeUsd < this.config.minMarketVolumeUsd) continue;
      const book = await this.clobClient.getOrderBook(candidate.yesTokenId);
      const bid = bestBid(book);
      const ask = bestAsk(book);
      const mid = midpoint(book);
      const bookSpread = spread(book);
      const dataAgeMs = orderBookAgeMs(book);
      if (bid === undefined || ask === undefined || mid === undefined) continue;

      const tickSize = Number(book.tick_size) || 0.01;
      const makerLimit = passiveBuyPrice(bid, ask, tickSize);
      const tightEnough = bookSpread <= this.config.maxSpread;
      const visibleDepthUsd = depthUsd(book.bids) + depthUsd(book.asks);
      const maxTradeCapUsd = Math.min(
        this.config.maxTradeSizeUsd,
        portfolio.equityUsd * Math.max(0.0001, this.config.maxPositionSizePct)
      );
      const targetShares = Math.max(
        0.01,
        Math.min(this.config.arbitrageTargetShares / 2, maxTradeCapUsd / Math.max(0.01, makerLimit))
      );
      const targetNotionalUsd = targetShares * makerLimit;
      const adverseSelectionUsd = estimateMakerAdverseSelectionUsd(
        makerLimit,
        targetShares,
        this.config.marketMakingAdverseSelectionBps
      );
      const rawEdge = mid - makerLimit;
      const edge = rawEdge - adverseSelectionUsd / Math.max(0.01, targetShares);
      const queueAheadUsd = makerQueueAheadUsd(book.bids, makerLimit);
      const reasons: string[] = [];
      const maxDataAge = this.config.marketMakingMaxDataAgeMs;

      if (dataAgeMs > maxDataAge) reasons.push(`Stale order book data: ${Math.round(dataAgeMs)}ms old.`);
      if (isInsideFinalEntryWindow(candidate.endDate, this.config.finalEntryBufferSeconds)) {
        reasons.push(`Market is inside final ${this.config.finalEntryBufferSeconds}s entry buffer.`);
      }
      if (!tightEnough) reasons.push("Spread is wider than MAX_SPREAD for market making.");
      if (edge < this.config.marketMakingMinEdge) reasons.push("Maker spread edge is too small after adverse-selection estimate.");
      if (visibleDepthUsd < targetNotionalUsd * this.config.minDepthMultiplier) {
        reasons.push("Insufficient depth for market making inventory.");
      }
      if (queueAheadUsd > targetNotionalUsd * this.config.marketMakingMaxQueueDepthMultiplier) {
        reasons.push("Maker queue is too deep to assume a fast fill.");
      }

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
        rawEdge: round(rawEdge),
        estimatedFeesUsd: round(calculateBinaryTakerFeeUsd(makerLimit, targetShares, this.config.makerFeeRate)),
        estimatedSlippageUsd: round(adverseSelectionUsd),
        netEdge: round(edge),
        accepted: reasons.length === 0,
        rejectionReasons: reasons,
        simulatedEntryPrice: round(makerLimit),
        secondsToClose: roundOptional(secondsUntilClose(candidate.endDate)),
        tooCloseToClose: isInsideFinalEntryWindow(candidate.endDate, this.config.finalEntryBufferSeconds),
        missedFill: reasons.some((reason) => reason.includes("queue")),
        lossCause: lossCauseForReasons(reasons),
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
        score: round(Math.min(100, candidate.volumeUsd / 1000 + 1 / Math.max(0.001, bookSpread))),
        targetShares,
        targetNotionalUsd,
        status: "accepted",
        projectedLockedProfitUsd: round(edge * targetShares),
        failedFillRiskUsd: round(adverseSelectionUsd),
        createdAt: new Date().toISOString()
      };
      this.store.addOpportunity(opportunity);
      this.store.upsertMakerOrder({
        id: `mm-order-${candidate.conditionId}-${Date.now()}`,
        strategy: "market-making",
        conditionId: candidate.conditionId,
        marketTitle: candidate.title,
        tokenId: candidate.yesTokenId,
        side: "BUY",
        limitPrice: round(makerLimit),
        shares: targetShares,
        filledShares: 0,
        status: "open",
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + this.config.makerOrderTimeoutMs).toISOString(),
        marketEndDate: candidate.endDate,
        postOnly: true,
        projectedLockedProfitUsd: round(edge * targetShares),
        failedFillRiskUsd: round(adverseSelectionUsd)
      });
      logger.info("Market making maker order simulated.", {
        market: candidate.title,
        limitPrice: makerLimit,
        spread: bookSpread,
        edge
      });
      break;
    }
  }

  private async cancelOrFillOpenOrders(): Promise<void> {
    const orders = this.store
      .getState()
      .makerOrders.filter((order) => order.strategy === "market-making" && order.status === "open");

    for (const order of orders) {
      const book = await this.clobClient.getOrderBook(order.tokenId);
      const ask = bestAsk(book);
      const mid = midpoint(book);
      const tickSize = Number(book.tick_size) || 0.01;
      const expired = Date.now() > new Date(order.expiresAt).getTime();
      const movedIntoOrder = ask !== undefined && ask <= order.limitPrice + tickSize / 2;

      if (!movedIntoOrder) {
        if (expired) this.cancelMissedOrder(order);
        continue;
      }

      const fill = makerFill(order.limitPrice, order.shares, this.config.makerFeeRate);
      const adverseSelectionUsd = estimateMakerAdverseSelectionUsd(
        order.limitPrice,
        order.shares,
        this.config.marketMakingAdverseSelectionBps
      );
      const markPrice = mid ?? order.limitPrice;
      const expectedEdgeUsd = (markPrice - order.limitPrice) * order.shares - adverseSelectionUsd - fill.feeUsd;
      const opportunity: StrategyOpportunity = {
        id: `mm-fill-${order.id}-${Date.now()}`,
        strategy: "market-making",
        marketTitle: order.marketTitle,
        conditionId: order.conditionId,
        yesTokenId: order.tokenId,
        side: "BUY",
        edge: round(expectedEdgeUsd / Math.max(0.01, fill.notionalUsd)),
        targetShares: order.shares,
        targetNotionalUsd: fill.notionalUsd,
        status: "filled",
        marketEndDate: order.marketEndDate,
        secondsToClose: roundOptional(secondsUntilClose(order.marketEndDate)),
        createdAt: new Date().toISOString()
      };

      this.store.addOpportunity(opportunity);
      this.store.addDiagnostic({
        id: `diag-mm-fill-${order.id}-${Date.now()}`,
        opportunityId: opportunity.id,
        timestamp: new Date().toISOString(),
        market: order.marketTitle,
        strategy: "market-making",
        yesBestBid: roundOptional(bestBid(book)),
        yesBestAsk: roundOptional(ask),
        spread: round(spread(book)),
        orderBookDepthUsd: round(depthUsd(book.bids) + depthUsd(book.asks)),
        dataAgeMs: round(orderBookAgeMs(book)),
        rawEdge: round(markPrice - order.limitPrice),
        estimatedFeesUsd: round(fill.feeUsd),
        estimatedSlippageUsd: round(adverseSelectionUsd),
        netEdge: opportunity.edge,
        accepted: true,
        rejectionReasons: [],
        simulatedEntryPrice: round(order.limitPrice),
        fillRate: 1,
        partialFill: false,
        failedFill: false,
        secondsToClose: opportunity.secondsToClose,
        lossCause: expectedEdgeUsd < 0 ? "slippage" : undefined,
        reasonForLoss: expectedEdgeUsd < 0 ? "Adverse selection moved price into the maker quote." : undefined,
        createdAt: new Date().toISOString()
      });
      this.store.upsertMakerOrder({ ...order, filledShares: fill.filledShares, status: "filled" });
      const trade = this.execution.executeSingleLeg("market-making", opportunity, fill, expectedEdgeUsd);
      if (expectedEdgeUsd < 0) {
        this.store.updatePaperTrade(trade.id, {
          lossCause: "slippage",
          lossReason: "Adverse selection moved price into the maker quote."
        });
      }
      logger.info("Market making maker order filled in paper simulation.", {
        market: order.marketTitle,
        limitPrice: order.limitPrice,
        markPrice,
        expectedEdgeUsd
      });
    }
  }

  private cancelMissedOrder(order: SimulatedMakerOrder): void {
    this.store.upsertMakerOrder({ ...order, status: "cancelled", missedFill: true });
    this.store.addDiagnostic({
      id: `diag-mm-missed-${order.id}`,
      timestamp: new Date().toISOString(),
      tradeId: order.id,
      market: order.marketTitle,
      strategy: "market-making",
      accepted: false,
      rejectionReasons: ["Market-making maker order timed out before fill."],
      missedFill: true,
      createdAt: new Date().toISOString()
    });
    this.store.addOpportunity({
      id: `mm-missed-${order.id}`,
      strategy: "market-making",
      marketTitle: order.marketTitle,
      conditionId: order.conditionId,
      edge: 0,
      status: "missed",
      reason: "Market-making maker order timed out before fill.",
      createdAt: new Date().toISOString()
    });
    logger.info("Market making maker order missed in paper simulation.", { orderId: order.id });
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
    spreadCostUsd: 0,
    staleDataPenaltyUsd: 0,
    queueUncertaintyUsd: 0,
    adverseSelectionUsd: 0,
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

export function passiveBuyPrice(bestBidPrice: number, bestAskPrice: number, tickSize: number): number {
  const safeTick = Number.isFinite(tickSize) && tickSize > 0 ? tickSize : 0.01;
  const improvedBid = bestBidPrice + safeTick;
  return improvedBid < bestAskPrice ? improvedBid : bestBidPrice;
}

export function makerQueueAheadUsd(levels: Array<{ price: string; size: string }>, limitPrice: number): number {
  return levels.reduce((total, level) => {
    const price = Number(level.price);
    const size = Number(level.size);
    if (!Number.isFinite(price) || !Number.isFinite(size)) return total;
    return price >= limitPrice ? total + price * size : total;
  }, 0);
}

export function estimateMakerAdverseSelectionUsd(price: number, shares: number, adverseSelectionBps: number): number {
  if (!Number.isFinite(price) || !Number.isFinite(shares) || !Number.isFinite(adverseSelectionBps)) return 0;
  return Math.max(0, price * shares * (adverseSelectionBps / 10_000));
}

function lossCauseForReasons(reasons: string[]) {
  const text = reasons.join(" ").toLowerCase();
  if (text.includes("final")) return "close-window" as const;
  if (text.includes("stale")) return "stale-data" as const;
  if (text.includes("depth") || text.includes("queue")) return "illiquidity" as const;
  if (text.includes("spread")) return "slippage" as const;
  if (text.includes("edge")) return "negative-edge" as const;
  return undefined;
}

function round(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function roundOptional(value: number | undefined): number | undefined {
  return value === undefined ? undefined : round(value);
}
