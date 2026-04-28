import { logger } from "../logger";
import { StrategyExecutionPort } from "../execution/executionLayer";
import { ClobPublicClient } from "../polymarket/clobPublicClient";
import { BinaryMarketCandidate, BotConfig, FillSimulation, PortfolioSnapshot, SimulatedMakerOrder, StrategyOpportunity } from "../types";
import {
  bestAsk,
  bestBid,
  calculateBinaryTakerFeeUsd,
  effectiveTakerFeeRate,
  isInsideFinalEntryWindow,
  orderBookAgeMs,
  secondsUntilClose,
  simulateOrderBookFill,
  spread
} from "./orderBookMath";
import { StrategyStateStore } from "./strategyState";

export class MakerArbitrageMode {
  constructor(
    private readonly clobClient: Pick<ClobPublicClient, "getOrderBook">,
    private readonly store: StrategyStateStore,
    private readonly execution: StrategyExecutionPort,
    private readonly config: Pick<
      BotConfig,
      | "makerOrderTimeoutMs"
      | "makerFeeRate"
      | "takerFeeRate"
      | "arbitrageTargetShares"
      | "minNetArbEdge"
      | "minOrderBookDepthUsd"
      | "minDepthMultiplier"
      | "maxDataAgeMs"
      | "maxSpread"
      | "maxTradeSizeUsd"
      | "maxPositionSizePct"
      | "rejectPartialFills"
      | "requireBothLegsFillable"
      | "cryptoTakerFeeRate"
      | "finalEntryBufferSeconds"
      | "makerFailedFillRiskBps"
    >
  ) {}

