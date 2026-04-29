import {
  LosingDiagnosticsSummary,
  StrategyDiagnosticRecord,
  StrategyName,
  StrategyPaperTrade,
  StrategyRejection
} from "../types";

const STRATEGIES: StrategyName[] = [
  "maker-arbitrage",
  "net-arbitrage",
  "market-making",
  "btc-momentum-filter",
  "whale-tracker"
];

const STRATEGY_LABELS: Record<StrategyName, string> = {
  "maker-arbitrage": "maker-first arbitrage",
  "net-arbitrage": "taker arbitrage",
  "market-making": "market-making",
  "btc-momentum-filter": "BTC momentum filter",
  "whale-tracker": "whale/copy signal"
};
const PAPER_CANDIDATE_MIN_TRADES = 30;
const REAL_LOCKED_MIN_TRADES = 100;
const REAL_LOCKED_MIN_SIGNALS = 1000;
const TARGET_WIN_RATE = 0.6;

export function buildLosingDiagnostics(input: {
  diagnostics: StrategyDiagnosticRecord[];
  trades: StrategyPaperTrade[];
  rejections: StrategyRejection[];
}): LosingDiagnosticsSummary {
  const { diagnostics, trades, rejections } = input;
  const closedOrMarkedTrades = trades.filter((trade) => trade.closedAt || trade.realizedPnlUsd !== 0 || trade.unrealizedPnlUsd !== 0);
  const wins = closedOrMarkedTrades.filter((trade) => tradePnl(trade) > 0).length;
  const byReason = new Map<string, number>();
  const strategyPnl = new Map<StrategyName, number>();

  for (const rejection of rejections) {
    for (const reason of rejection.reasons) {
      byReason.set(reason, (byReason.get(reason) ?? 0) + 1);
    }
  }

  for (const diagnostic of diagnostics) {
    for (const reason of diagnostic.rejectionReasons) {
      byReason.set(reason, (byReason.get(reason) ?? 0) + 1);
    }
  }

  for (const strategy of STRATEGIES) {
    strategyPnl.set(
      strategy,
      trades.filter((trade) => trade.strategy === strategy).reduce((total, trade) => total + tradePnl(trade), 0)
    );
  }

  const sortedStrategies = [...strategyPnl.entries()].sort((a, b) => b[1] - a[1]);
  const sortedTrades = [...trades].sort((a, b) => tradePnl(a) - tradePnl(b));
  const rejectedDiagnostics = diagnostics.filter((item) => !item.accepted);
  const liveDiagnostics = diagnostics.slice(0, 50);
  const lossCauses = [...diagnostics.map((item) => item.lossCause), ...trades.map((trade) => trade.lossCause ?? classifyTradeLoss(trade))];
  const strategyRanking = STRATEGIES.map((strategy) => {
    const strategyTrades = trades.filter((trade) => trade.strategy === strategy);
    const strategyDiagnostics = diagnostics.filter((item) => item.strategy === strategy);
    const strategySignals =
      strategyDiagnostics.length +
      rejections.filter((item) => item.strategy === strategy).length +
      strategyTrades.length;
    const completed = strategyTrades.filter((trade) => trade.closedAt || trade.realizedPnlUsd !== 0 || trade.unrealizedPnlUsd !== 0);
    const winsForStrategy = completed.filter((trade) => tradePnl(trade) > 0).length;
    const netPnlUsd = strategyTrades.reduce((total, trade) => total + tradePnl(trade), 0);
    const averageActual = average(strategyTrades.map((trade) => trade.actualEdge ?? actualEdge(trade)));
    const expectancy = expectancyStats(strategyTrades, strategyDiagnostics);
    return {
      strategy,
      label: STRATEGY_LABELS[strategy],
      trades: strategyTrades.length,
      signals: strategySignals,
      netPnlUsd: round(netPnlUsd),
      winRate: completed.length > 0 ? round(winsForStrategy / completed.length) : 0,
      averageNetEdge: round(average(strategyDiagnostics.map((item) => item.netEdge))),
      averageActualEdge: round(averageActual),
      netProfitPerTrade: expectancy.netProfitPerTrade,
      profitFactor: expectancy.profitFactor,
      expectancyPerTrade: expectancy.expectancyPerTrade,
      maxDrawdownUsd: expectancy.maxDrawdownUsd,
      latencyAdjustedPnlUsd: expectancy.latencyAdjustedPnlUsd,
      misleadingWinRateWarning: expectancy.misleadingWinRateWarning,
      status: strategyStatus({
        trades: strategyTrades.length,
        signals: strategySignals,
        netPnlUsd,
        averageActualEdge: averageActual,
        winRate: completed.length > 0 ? winsForStrategy / completed.length : 0,
        expectancyPerTrade: expectancy.expectancyPerTrade,
        profitFactor: expectancy.profitFactor,
        latencyAdjustedPnlUsd: expectancy.latencyAdjustedPnlUsd
      })
    };
  }).sort((a, b) => b.expectancyPerTrade - a.expectancyPerTrade || b.netPnlUsd - a.netPnlUsd);
  const overallExpectancy = expectancyStats(trades, diagnostics);
  const staleDataCount = liveDiagnostics.filter((item) => item.dataAgeMs !== undefined && item.dataAgeMs > 1000).length;

  return {
    totalSignals: Math.max(diagnostics.length, rejections.length + trades.length),
    tradesTaken: trades.length,
    rejectedSignals: Math.max(rejectedDiagnostics.length, rejections.length),
    rejectionReasons: [...byReason.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([reason, count]) => ({ reason, count })),
    winRate: closedOrMarkedTrades.length > 0 ? round(wins / closedOrMarkedTrades.length) : 0,
    netPnlUsd: round(trades.reduce((total, trade) => total + tradePnl(trade), 0)),
    grossPnlUsd: round(trades.reduce((total, trade) => total + (trade.grossPnlUsd ?? tradePnl(trade) + trade.feesUsd), 0)),
    totalFeesUsd: round(trades.reduce((total, trade) => total + trade.feesUsd, 0)),
    totalSlippageUsd: round(trades.reduce((total, trade) => total + trade.slippageUsd, 0)),
    estimatedFeesUsd: round(diagnostics.reduce((total, item) => total + (item.estimatedFeesUsd ?? 0), 0)),
    estimatedSlippageUsd: round(diagnostics.reduce((total, item) => total + (item.estimatedSlippageUsd ?? 0), 0)),
    averageSpread: round(average(diagnostics.map((item) => item.spread))),
    averageDataDelayMs: round(average(liveDiagnostics.map((item) => item.dataAgeMs))),
    failedFills: diagnostics.filter((item) => item.failedFill).length + trades.filter((trade) => trade.fillRate <= 0).length,
    partialFills: diagnostics.filter((item) => item.partialFill).length + trades.filter((trade) => trade.fillRate > 0 && trade.fillRate < 1).length,
    failedHedges: diagnostics.filter((item) => item.failedHedge).length + trades.filter((trade) => trade.failedHedge).length,
    tradesTooCloseToClose: diagnostics.filter((item) => item.tooCloseToClose).length,
    lossesCausedByFees: lossCauses.filter((cause) => cause === "fees").length,
    lossesCausedBySlippage: lossCauses.filter((cause) => cause === "slippage").length,
    lossesCausedByStaleData: lossCauses.filter((cause) => cause === "stale-data").length,
    lossesCausedByIlliquidity: lossCauses.filter((cause) => cause === "illiquidity").length,
    averageRawEdge: round(average(diagnostics.map((item) => item.rawEdge))),
    averageNetEdge: round(average(diagnostics.map((item) => item.netEdge))),
    averageEdge: round(average([...diagnostics.map((item) => item.netEdge), ...trades.map((trade) => trade.edge)])),
    averageActualEdge: round(average(trades.map((trade) => trade.actualEdge ?? actualEdge(trade)))),
    averageDepthUsd: round(average(diagnostics.map((item) => item.orderBookDepthUsd))),
    netProfitPerTrade: overallExpectancy.netProfitPerTrade,
    averageWin: overallExpectancy.averageWin,
    averageLoss: overallExpectancy.averageLoss,
    profitFactor: overallExpectancy.profitFactor,
    expectancyPerTrade: overallExpectancy.expectancyPerTrade,
    latencyAdjustedPnlUsd: overallExpectancy.latencyAdjustedPnlUsd,
    latencyAverageMs: round(average(liveDiagnostics.map((item) => item.totalLatencyMs))),
    latencyP95Ms: round(percentile(liveDiagnostics.map((item) => item.totalLatencyMs), 0.95)),
    staleDataCount,
    staleDataPct: liveDiagnostics.length > 0 ? round(staleDataCount / liveDiagnostics.length) : 0,
    misleadingWinRateWarning: overallExpectancy.misleadingWinRateWarning,
    worstTrade: sortedTrades[0],
    bestTrade: sortedTrades[sortedTrades.length - 1],
    mostProfitableStrategy: sortedStrategies[0]?.[1] !== 0 ? sortedStrategies[0]?.[0] : undefined,
    leastProfitableStrategy: sortedStrategies[sortedStrategies.length - 1]?.[1] !== 0 ? sortedStrategies[sortedStrategies.length - 1]?.[0] : undefined,
    strategyRanking
  };
}

