import { StrategyDiagnosticRecord, StrategyMetrics, StrategyName, StrategyPaperTrade } from "../types";
import { actualEdge, tradePnl } from "./analyzer";

const STRATEGIES: StrategyName[] = [
  "maker-arbitrage",
  "net-arbitrage",
  "market-making",
  "btc-momentum-filter",
  "whale-tracker"
];

export interface ExpectancyThresholds {
  meaningfulProfitPerTradeUsd: number;
  profitFactor: number;
  maxDrawdownUsd: number;
  misleadingWinRateMinWinRate: number;
  misleadingWinRateMaxProfitPerTrade: number;
}

export interface ExpectancyStats {
  trades: number;
  winRate: number;
  netPnlUsd: number;
  realizedPnlUsd: number;
  unrealizedPnlUsd: number;
  netProfitPerTrade: number;
  averageWin: number;
  averageLoss: number;
  profitFactor: number;
  expectancyPerTrade: number;
  maxDrawdownUsd: number;
  totalFeesUsd: number;
  totalSlippageUsd: number;
  feesSlippageAdjustedPnlUsd: number;
  latencyAdjustedPnlUsd: number;
  latencyAverageMs: number;
  latencyP95Ms: number;
  averageEdge: number;
  averageActualEdge: number;
  misleadingWinRateWarning?: string;
  good: boolean;
}

export function calculateExpectancyStats(
  trades: StrategyPaperTrade[],
  diagnostics: StrategyDiagnosticRecord[] = [],
  thresholds: ExpectancyThresholds = defaultExpectancyThresholds()
): ExpectancyStats {
  const pnlValues = trades.map(tradePnl);
  const wins = pnlValues.filter((pnl) => pnl > 0);
  const losses = pnlValues.filter((pnl) => pnl < 0);
  const grossProfit = wins.reduce((total, pnl) => total + pnl, 0);
  const grossLoss = Math.abs(losses.reduce((total, pnl) => total + pnl, 0));
  const netPnlUsd = pnlValues.reduce((total, pnl) => total + pnl, 0);
  const realizedPnlUsd = trades.reduce((total, trade) => total + trade.realizedPnlUsd, 0);
  const unrealizedPnlUsd = trades.reduce((total, trade) => total + trade.unrealizedPnlUsd, 0);
  const totalFeesUsd = trades.reduce((total, trade) => total + trade.feesUsd, 0);
  const totalSlippageUsd = trades.reduce((total, trade) => total + trade.slippageUsd, 0);
  const latencyPenalties = diagnostics.reduce((total, item) => total + (item.latencyPenaltyUsd ?? 0), 0);
  const latencyValues = diagnostics.map((item) => item.totalLatencyMs).filter((value): value is number => Number.isFinite(value));
  const netProfitPerTrade = trades.length > 0 ? netPnlUsd / trades.length : 0;
  const winRate = trades.length > 0 ? wins.length / trades.length : 0;
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Number.POSITIVE_INFINITY : 0;
  const averageWin = wins.length > 0 ? grossProfit / wins.length : 0;
  const averageLoss = losses.length > 0 ? grossLoss / losses.length : 0;
  const expectancyPerTrade = winRate * averageWin - (1 - winRate) * averageLoss;
  const maxDrawdownUsd = calculateMaxDrawdown(pnlValues);
  const warning = misleadingWinRateWarning({
    winRate,
    netProfitPerTrade,
    thresholds
  });

  return {
    trades: trades.length,
    winRate: round(winRate),
    netPnlUsd: round(netPnlUsd),
    realizedPnlUsd: round(realizedPnlUsd),
    unrealizedPnlUsd: round(unrealizedPnlUsd),
    netProfitPerTrade: round(netProfitPerTrade),
    averageWin: round(averageWin),
    averageLoss: round(averageLoss),
    profitFactor: round(profitFactor),
    expectancyPerTrade: round(expectancyPerTrade),
    maxDrawdownUsd: round(maxDrawdownUsd),
    totalFeesUsd: round(totalFeesUsd),
    totalSlippageUsd: round(totalSlippageUsd),
    feesSlippageAdjustedPnlUsd: round(netPnlUsd - totalFeesUsd - totalSlippageUsd),
    latencyAdjustedPnlUsd: round(netPnlUsd - latencyPenalties),
    latencyAverageMs: round(average(latencyValues)),
    latencyP95Ms: round(percentile(latencyValues, 0.95)),
    averageEdge: round(average(trades.map((trade) => trade.edge))),
    averageActualEdge: round(average(trades.map((trade) => trade.actualEdge ?? actualEdge(trade)))),
    misleadingWinRateWarning: warning,
    good:
      expectancyPerTrade > 0 &&
      profitFactor > thresholds.profitFactor &&
      netProfitPerTrade >= thresholds.meaningfulProfitPerTradeUsd &&
      maxDrawdownUsd <= thresholds.maxDrawdownUsd &&
      netPnlUsd - latencyPenalties > 0
  };
}