  async tick(candidates: BinaryMarketCandidate[], portfolio: PortfolioSnapshot): Promise<void> {
    await this.cancelOrFillOpenOrders();

    for (const candidate of candidates.slice(0, 8)) {
      const [yesBook, noBook] = await Promise.all([
        this.clobClient.getOrderBook(candidate.yesTokenId),
        this.clobClient.getOrderBook(candidate.noTokenId)
      ]);
      const yesBid = bestBid(yesBook);
      const yesAsk = bestAsk(yesBook);
      const noBid = bestBid(noBook);
      const noAsk = bestAsk(noBook);
      const maxAgeMs = Math.max(orderBookAgeMs(yesBook), orderBookAgeMs(noBook));
      if (yesBid === undefined || yesAsk === undefined || noBid === undefined || noAsk === undefined) continue;

      // Maker arb tries to improve one leg by joining/improving the bid. If it fills,
      // the other leg is hedged as a taker with strict loss accounting.
      const makerLimit = Math.min(yesAsk - 0.01, yesBid + 0.01);
      const rawCost = makerLimit + noAsk;
      const maxTradeCapUsd = Math.min(
        this.config.maxTradeSizeUsd,
        portfolio.equityUsd * Math.max(0.0001, this.config.maxPositionSizePct)
      );
      const shares = Math.max(
        0.01,
        Math.min(this.config.arbitrageTargetShares, maxTradeCapUsd / Math.max(0.01, rawCost))
      );
      const takerFeeRate = effectiveTakerFeeRate(candidate, this.config);
      const hedgeFill = simulateOrderBookFill(noBook, "BUY", shares, takerFeeRate);
      const makerFeeUsd = calculateBinaryTakerFeeUsd(makerLimit, shares, this.config.makerFeeRate);
      const expectedFeesUsd = makerFeeUsd + hedgeFill.feeUsd;
      const failedFillRiskUsd = (Math.max(0, this.config.makerFailedFillRiskBps) / 10_000) * shares;
      const estimatedSlippageUsd = hedgeFill.slippageUsd;
      const expectedCost =
        rawCost +
        (expectedFeesUsd + estimatedSlippageUsd + failedFillRiskUsd) / Math.max(0.01, shares);
      const edge = 1 - expectedCost;
      const pairSpread = spread(yesBook) + spread(noBook);
      const requiredDepthUsd = Math.max(
        this.config.minOrderBookDepthUsd,
        (makerLimit * shares + hedgeFill.notionalUsd + expectedFeesUsd) * this.config.minDepthMultiplier
      );
      const bookDepthUsd = Math.min(depthUsd(yesBook.asks), hedgeFill.depthUsd);
      const reasons: string[] = [];
      if (maxAgeMs > this.config.maxDataAgeMs) reasons.push(`Stale order book data: ${Math.round(maxAgeMs)}ms old.`);
      if (isInsideFinalEntryWindow(candidate.endDate, this.config.finalEntryBufferSeconds)) {
        reasons.push(`Market is inside final ${this.config.finalEntryBufferSeconds}s entry buffer.`);
      }
      if (makerLimit <= 0) reasons.push("Post-only maker price is not valid.");
      if (makerLimit >= yesAsk) reasons.push("Post-only maker order would cross the spread.");
      if (edge < this.config.minNetArbEdge) reasons.push("Maker-adjusted edge is not attractive enough.");
      if (pairSpread > this.config.maxSpread) reasons.push("YES/NO combined spread exceeds MAX_SPREAD.");
      if (bookDepthUsd < requiredDepthUsd) reasons.push("Insufficient depth for maker order plus hedge leg.");
      if (this.config.requireBothLegsFillable && hedgeFill.fillRate < 1) {
        reasons.push("Hedge leg is not fully fillable, so only one leg is actionable.");
      }
      if (this.config.rejectPartialFills && hedgeFill.partial) reasons.push("Partial fills are disabled by REJECT_PARTIAL_FILLS.");
      if (edge * shares <= 0) reasons.push("Projected locked profit is not positive after failed-fill risk.");

      this.store.addDiagnostic({
        id: `diag-maker-arb-${candidate.conditionId}-${Date.now()}`,
        timestamp: new Date().toISOString(),
        market: candidate.title,
        strategy: "maker-arbitrage",
        yesBestBid: round(yesBid),
        yesBestAsk: round(yesAsk),
        noBestBid: round(noBid),
        noBestAsk: round(noAsk),
        spread: round(pairSpread),
        orderBookDepthUsd: round(bookDepthUsd),
        dataAgeMs: round(maxAgeMs),
        rawEdge: round(1 - rawCost),
        estimatedFeesUsd: round(expectedFeesUsd),
        estimatedSlippageUsd: round(estimatedSlippageUsd),
        netEdge: round(edge),
        accepted: reasons.length === 0,
        rejectionReasons: reasons,
        simulatedEntryPrice: round(expectedCost),
        simulatedExitValue: 1,
        fillRate: round(hedgeFill.fillRate),
        partialFill: hedgeFill.partial,
        failedFill: hedgeFill.filledShares <= 0,
        secondsToClose: roundOptional(secondsUntilClose(candidate.endDate)),
        tooCloseToClose: isInsideFinalEntryWindow(candidate.endDate, this.config.finalEntryBufferSeconds),
        lossCause: lossCauseForReasons(reasons),
        createdAt: new Date().toISOString()
      });

      if (reasons.length > 0) {
        const rejection = {
          id: `reject-maker-arb-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          strategy: "maker-arbitrage" as const,
          marketTitle: candidate.title,
          conditionId: candidate.conditionId,
          reasons,
          edge: round(edge),
          createdAt: new Date().toISOString()
        };
        this.store.addRejection(rejection);
        continue;
      }

      const order: SimulatedMakerOrder = {
        id: `maker-arb-order-${candidate.conditionId}-${Date.now()}`,
        strategy: "maker-arbitrage",
        conditionId: candidate.conditionId,
        marketTitle: candidate.title,
        tokenId: candidate.yesTokenId,
        side: "BUY",
        limitPrice: round(makerLimit),
        shares,
        filledShares: 0,
        status: "open",
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + this.config.makerOrderTimeoutMs).toISOString(),
        hedgeTokenId: candidate.noTokenId,
        hedgeMaxLossUsd: round(Math.max(0.01, this.config.minNetArbEdge * shares)),
        marketEndDate: candidate.endDate,
        postOnly: true,
        projectedLockedProfitUsd: round(edge * shares),
        failedFillRiskUsd: round(failedFillRiskUsd)
      };
      this.store.upsertMakerOrder(order);
      logger.info("Simulated maker arbitrage order placed.", { market: candidate.title, limitPrice: makerLimit, edge });
      break;
    }
  }

  private async cancelOrFillOpenOrders(): Promise<void> {
    const state = this.store.getState();
    for (const order of state.makerOrders.filter((item) => item.strategy === "maker-arbitrage" && item.status === "open")) {
      const expired = Date.now() > new Date(order.expiresAt).getTime();
      if (expired) {
        this.store.upsertMakerOrder({ ...order, status: "cancelled" });
        this.store.addDiagnostic({
          id: `diag-maker-missed-${order.id}`,
          timestamp: new Date().toISOString(),
          tradeId: order.id,
          market: order.marketTitle,
          strategy: "maker-arbitrage",
          accepted: false,
          rejectionReasons: ["Maker order timed out before fill."],
          missedFill: true,
          createdAt: new Date().toISOString()
        });
        this.store.addOpportunity({
          id: `maker-missed-${order.id}`,
          strategy: "maker-arbitrage",
          marketTitle: order.marketTitle,
          conditionId: order.conditionId,
          edge: 0,
          status: "missed",
          reason: "Maker order timed out before fill.",
          createdAt: new Date().toISOString()
        });
        logger.info("Simulated maker arbitrage order cancelled as stale.", { orderId: order.id });
        continue;
      }

      const book = await this.clobClient.getOrderBook(order.tokenId);
      const ask = bestAsk(book);
      if (ask === undefined || ask > order.limitPrice) continue;

      const fill = makerFill(order.limitPrice, order.shares, this.config.makerFeeRate);
      const hedgeBook = order.hedgeTokenId ? await this.clobClient.getOrderBook(order.hedgeTokenId) : undefined;
      const takerFeeRate = effectiveTakerFeeRate({ title: order.marketTitle }, this.config);
      const hedgeFill = hedgeBook
        ? simulateOrderBookFill(hedgeBook, "BUY", order.shares, takerFeeRate)
        : undefined;
      const hedgeFailed = !hedgeFill || (this.config.rejectPartialFills && hedgeFill.partial) || hedgeFill.fillRate < 1;
      const opportunity: StrategyOpportunity = {
        id: `maker-arb-fill-${order.id}`,
        strategy: "maker-arbitrage",
        marketTitle: order.marketTitle,
        conditionId: order.conditionId,
        yesTokenId: order.tokenId,
        noTokenId: order.hedgeTokenId,
        side: "BUY",
        edge: hedgeFill ? round(1 - (fill.averagePrice + hedgeFill.averagePrice + (fill.feeUsd + hedgeFill.feeUsd) / order.shares)) : 0,
        targetShares: order.shares,
        targetNotionalUsd: fill.notionalUsd + (hedgeFill?.notionalUsd ?? 0),
        status: hedgeFailed ? "partial" : "filled",
        createdAt: new Date().toISOString(),
        marketEndDate: order.marketEndDate,
        secondsToClose: roundOptional(secondsUntilClose(order.marketEndDate))
      };
      this.store.addOpportunity(opportunity);
      this.store.upsertMakerOrder({ ...order, filledShares: fill.filledShares, status: hedgeFailed ? "partial" : "hedged", failedHedge: hedgeFailed });

      if (hedgeFailed || !hedgeFill) {
        this.store.addRejection({
          id: `reject-maker-hedge-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          strategy: "maker-arbitrage",
          marketTitle: order.marketTitle,
          conditionId: order.conditionId,
          reasons: ["Maker leg filled, but hedge leg could not fully fill within the visible order book."],
          edge: opportunity.edge,
          createdAt: new Date().toISOString()
        });
        const trade = this.execution.executeSingleLeg("maker-arbitrage", opportunity, fill, -(order.hedgeMaxLossUsd ?? 0));
        this.store.updatePaperTrade(trade.id, {
          failedHedge: true,
          lossCause: "failed-hedge",
          lossReason: "Maker leg filled, but hedge liquidity was unavailable or partial."
        });
        logger.warn("Simulated maker arbitrage hedge failed.", { orderId: order.id, fillRate: hedgeFill?.fillRate ?? 0 });
      } else {
        this.execution.executePairedArbitrage(opportunity, fill, hedgeFill, "maker-arbitrage");
        logger.info("Simulated maker arbitrage order filled and hedged.", { orderId: order.id, fillRate: hedgeFill.fillRate });
      }
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

function round(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function roundOptional(value: number | undefined): number | undefined {
  return value === undefined ? undefined : round(value);
}

function lossCauseForReasons(reasons: string[]) {
  const text = reasons.join(" ").toLowerCase();
  if (text.includes("final")) return "close-window" as const;
  if (text.includes("stale")) return "stale-data" as const;
  if (text.includes("hedge")) return "failed-hedge" as const;
  if (text.includes("depth") || text.includes("liquidity")) return "illiquidity" as const;
  if (text.includes("partial")) return "partial-fill" as const;
  if (text.includes("fee")) return "fees" as const;
  if (text.includes("spread") || text.includes("slippage")) return "slippage" as const;
  if (text.includes("edge") || text.includes("profit")) return "negative-edge" as const;
  return undefined;
}
