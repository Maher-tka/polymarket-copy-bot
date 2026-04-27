import { logger } from "../logger";
import { ClobPublicClient } from "../polymarket/clobPublicClient";
import { StrategyRiskManager } from "../risk/strategyRiskManager";
import { StrategyPaperTrader } from "../trading/strategyPaperTrader";
import {
  BinaryMarketCandidate,
  BotConfig,
  FillSimulation,
  PortfolioSnapshot,
  StrategyOpportunity,
  StrategyRejection
} from "../types";
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

export class NetArbitrageScanner {
  constructor(
    private readonly clobClient: ClobPublicClient,
    private readonly store: StrategyStateStore,
    private readonly paperTrader: StrategyPaperTrader,
    private readonly risk: StrategyRiskManager,
    private readonly config: Pick<
      BotConfig,
      | "minNetArbEdge"
      | "minOrderBookDepthUsd"
      | "minDepthMultiplier"
      | "maxStaleDataMs"
      | "maxDataAgeMs"
      | "maxSpread"
      | "maxTradeSizeUsd"
      | "arbitrageTargetShares"
      | "takerFeeRate"
      | "cryptoTakerFeeRate"
      | "maxPositionSizePct"
      | "requireBothLegsFillable"
      | "rejectPartialFills"
      | "finalEntryBufferSeconds"
    >
  ) {}

  async scan(candidates: BinaryMarketCandidate[], portfolio: PortfolioSnapshot): Promise<void> {
    const started = Date.now();
    let scanned = 0;

    for (const candidate of candidates.slice(0, 16)) {
      scanned += 1;
      try {
        await this.scanCandidate(candidate, portfolio, started);
      } catch (error) {
        this.reject(candidate, [error instanceof Error ? error.message : String(error)]);
      }
    }

    logger.info("Net arbitrage scan completed.", { scanned, latencyMs: Date.now() - started });
  }

