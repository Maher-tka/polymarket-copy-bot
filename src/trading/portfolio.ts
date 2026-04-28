import {
  ClosedPosition,
  CopySignal,
  PaperPosition,
  PortfolioSnapshot,
  SkippedTrade,
  TraderScore,
  TradingMode
} from "../types";
import { buildExposureSummary, classifyMarketCategory } from "../risk/exposure";

const MAX_SIGNALS = 100;
const MAX_SKIPPED = 200;

export class Portfolio {
  private balanceUsd: number;
  private readonly openPositions = new Map<string, PaperPosition>();
  private readonly closedPositions: ClosedPosition[] = [];
  private readonly latestSignals: CopySignal[] = [];
  private readonly skippedTrades: SkippedTrade[] = [];
  private watchedTraders: TraderScore[] = [];
  private peakEquityUsd: number;
  private maxDrawdownUsd = 0;

  constructor(private readonly startingBalanceUsd: number, private readonly mode: TradingMode = "PAPER") {
    this.balanceUsd = startingBalanceUsd;
    this.peakEquityUsd = startingBalanceUsd;
  }

  setWatchedTraders(traders: TraderScore[]): void {
    this.watchedTraders = traders;
  }

  getWatchedTraders(): TraderScore[] {
    return [...this.watchedTraders];
  }

  addSignal(signal: CopySignal): void {
    this.latestSignals.unshift(signal);
    this.latestSignals.splice(MAX_SIGNALS);
  }

