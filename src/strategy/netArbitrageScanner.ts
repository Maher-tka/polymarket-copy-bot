import { logger } from "../logger";
import { StrategyExecutionPort } from "../execution/executionLayer";
import { ClobPublicClient } from "../polymarket/clobPublicClient";
import { StrategyRiskManager } from "../risk/strategyRiskManager";
import {
  BinaryMarketCandidate,
  BotConfig,
  FillSimulation,
  OrderBook,
  PortfolioSnapshot,
  StrategyOpportunity,
  StrategyRejection
} from "../types";
import {
  bestAsk,
  bestBid,
  calculateBinaryTakerFeeUsd,
  effectiveTakerFeeRate,
  isInsideCandidateFinalEntryWindow,
  orderBookAgeMs,
  secondsUntilCandidateClose,
  simulateOrderBookFill,
  spread
} from "./orderBookMath";
import { StrategyStateStore } from "./strategyState";
import { latencyPenaltyEdge } from "../latency/latencyEngine";

export class NetArbitrageScanner {
  private readonly staleCooldownUntil = new Map<string, number>();
  private lastScoutTradeAt = 0;

  constructor(
    private readonly clobClient: Pick<ClobPublicClient, "getOrderBook"> & Partial<Pick<ClobPublicClient, "getOrderBooks">>,
    private readonly store: StrategyStateStore,
    private readonly execution: StrategyExecutionPort,
    private readonly risk: StrategyRiskManager,
    private readonly config: Pick<
      BotConfig,
      | "paperTradingOnly"
      | "minNetArbEdge"
      | "minOrderBookDepthUsd"
      | "minDepthMultiplier"
      | "paperScoutMode"
      | "paperScoutMaxNegativeEdge"
      | "paperScoutMaxSpread"
      | "paperScoutIntervalSeconds"
      | "paperScoutMaxOpenTrades"
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
      | "maxTotalLatencyMs"
      | "latencyPenaltyBpsPerSecond"
      | "minRealEdge"
    >
  ) {}

  async scan(candidates: BinaryMarketCandidate[], portfolio: PortfolioSnapshot): Promise<void> {
    const started = Date.now();
    let scanned = 0;
    const now = Date.now();

    for (const candidate of candidates.filter((item) => isInsideCandidateFinalEntryWindow(item, this.config.finalEntryBufferSeconds, now))) {
      this.rejectWithoutOrderBook(candidate, [`Market is inside final ${this.config.finalEntryBufferSeconds}s entry buffer.`]);
    }

    const scanCandidates = candidates
      .filter((candidate) => !isInsideCandidateFinalEntryWindow(candidate, this.config.finalEntryBufferSeconds, now))
      .filter((candidate) => !this.isCoolingDown(candidate.conditionId, now))
      .slice(0, 16);
    const batchedBooks = await this.loadBatchedBooks(scanCandidates);

    // Small batches cut scan latency without hammering the public CLOB API with
    // every token request at once.
    for (const batch of chunks(scanCandidates, 4)) {
      scanned += batch.length;
      await Promise.all(
        batch.map((candidate) =>
          this.scanCandidate(candidate, portfolio, started, batchedBooks).catch((error) => {
            this.reject(candidate, [error instanceof Error ? error.message : String(error)]);
          })
        )
      );
    }

    logger.info("Net arbitrage scan completed.", { scanned, latencyMs: Date.now() - started });
  }