export function buildExpectancyMetrics(
  trades: StrategyPaperTrade[],
  diagnostics: StrategyDiagnosticRecord[] = [],
  thresholds: ExpectancyThresholds = defaultExpectancyThresholds()
): StrategyMetrics[] {
  return STRATEGIES.map((strategy) => {
    const strategyTrades = trades.filter((trade) => trade.strategy === strategy);
    const strategyDiagnostics = diagnostics.filter((item) => item.strategy === strategy);
    const stats = calculateExpectancyStats(strategyTrades, strategyDiagnostics, thresholds);
    return {
      strategy,
      simulatedPnlUsd: stats.netPnlUsd,
      winRate: stats.winRate,
      maxDrawdownUsd: stats.maxDrawdownUsd,
      fillRate: round(average(strategyTrades.map((trade) => trade.fillRate))),
      averageEdge: stats.averageEdge,
      averageActualEdge: stats.averageActualEdge,
      netProfitPerTrade: stats.netProfitPerTrade,
      averageWin: stats.averageWin,
      averageLoss: stats.averageLoss,
      profitFactor: stats.profitFactor,
      expectancyPerTrade: stats.expectancyPerTrade,
      realizedPnlUsd: stats.realizedPnlUsd,
      unrealizedPnlUsd: stats.unrealizedPnlUsd,
      feesSlippageAdjustedPnlUsd: stats.feesSlippageAdjustedPnlUsd,
      latencyAdjustedPnlUsd: stats.latencyAdjustedPnlUsd,
      latencyAverageMs: stats.latencyAverageMs,
      latencyP95Ms: stats.latencyP95Ms,
      misleadingWinRateWarning: stats.misleadingWinRateWarning,
      averageSlippage: round(average(strategyTrades.map((trade) => trade.slippageUsd))),
      rejectedCount: 0,
      acceptedCount: strategyTrades.length,
      failedFillCount: strategyTrades.filter((trade) => trade.fillRate < 1).length
    };
  });
}

export function misleadingWinRateWarning(input: {
  winRate: number;
  netProfitPerTrade: number;
  thresholds?: ExpectancyThresholds;
}): string | undefined {
  const thresholds = input.thresholds ?? defaultExpectancyThresholds();
  if (
    input.winRate >= thresholds.misleadingWinRateMinWinRate &&
    input.netProfitPerTrade <= thresholds.misleadingWinRateMaxProfitPerTrade
  ) {
    return "High win rate is misleading: net profit per trade is too small.";
  }
  return undefined;
}

export function defaultExpectancyThresholds(): ExpectancyThresholds {
  return {
    meaningfulProfitPerTradeUsd: 0.01,
    profitFactor: 1.5,
    maxDrawdownUsd: 5,
    misleadingWinRateMinWinRate: 0.9,
    misleadingWinRateMaxProfitPerTrade: 0.01
  };
}

function calculateMaxDrawdown(pnlValues: number[]): number {
  let equity = 0;
  let peak = 0;
  let drawdown = 0;
  for (const pnl of pnlValues) {
    equity += pnl;
    peak = Math.max(peak, equity);
    drawdown = Math.max(drawdown, peak - equity);
  }
  return drawdown;
}

function percentile(values: number[], p: number): number {
  const finite = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (finite.length === 0) return 0;
  const index = Math.min(finite.length - 1, Math.ceil(finite.length * p) - 1);
  return finite[index];
}

function average(values: number[]): number {
  const finite = values.filter(Number.isFinite);
  return finite.length === 0 ? 0 : finite.reduce((total, value) => total + value, 0) / finite.length;
}

function round(value: number): number {
  if (!Number.isFinite(value)) return value;
  return Math.round(value * 10000) / 10000;
}