  addSkipped(reasons: string[], signal?: CopySignal): SkippedTrade {
    const skipped: SkippedTrade = {
      id: `skip-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      signalId: signal?.id,
      timestamp: new Date().toISOString(),
      reasons,
      signal
    };

    this.skippedTrades.unshift(skipped);
    this.skippedTrades.splice(MAX_SKIPPED);
    return skipped;
  }

  openOrIncrease(signal: CopySignal, entryPrice: number, tradeUsd: number, shares: number): PaperPosition {
    const existing = this.openPositions.get(signal.assetId);
    const now = new Date().toISOString();

    if (existing) {
      const newCostBasis = existing.costBasisUsd + tradeUsd;
      const newShares = existing.shares + shares;
      existing.avgEntryPrice = newCostBasis / newShares;
      existing.costBasisUsd = round(newCostBasis);
      existing.shares = round(newShares);
      existing.currentPrice = entryPrice;
      existing.currentValueUsd = round(existing.shares * entryPrice);
      existing.unrealizedPnlUsd = round(existing.currentValueUsd - existing.costBasisUsd);
      existing.updatedAt = now;
      this.balanceUsd = round(this.balanceUsd - tradeUsd);
      this.updateDrawdown();
      return existing;
    }

    const position: PaperPosition = {
      id: `pos-${signal.assetId}`,
      assetId: signal.assetId,
      conditionId: signal.conditionId,
      side: signal.side,
      marketTitle: signal.marketTitle,
      marketSlug: signal.marketSlug,
      marketCategory: signal.marketCategory ?? classifyMarketCategory(signal.marketTitle, signal.marketSlug),
      outcome: signal.outcome,
      traderCopied: signal.traderName ?? signal.traderWallet,
      traderWallet: signal.traderWallet,
      sourceSignalId: signal.id,
      status: signal.simulated ? "DEMO PAPER" : "OPEN",
      shares: round(shares),
      avgEntryPrice: entryPrice,
      costBasisUsd: round(tradeUsd),
      currentPrice: entryPrice,
      currentValueUsd: round(tradeUsd),
      unrealizedPnlUsd: 0,
      openedAt: now,
      updatedAt: now
    };

    this.openPositions.set(signal.assetId, position);
    this.balanceUsd = round(this.balanceUsd - tradeUsd);
    this.updateDrawdown();
    return position;
  }

  closeOrReduce(signal: CopySignal, exitPrice: number, requestedShares: number): ClosedPosition | undefined {
    const existing = this.openPositions.get(signal.assetId);
    if (!existing) return undefined;

    const sharesToClose = Math.min(existing.shares, requestedShares);
    if (sharesToClose <= 0) return undefined;

    const costBasis = sharesToClose * existing.avgEntryPrice;
    const proceeds = sharesToClose * exitPrice;
    const realizedPnl = proceeds - costBasis;
    const now = new Date().toISOString();

    existing.shares = round(existing.shares - sharesToClose);
    existing.costBasisUsd = round(existing.shares * existing.avgEntryPrice);
    existing.currentPrice = exitPrice;
    existing.currentValueUsd = round(existing.shares * exitPrice);
    existing.unrealizedPnlUsd = round(existing.currentValueUsd - existing.costBasisUsd);
    existing.updatedAt = now;
    this.balanceUsd = round(this.balanceUsd + proceeds);

    if (existing.shares <= 0.0001) {
      this.openPositions.delete(signal.assetId);
    }

    const closed: ClosedPosition = {
      id: `closed-${signal.id}-${now}`,
      assetId: signal.assetId,
      conditionId: signal.conditionId,
      side: existing.side ?? "BUY",
      marketTitle: signal.marketTitle,
      marketCategory: existing.marketCategory,
      outcome: signal.outcome,
      traderCopied: existing.traderCopied,
      traderWallet: existing.traderWallet,
      shares: round(sharesToClose),
      entryPrice: round(costBasis / sharesToClose),
      exitPrice: round(exitPrice),
      costBasisUsd: round(costBasis),
      proceedsUsd: round(proceeds),
      realizedPnlUsd: round(realizedPnl),
      openedAt: existing.openedAt,
      closedAt: now,
      sourceSignalId: signal.id
    };

    this.closedPositions.unshift(closed);
    this.updateDrawdown();
    return closed;
  }

  markPosition(assetId: string, currentPrice: number): void {
    const position = this.openPositions.get(assetId);
    if (!position) return;

    position.currentPrice = currentPrice;
    position.currentValueUsd = round(position.shares * currentPrice);
    position.unrealizedPnlUsd = round(position.currentValueUsd - position.costBasisUsd);
    position.updatedAt = new Date().toISOString();
    this.updateDrawdown();
  }

  getSnapshot(): PortfolioSnapshot {
    this.updateDrawdown();
    const openPositions = [...this.openPositions.values()];
    const unrealizedPnlUsd = openPositions.reduce((total, position) => total + position.unrealizedPnlUsd, 0);
    const realizedPnlUsd = this.closedPositions.reduce((total, position) => total + position.realizedPnlUsd, 0);
    const wins = this.closedPositions.filter((position) => position.realizedPnlUsd > 0).length;
    const equityUsd = this.calculateEquity();

    return {
      mode: this.mode,
      balanceUsd: round(this.balanceUsd),
      equityUsd: round(equityUsd),
      startingBalanceUsd: this.startingBalanceUsd,
      realizedPnlUsd: round(realizedPnlUsd),
      unrealizedPnlUsd: round(unrealizedPnlUsd),
      dailyRealizedPnlUsd: round(this.calculateDailyRealizedPnl()),
      winRate: this.closedPositions.length > 0 ? round(wins / this.closedPositions.length) : 0,
      maxDrawdownUsd: round(this.maxDrawdownUsd),
      maxDrawdownPct: this.peakEquityUsd > 0 ? round(this.maxDrawdownUsd / this.peakEquityUsd) : 0,
      exposure: buildExposureSummary(openPositions, equityUsd || this.startingBalanceUsd),
      openPositions,
      closedPositions: [...this.closedPositions],
      latestSignals: [...this.latestSignals],
      skippedTrades: [...this.skippedTrades]
    };
  }

  private calculateEquity(): number {
    const openValue = [...this.openPositions.values()].reduce((total, position) => total + position.currentValueUsd, 0);
    return this.balanceUsd + openValue;
  }

  private updateDrawdown(): void {
    const equity = this.calculateEquity();
    this.peakEquityUsd = Math.max(this.peakEquityUsd, equity);
    this.maxDrawdownUsd = Math.max(this.maxDrawdownUsd, this.peakEquityUsd - equity);
  }

  private calculateDailyRealizedPnl(): number {
    const today = new Date().toISOString().slice(0, 10);
    return this.closedPositions
      .filter((position) => position.closedAt.slice(0, 10) === today)
      .reduce((total, position) => total + position.realizedPnlUsd, 0);
  }
}

function round(value: number): number {
  return Math.round(value * 10000) / 10000;
}