  private async scanCandidate(
    candidate: BinaryMarketCandidate,
    portfolio: PortfolioSnapshot,
    scanStartedAt: number
  ): Promise<void> {
    const [yesBook, noBook] = await Promise.all([
      this.clobClient.getOrderBook(candidate.yesTokenId),
      this.clobClient.getOrderBook(candidate.noTokenId)
    ]);

    const yesAgeMs = orderBookAgeMs(yesBook);
    const noAgeMs = orderBookAgeMs(noBook);
    const maxAgeMs = Math.max(yesAgeMs, noAgeMs);
    const yesBid = bestBid(yesBook);
    const yesAsk = bestAsk(yesBook);
    const noBid = bestBid(noBook);
    const noAsk = bestAsk(noBook);
    const pairSpread = spread(yesBook) + spread(noBook);

    if (yesBid === undefined || yesAsk === undefined || noBid === undefined || noAsk === undefined) {
      const reasons = ["Missing YES/NO top-of-book price."];
      this.reject(candidate, reasons);
      this.store.addDiagnostic({
        id: `diag-net-arb-${candidate.conditionId}-${Date.now()}`,
        timestamp: new Date().toISOString(),
        market: candidate.title,
        strategy: "net-arbitrage",
        yesBestBid: yesBid,
        yesBestAsk: yesAsk,
        noBestBid: noBid,
        noBestAsk: noAsk,
        spread: Number.isFinite(pairSpread) ? round(pairSpread) : undefined,
        dataAgeMs: round(maxAgeMs),
        accepted: false,
        rejectionReasons: reasons,
        failedFill: true,
        createdAt: new Date().toISOString()
      });
      return;
    }

    const rawCost = yesAsk + noAsk;
    const takerFeeRate = effectiveTakerFeeRate(candidate, this.config);
    const topFeesPerShare =
      calculateBinaryTakerFeeUsd(yesAsk, 1, takerFeeRate) + calculateBinaryTakerFeeUsd(noAsk, 1, takerFeeRate);
    const maxTradeCapUsd = Math.min(
      this.config.maxTradeSizeUsd,
      portfolio.equityUsd * Math.max(0.0001, this.config.maxPositionSizePct)
    );
    const maxSharesByUsd = maxTradeCapUsd / Math.max(0.01, rawCost + topFeesPerShare);
    const targetShares = Math.max(0.01, Math.min(this.config.arbitrageTargetShares, maxSharesByUsd));

    const yesFill = simulateOrderBookFill(yesBook, "BUY", targetShares, takerFeeRate);
    const noFill = simulateOrderBookFill(noBook, "BUY", targetShares, takerFeeRate);
    const opportunity = this.buildOpportunity(candidate, yesFill, noFill, Date.now() - scanStartedAt);
    const intendedCapitalUsd = yesFill.notionalUsd + noFill.notionalUsd + yesFill.feeUsd + noFill.feeUsd;

    logger.debug("Net arb quote evaluated.", {
      market: candidate.title,
      rawCost: opportunity.rawCost,
      edge: opportunity.edge,
      yesFillRate: yesFill.fillRate,
      noFillRate: noFill.fillRate,
      maxAgeMs
    });

    const reasons = this.rejectionReasons(candidate, opportunity, yesFill, noFill, maxAgeMs, pairSpread, intendedCapitalUsd);
    reasons.push(
      ...this.risk.evaluate(
        opportunity,
        portfolio,
        this.store.getState(),
        intendedCapitalUsd,
        Math.max(yesFill.slippagePct, noFill.slippagePct)
      )
    );

    const diagnostic = {
      id: `diag-net-arb-${opportunity.id}`,
      opportunityId: opportunity.id,
      timestamp: new Date().toISOString(),
      market: candidate.title,
      strategy: "net-arbitrage" as const,
      yesBestBid: round(yesBid),
      yesBestAsk: round(yesAsk),
      noBestBid: round(noBid),
      noBestAsk: round(noAsk),
      spread: round(pairSpread),
      orderBookDepthUsd: round(Math.min(yesFill.depthUsd, noFill.depthUsd)),
      dataAgeMs: round(maxAgeMs),
      rawEdge: round(1 - rawCost),
      estimatedFeesUsd: round(yesFill.feeUsd + noFill.feeUsd),
      estimatedSlippageUsd: round(yesFill.slippageUsd + noFill.slippageUsd),
      netEdge: opportunity.edge,
      accepted: reasons.length === 0,
      rejectionReasons: reasons,
      simulatedEntryPrice: opportunity.netCost,
      simulatedExitValue: round(Math.min(yesFill.filledShares, noFill.filledShares)),
      fillRate: round(Math.min(yesFill.fillRate, noFill.fillRate)),
      partialFill: yesFill.partial || noFill.partial,
      failedFill: yesFill.filledShares <= 0 || noFill.filledShares <= 0,
      secondsToClose: roundOptional(secondsUntilClose(candidate.endDate)),
      tooCloseToClose: isInsideFinalEntryWindow(candidate.endDate, this.config.finalEntryBufferSeconds),
      lossCause: lossCauseForReasons(reasons),
      createdAt: new Date().toISOString()
    };
    this.store.addDiagnostic(diagnostic);

    if (reasons.length > 0) {
      this.store.addOpportunity({ ...opportunity, status: "rejected", reason: reasons.join(" | ") });
      this.reject(candidate, reasons, opportunity.edge);
      return;
    }

    this.store.addOpportunity(opportunity);
    const trade = this.paperTrader.executePairedArbitrage(opportunity, yesFill, noFill);
    this.risk.recordFill(trade.fillRate);
  }

