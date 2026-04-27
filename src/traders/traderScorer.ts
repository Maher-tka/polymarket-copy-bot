import {
  DataApiClosedPosition,
  DataApiPosition,
  DataApiTrade,
  LeaderboardTrader,
  TraderScore
} from "../types";

export interface TraderScoringInput {
  leaderboardTrader: LeaderboardTrader;
  trades: DataApiTrade[];
  positions: DataApiPosition[];
  closedPositions: DataApiClosedPosition[];
}

const DAY_SECONDS = 24 * 60 * 60;

export function scoreTrader(input: TraderScoringInput): TraderScore {
  const { leaderboardTrader, trades, closedPositions } = input;
  const wallet = leaderboardTrader.proxyWallet;
  const volumeUsd = positiveNumber(leaderboardTrader.vol) || sumTradeNotional(trades);
  const realizedPnlUsd = Number(leaderboardTrader.pnl) || sumClosedPnl(closedPositions);
  const wins = closedPositions.filter((position) => position.realizedPnl > 0).length;
  const winRate = closedPositions.length > 0 ? wins / closedPositions.length : realizedPnlUsd > 0 ? 0.5 : 0;
  const marketsTraded = new Set(trades.map((trade) => trade.conditionId).filter(Boolean)).size;
  const maxDrawdownUsd = calculateMaxDrawdown(closedPositions);

  const realizedPnlPoints = clamp((realizedPnlUsd / Math.max(1, volumeUsd * 0.1)) * 30, 0, 30);
  const winRatePoints = clamp(winRate * 20, 0, 20);
  const volumePoints = clamp((Math.log10(volumeUsd + 1) / 6) * 15, 0, 15);
  const recentPerformancePoints = calculateRecentPerformancePoints(closedPositions);
  const consistencyPoints = clamp((marketsTraded / 20) * 10, 0, 10);
  const lowDrawdownPoints = calculateLowDrawdownPoints(maxDrawdownUsd, realizedPnlUsd);

  const notes: string[] = [];
  let penalties = 0;

  if (trades.length < 10) {
    const penalty = Math.min(20, (10 - trades.length) * 2);
    penalties += penalty;
    notes.push(`Too few recent trades (${trades.length}); applied ${penalty.toFixed(1)} point penalty.`);
  }

  const concentrationPenalty = calculateConcentrationPenalty(closedPositions);
  if (concentrationPenalty > 0) {
    penalties += concentrationPenalty;
    notes.push("Profit is concentrated in one market; applied concentration penalty.");
  }

  const tinyTradeRatio =
    trades.length === 0 ? 0 : trades.filter((trade) => trade.price * trade.size < 5).length / trades.length;
  if (tinyTradeRatio > 0.6) {
    penalties += 5;
    notes.push("Many trades are very small; possible low-liquidity behavior penalty.");
  }

  const rawScore =
    realizedPnlPoints +
    winRatePoints +
    volumePoints +
    recentPerformancePoints +
    consistencyPoints +
    lowDrawdownPoints -
    penalties;

  return {
    wallet,
    userName: leaderboardTrader.userName,
    score: round(clamp(rawScore, 0, 100)),
    rank: leaderboardTrader.rank,
    volumeUsd: round(volumeUsd),
    realizedPnlUsd: round(realizedPnlUsd),
    winRate: round(winRate),
    marketsTraded,
    maxDrawdownUsd: round(maxDrawdownUsd),
    breakdown: {
      realizedPnl: round(realizedPnlPoints),
      winRate: round(winRatePoints),
      volume: round(volumePoints),
      recentPerformance: round(recentPerformancePoints),
      consistency: round(consistencyPoints),
      lowDrawdown: round(lowDrawdownPoints),
      penalties: round(penalties)
    },
    notes
  };
}

function sumTradeNotional(trades: DataApiTrade[]): number {
  return trades.reduce((total, trade) => total + positiveNumber(trade.price) * positiveNumber(trade.size), 0);
}

function sumClosedPnl(closedPositions: DataApiClosedPosition[]): number {
  return closedPositions.reduce((total, position) => total + (Number(position.realizedPnl) || 0), 0);
}

function calculateRecentPerformancePoints(closedPositions: DataApiClosedPosition[]): number {
  if (closedPositions.length === 0) return 5;

  const nowSeconds = Date.now() / 1000;
  const recent = closedPositions.filter((position) => nowSeconds - normalizeTimestamp(position.timestamp) <= 30 * DAY_SECONDS);
  if (recent.length === 0) return 7;

  const recentPnl = sumClosedPnl(recent);
  if (recentPnl > 0) return clamp(7.5 + Math.log10(recentPnl + 1) * 3, 0, 15);
  return clamp(7.5 + recentPnl, 0, 15);
}

function calculateMaxDrawdown(closedPositions: DataApiClosedPosition[]): number {
  let equity = 0;
  let peak = 0;
  let maxDrawdown = 0;

  const ordered = [...closedPositions].sort((a, b) => normalizeTimestamp(a.timestamp) - normalizeTimestamp(b.timestamp));
  for (const position of ordered) {
    equity += Number(position.realizedPnl) || 0;
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, peak - equity);
  }

  return maxDrawdown;
}

function calculateLowDrawdownPoints(maxDrawdownUsd: number, realizedPnlUsd: number): number {
  if (maxDrawdownUsd <= 0) return 10;
  const painRatio = maxDrawdownUsd / Math.max(1, Math.abs(realizedPnlUsd));
  return clamp((1 - painRatio) * 10, 0, 10);
}

function calculateConcentrationPenalty(closedPositions: DataApiClosedPosition[]): number {
  const positiveByMarket = new Map<string, number>();
  for (const position of closedPositions) {
    if (position.realizedPnl <= 0) continue;
    positiveByMarket.set(position.conditionId, (positiveByMarket.get(position.conditionId) ?? 0) + position.realizedPnl);
  }

  const totalPositivePnl = [...positiveByMarket.values()].reduce((total, pnl) => total + pnl, 0);
  if (totalPositivePnl <= 0) return 0;

  const topMarketPnl = Math.max(...positiveByMarket.values());
  return topMarketPnl / totalPositivePnl > 0.7 ? 10 : 0;
}

function normalizeTimestamp(timestamp: number): number {
  return timestamp > 10_000_000_000 ? timestamp / 1000 : timestamp;
}

function positiveNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