function strategyStatus(input: {
  trades: number;
  signals: number;
  netPnlUsd: number;
  averageActualEdge: number;
  winRate: number;
  expectancyPerTrade: number;
  profitFactor: number;
  latencyAdjustedPnlUsd: number;
}) {
  const profitable =
    input.netPnlUsd > 0 &&
    input.averageActualEdge > 0 &&
    input.winRate >= TARGET_WIN_RATE &&
    input.expectancyPerTrade > 0 &&
    input.profitFactor > 1.5 &&
    input.latencyAdjustedPnlUsd > 0;
  if (input.trades >= REAL_LOCKED_MIN_TRADES || input.signals >= REAL_LOCKED_MIN_SIGNALS) {
    return profitable ? ("real-locked-positive" as const) : ("losing" as const);
  }
  if (input.trades >= PAPER_CANDIDATE_MIN_TRADES && profitable) return "paper-candidate" as const;
  return "needs-more-data" as const;
}

export function tradePnl(trade: StrategyPaperTrade): number {
  return (trade.realizedPnlUsd ?? 0) + (trade.unrealizedPnlUsd ?? 0);
}

export function actualEdge(trade: StrategyPaperTrade): number {
  if (!Number.isFinite(trade.entryCostUsd) || trade.entryCostUsd <= 0) return 0;
  return tradePnl(trade) / trade.entryCostUsd;
}