  private buildOpportunity(
    candidate: BinaryMarketCandidate,
    yesFill: FillSimulation,
    noFill: FillSimulation,
    latencyMs: number
  ): StrategyOpportunity {
    const filledShares = Math.min(yesFill.filledShares, noFill.filledShares);
    const rawCost = (yesFill.topOfBookPrice ?? yesFill.averagePrice) + (noFill.topOfBookPrice ?? noFill.averagePrice);
    const estimatedTakerFees = filledShares > 0 ? (yesFill.feeUsd + noFill.feeUsd) / filledShares : 0;
    const estimatedSlippage = filledShares > 0 ? (yesFill.slippageUsd + noFill.slippageUsd) / filledShares : 0;
    const netCost = rawCost + estimatedTakerFees + estimatedSlippage;
    const edge = 1 - netCost;

    return {
      id: `net-arb-${candidate.conditionId}-${Date.now()}`,
      strategy: "net-arbitrage",
      marketTitle: candidate.title,
      marketSlug: candidate.slug,
      conditionId: candidate.conditionId,
      yesTokenId: candidate.yesTokenId,
      noTokenId: candidate.noTokenId,
      marketEndDate: candidate.endDate,
      secondsToClose: roundOptional(secondsUntilClose(candidate.endDate)),
      rawCost: round(rawCost),
      estimatedTakerFees: round(estimatedTakerFees),
      estimatedSlippage: round(estimatedSlippage),
      netCost: round(netCost),
      edge: round(edge),
      targetShares: round(Math.min(yesFill.requestedShares, noFill.requestedShares)),
      targetNotionalUsd: round(yesFill.notionalUsd + noFill.notionalUsd),
      depthUsd: round(Math.min(yesFill.depthUsd, noFill.depthUsd)),
      status: "accepted",
      createdAt: new Date().toISOString(),
      latencyMs
    };
  }

  private rejectionReasons(
    candidate: BinaryMarketCandidate,
    opportunity: StrategyOpportunity,
    yesFill: FillSimulation,
    noFill: FillSimulation,
    maxAgeMs: number,
    pairSpread: number,
    intendedCapitalUsd: number
  ): string[] {
    const reasons: string[] = [];
    const maxAge = Math.min(this.config.maxDataAgeMs, this.config.maxStaleDataMs);
    if (maxAgeMs > maxAge) reasons.push(`Stale order book data: ${Math.round(maxAgeMs)}ms old.`);
    if (isInsideFinalEntryWindow(candidate.endDate, this.config.finalEntryBufferSeconds)) {
      reasons.push(`Market is inside final ${this.config.finalEntryBufferSeconds}s entry buffer.`);
    }
    if ((opportunity.edge ?? 0) < this.config.minNetArbEdge) reasons.push("Net edge is below MIN_NET_ARB_EDGE after costs.");
    if (pairSpread > this.config.maxSpread) reasons.push("YES/NO combined spread exceeds MAX_SPREAD.");
    const requiredDepthUsd = Math.max(this.config.minOrderBookDepthUsd, intendedCapitalUsd * this.config.minDepthMultiplier);
    if (Math.min(yesFill.depthUsd, noFill.depthUsd) < requiredDepthUsd) {
      reasons.push("Insufficient order book depth on one or both legs.");
    }
    if (this.config.requireBothLegsFillable && (yesFill.fillRate < 1 || noFill.fillRate < 1)) {
      reasons.push("Either YES or NO leg cannot fully fill target size.");
    }
    if (this.config.rejectPartialFills && (yesFill.partial || noFill.partial)) reasons.push("Partial fills are disabled by REJECT_PARTIAL_FILLS.");
    return reasons;
  }

  private reject(candidate: BinaryMarketCandidate, reasons: string[], edge?: number): void {
    const rejection: StrategyRejection = {
      id: `reject-net-arb-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      strategy: "net-arbitrage",
      marketTitle: candidate.title,
      conditionId: candidate.conditionId,
      reasons,
      edge,
      createdAt: new Date().toISOString()
    };
    this.store.addRejection(rejection);
    logger.info("Net arbitrage rejected.", { market: candidate.title, reasons, edge });
  }
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
  if (text.includes("depth") || text.includes("liquidity")) return "illiquidity" as const;
  if (text.includes("partial")) return "partial-fill" as const;
  if (text.includes("fee")) return "fees" as const;
  if (text.includes("slippage") || text.includes("spread")) return "slippage" as const;
  if (text.includes("edge")) return "negative-edge" as const;
  return undefined;
}