  private async scanCandidate(
    candidate: BinaryMarketCandidate,
    portfolio: PortfolioSnapshot,
    scanStartedAt: number,
    batchedBooks?: Map<string, OrderBook>
  ): Promise<void> {
    const [yesBook, noBook] = batchedBooks
      ? [batchedBooks.get(candidate.yesTokenId), batchedBooks.get(candidate.noTokenId)]
      : await Promise.all([
          this.clobClient.getOrderBook(candidate.yesTokenId),
          this.clobClient.getOrderBook(candidate.noTokenId)
        ]);

    if (!yesBook || !noBook) {
      this.coolDownStaleCandidate(candidate.conditionId, 5 * 60_000);
      this.rejectWithoutOrderBook(candidate, ["Missing batched order book response from CLOB API."]);
      return;
    }

    const yesAgeMs = orderBookAgeMs(yesBook);
    const noAgeMs = orderBookAgeMs(noBook);
    const maxAgeMs = Math.max(yesAgeMs, noAgeMs);
    const staleLimitMs = Math.min(this.config.maxDataAgeMs, this.config.maxStaleDataMs);
    const yesBid = bestBid(yesBook);
    const yesAsk = bestAsk(yesBook);
    const noBid = bestBid(noBook);
    const noAsk = bestAsk(noBook);
    const pairSpread = spread(yesBook) + spread(noBook);

    if (yesBid === undefined || yesAsk === undefined || noBid === undefined || noAsk === undefined) {
      const reasons = ["Missing YES/NO top-of-book price."];
      if (maxAgeMs > staleLimitMs) this.coolDownStaleCandidate(candidate.conditionId, maxAgeMs);
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
    const totalLatencyMs = Date.now() - scanStartedAt;
    const penaltyEdge = latencyPenaltyEdge(totalLatencyMs, this.config.latencyPenaltyBpsPerSecond);
    const filledShares = Math.min(yesFill.filledShares, noFill.filledShares);
    opportunity.totalLatencyMs = round(totalLatencyMs);
    opportunity.dataAgeMs = round(maxAgeMs);
    opportunity.latencyPenaltyUsd = round(penaltyEdge * filledShares);
    opportunity.realEdge = round((opportunity.edge ?? 0) - penaltyEdge);
    const intendedCapitalUsd = yesFill.notionalUsd + noFill.notionalUsd + yesFill.feeUsd + noFill.feeUsd;

    logger.debug("Net arb quote evaluated.", {
      market: candidate.title,
      rawCost: opportunity.rawCost,
      edge: opportunity.edge,
      realEdge: opportunity.realEdge,
      yesFillRate: yesFill.fillRate,
      noFillRate: noFill.fillRate,
      totalLatencyMs,
      maxAgeMs
    });

    const reasons = this.rejectionReasons(candidate, opportunity, yesFill, noFill, maxAgeMs, pairSpread, intendedCapitalUsd, totalLatencyMs);
    if (maxAgeMs > staleLimitMs) this.coolDownStaleCandidate(candidate.conditionId, maxAgeMs);
    reasons.push(
      ...this.risk.evaluate(
        opportunity,
        portfolio,
        this.store.getState(),
        intendedCapitalUsd,
        Math.max(yesFill.slippagePct, noFill.slippagePct)
      )
    );
    const scoutReason = this.paperScoutReason({
      opportunity,
      reasons,
      yesFill,
      noFill,
      maxAgeMs,
      pairSpread,
      now: Date.now()
    });
    const accepted = reasons.length === 0 || scoutReason !== undefined;

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
      realEdge: opportunity.realEdge,
      accepted,
      rejectionReasons: scoutReason ? [] : reasons,
      simulatedEntryPrice: opportunity.netCost,
      simulatedExitValue: round(Math.min(yesFill.filledShares, noFill.filledShares)),
      fillRate: round(Math.min(yesFill.fillRate, noFill.fillRate)),
      partialFill: yesFill.partial || noFill.partial,
      failedFill: yesFill.filledShares <= 0 || noFill.filledShares <= 0,
      secondsToClose: roundOptional(secondsUntilCandidateClose(candidate)),
      tooCloseToClose: isInsideCandidateFinalEntryWindow(candidate, this.config.finalEntryBufferSeconds),
      lossCause: lossCauseForReasons(reasons),
      totalLatencyMs: round(totalLatencyMs),
      latencyPenaltyUsd: opportunity.latencyPenaltyUsd,
      latencyAdjustedPnlUsd: round((opportunity.realEdge ?? opportunity.edge) * Math.min(yesFill.filledShares, noFill.filledShares)),
      reasonForLoss: scoutReason,
      createdAt: new Date().toISOString()
    };
    this.store.addDiagnostic(diagnostic);

    if (scoutReason) {
      this.lastScoutTradeAt = Date.now();
      const scoutOpportunity = { ...opportunity, status: "filled" as const, reason: scoutReason, paperScout: true };
      this.store.addOpportunity(scoutOpportunity);
      const trade = this.execution.executePairedArbitrage(scoutOpportunity, yesFill, noFill);
      this.risk.recordFill(trade.fillRate);
      logger.info("Paper scout mode accepted near-miss net arbitrage quote.", {
        market: candidate.title,
        edge: opportunity.edge,
        pairSpread: round(pairSpread),
        reason: scoutReason
      });
      return;
    }

    if (reasons.length > 0) {
      this.store.addOpportunity({ ...opportunity, status: "rejected", reason: reasons.join(" | ") });
      this.reject(candidate, reasons, opportunity.edge);
      return;
    }

    this.store.addOpportunity(opportunity);
    const trade = this.execution.executePairedArbitrage(opportunity, yesFill, noFill);
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
      secondsToClose: roundOptional(secondsUntilCandidateClose(candidate)),
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
    intendedCapitalUsd: number,
    totalLatencyMs: number
  ): string[] {
    const reasons: string[] = [];
    const maxAge = Math.min(this.config.maxDataAgeMs, this.config.maxStaleDataMs);
    if (maxAgeMs > maxAge) reasons.push(`Stale order book data: ${Math.round(maxAgeMs)}ms old.`);
    if (isInsideCandidateFinalEntryWindow(candidate, this.config.finalEntryBufferSeconds)) {
      reasons.push(`Market is inside final ${this.config.finalEntryBufferSeconds}s entry buffer.`);
    }
    if ((opportunity.edge ?? 0) < this.config.minNetArbEdge) reasons.push("Net edge is below MIN_NET_ARB_EDGE after costs.");
    if ((opportunity.realEdge ?? opportunity.edge ?? 0) < this.config.minRealEdge) {
      reasons.push("Real edge is below MIN_REAL_EDGE after latency penalty.");
    }
    if (totalLatencyMs > this.config.maxTotalLatencyMs) {
      reasons.push(`Total latency ${Math.round(totalLatencyMs)}ms exceeds MAX_TOTAL_LATENCY_MS.`);
    }
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

  private paperScoutReason(input: {
    opportunity: StrategyOpportunity;
    reasons: string[];
    yesFill: FillSimulation;
    noFill: FillSimulation;
    maxAgeMs: number;
    pairSpread: number;
    now: number;
  }): string | undefined {
    if (!this.config.paperScoutMode || !this.config.paperTradingOnly) return undefined;
    if (input.reasons.length === 0 || !input.reasons.every(isPaperScoutOverridableReason)) return undefined;
    if ((input.opportunity.edge ?? 0) < -Math.abs(this.config.paperScoutMaxNegativeEdge)) return undefined;
    if (input.pairSpread > this.config.paperScoutMaxSpread) return undefined;
    if (input.maxAgeMs > Math.min(this.config.maxDataAgeMs, this.config.maxStaleDataMs)) return undefined;
    if (input.yesFill.fillRate < 1 || input.noFill.fillRate < 1 || input.yesFill.partial || input.noFill.partial) return undefined;
    if (input.yesFill.filledShares <= 0 || input.noFill.filledShares <= 0) return undefined;

    const intervalMs = Math.max(0, this.config.paperScoutIntervalSeconds * 1000);
    if (input.now - this.lastScoutTradeAt < intervalMs) return undefined;

    const maxOpenScoutTrades = Math.max(0, Math.floor(this.config.paperScoutMaxOpenTrades));
    if (maxOpenScoutTrades <= 0) return undefined;
    const openScoutTrades = this.store
      .getState()
      .paperTrades.filter((trade) => trade.strategy === "net-arbitrage" && !trade.closedAt && trade.edge <= 0).length;
    if (openScoutTrades >= maxOpenScoutTrades) return undefined;

    return `Paper scout mode: near-miss learning trade accepted despite ${input.reasons.join(" | ")}`;
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

  private rejectWithoutOrderBook(candidate: BinaryMarketCandidate, reasons: string[]): void {
    this.store.addDiagnostic({
      id: `diag-net-arb-prebook-${candidate.conditionId}-${Date.now()}`,
      timestamp: new Date().toISOString(),
      market: candidate.title,
      strategy: "net-arbitrage",
      accepted: false,
      rejectionReasons: reasons,
      secondsToClose: roundOptional(secondsUntilCandidateClose(candidate)),
      tooCloseToClose: isInsideCandidateFinalEntryWindow(candidate, this.config.finalEntryBufferSeconds),
      lossCause: lossCauseForReasons(reasons),
      createdAt: new Date().toISOString()
    });
    this.reject(candidate, reasons);
  }

  private async loadBatchedBooks(candidates: BinaryMarketCandidate[]): Promise<Map<string, OrderBook> | undefined> {
    if (candidates.length === 0) return undefined;
    if (!this.clobClient.getOrderBooks) return undefined;
    try {
      return await this.clobClient.getOrderBooks(candidates.flatMap((candidate) => [candidate.yesTokenId, candidate.noTokenId]));
    } catch (error) {
      logger.warn("Batch CLOB order book fetch failed; falling back to per-token reads.", {
        error: error instanceof Error ? error.message : String(error)
      });
      return undefined;
    }
  }

  private isCoolingDown(conditionId: string, now = Date.now()): boolean {
    const until = this.staleCooldownUntil.get(conditionId);
    if (!until) return false;
    if (until <= now) {
      this.staleCooldownUntil.delete(conditionId);
      return false;
    }
    return true;
  }

  private coolDownStaleCandidate(conditionId: string, ageMs: number): void {
    const cooldownMs = Math.min(5 * 60_000, Math.max(30_000, Math.round(ageMs)));
    this.staleCooldownUntil.set(conditionId, Date.now() + cooldownMs);
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

function isPaperScoutOverridableReason(reason: string): boolean {
  return reason === "Net edge is below MIN_NET_ARB_EDGE after costs." || reason === "YES/NO combined spread exceeds MAX_SPREAD.";
}

function chunks<T>(items: T[], size: number): T[][] {
  const output: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    output.push(items.slice(index, index + size));
  }
  return output;
}