export function explainLoss(trade: Pick<StrategyPaperTrade, "feesUsd" | "slippageUsd" | "edge" | "fillRate">): string | undefined {
  if (trade.fillRate <= 0) return "Failed fill: no simulated shares were filled.";
  if (trade.fillRate < 1) return "Partial fill: the order book could not fill the target size.";
  if (trade.edge < 0) return "Negative edge after costs.";
  if (trade.slippageUsd > trade.feesUsd && trade.slippageUsd > 0) return "Slippage consumed the expected edge.";
  if (trade.feesUsd > 0) return "Fees consumed the expected edge.";
  return undefined;
}

function classifyTradeLoss(trade: StrategyPaperTrade) {
  if (tradePnl(trade) >= 0) return undefined;
  if (trade.failedHedge) return "failed-hedge" as const;
  if (trade.fillRate <= 0) return "illiquidity" as const;
  if (trade.fillRate < 1) return "partial-fill" as const;
  if (trade.slippageUsd > trade.feesUsd && trade.slippageUsd > 0) return "slippage" as const;
  if (trade.feesUsd > 0) return "fees" as const;
  if (trade.edge < 0) return "negative-edge" as const;
  return undefined;
}

function average(values: Array<number | undefined>): number {
  const finite = values.filter((value): value is number => Number.isFinite(value));
  return finite.length === 0 ? 0 : finite.reduce((total, value) => total + value, 0) / finite.length;
}

function percentile(values: Array<number | undefined>, p: number): number {
  const finite = values.filter((value): value is number => Number.isFinite(value)).sort((a, b) => a - b);
  if (finite.length === 0) return 0;
  const index = Math.min(finite.length - 1, Math.ceil(finite.length * p) - 1);
  return finite[index];
}

function expectancyStats(trades: StrategyPaperTrade[], diagnostics: StrategyDiagnosticRecord[]) {
  const pnls = trades.map(tradePnl);
  const wins = pnls.filter((pnl) => pnl > 0);
  const losses = pnls.filter((pnl) => pnl < 0);
  const grossProfit = wins.reduce((total, pnl) => total + pnl, 0);
  const grossLoss = Math.abs(losses.reduce((total, pnl) => total + pnl, 0));
  const netPnl = pnls.reduce((total, pnl) => total + pnl, 0);
  const winRate = trades.length > 0 ? wins.length / trades.length : 0;
  const averageWin = wins.length > 0 ? grossProfit / wins.length : 0;
  const averageLoss = losses.length > 0 ? grossLoss / losses.length : 0;
  const netProfitPerTrade = trades.length > 0 ? netPnl / trades.length : 0;
  const latencyPenalty = diagnostics.reduce((total, item) => total + (item.latencyPenaltyUsd ?? 0), 0);
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Number.POSITIVE_INFINITY : 0;
  const warning =
    winRate >= 0.9 && netProfitPerTrade <= 0.01
      ? "High win rate is misleading: net profit per trade is too small."
      : undefined;
  return {
    netProfitPerTrade: round(netProfitPerTrade),
    averageWin: round(averageWin),
    averageLoss: round(averageLoss),
    profitFactor: round(profitFactor),
    expectancyPerTrade: round(winRate * averageWin - (1 - winRate) * averageLoss),
    maxDrawdownUsd: round(maxDrawdown(pnls)),
    latencyAdjustedPnlUsd: round(netPnl - latencyPenalty),
    misleadingWinRateWarning: warning
  };
}

function maxDrawdown(pnls: number[]): number {
  let equity = 0;
  let peak = 0;
  let drawdown = 0;
  for (const pnl of pnls) {
    equity += pnl;
    peak = Math.max(peak, equity);
    drawdown = Math.max(drawdown, peak - equity);
  }
  return drawdown;
}

function round(value: number): number {
  if (!Number.isFinite(value)) return value;
  return Math.round(value * 10000) / 10000;
}
