import { buildLosingDiagnostics, tradePnl } from "./analyzer";
import { LocalDatabase } from "../storage/localDatabase";
import { StrategyDiagnosticRecord, StrategyPaperTrade, StrategyRejection } from "../types";

const db = new LocalDatabase();
const diagnostics = db.readRecords<StrategyDiagnosticRecord>("diagnostic");
const trades = db.readRecords<StrategyPaperTrade>("paperTrade");
const rejections = db.readRecords<StrategyRejection>("rejection");
const summary = buildLosingDiagnostics({ diagnostics, trades, rejections });

const rejectedByReason = summary.rejectionReasons.map((item) => `  - ${item.reason}: ${item.count}`).join("\n") || "  - none";
const byStrategy = new Map<string, number>();
for (const trade of trades) {
  byStrategy.set(trade.strategy, (byStrategy.get(trade.strategy) ?? 0) + tradePnl(trade));
}
const sortedStrategies = [...byStrategy.entries()].sort((a, b) => b[1] - a[1]);
const losingTrades = [...trades]
  .sort((a, b) => tradePnl(a) - tradePnl(b))
  .slice(0, 10)
  .map(
    (trade, index) =>
      `  ${index + 1}. ${trade.strategy} | ${money(tradePnl(trade))} | edge=${pct(trade.edge)} | actual=${pct(trade.actualEdge ?? 0)} | ${trade.lossReason ?? "No loss reason recorded"} | ${trade.marketTitle ?? trade.conditionId}`
  )
  .join("\n");
const correctlySkipped = diagnostics
  .filter((item) => !item.accepted)
  .filter((item) => (item.netEdge ?? 0) < 0 || item.partialFill || item.failedFill || (item.dataAgeMs ?? 0) > 500)
  .sort((a, b) => (a.netEdge ?? 0) - (b.netEdge ?? 0))
  .slice(0, 10)
  .map(
    (item, index) =>
      `  ${index + 1}. ${item.strategy} | netEdge=${pct(item.netEdge ?? 0)} | age=${Math.round(item.dataAgeMs ?? 0)}ms | ${item.rejectionReasons[0] ?? "Rejected"} | ${item.market ?? "Unknown market"}`
  )
  .join("\n");

console.log(`Polymarket Bot Diagnostic Report
================================
total signals: ${summary.totalSignals}
trades taken: ${summary.tradesTaken}
rejected signals: ${summary.rejectedSignals}
rejected by reason:
${rejectedByReason}
win rate: ${pct(summary.winRate)}
net PnL: ${money(summary.netPnlUsd)}
gross PnL: ${money(summary.grossPnlUsd)}
fees: ${money(summary.totalFeesUsd)}
slippage: ${money(summary.totalSlippageUsd)}
estimated quote fees: ${money(summary.estimatedFeesUsd)}
estimated quote slippage: ${money(summary.estimatedSlippageUsd)}
average edge: ${pct(summary.averageEdge)}
average raw edge: ${pct(summary.averageRawEdge)}
average net edge: ${pct(summary.averageNetEdge)}
average actual edge: ${pct(summary.averageActualEdge)}
failed fills: ${summary.failedFills}
partial fills: ${summary.partialFills}
failed hedges: ${summary.failedHedges}
too close to close: ${summary.tradesTooCloseToClose}
losses caused by fees: ${summary.lossesCausedByFees}
losses caused by slippage: ${summary.lossesCausedBySlippage}
losses caused by stale data: ${summary.lossesCausedByStaleData}
losses caused by illiquidity: ${summary.lossesCausedByIlliquidity}
average data age: ${Math.round(summary.averageDataDelayMs)}ms
average depth: ${money(summary.averageDepthUsd)}
best strategy: ${sortedStrategies[0] ? `${sortedStrategies[0][0]} (${money(sortedStrategies[0][1])})` : "not enough data"}
worst strategy: ${sortedStrategies.at(-1) ? `${sortedStrategies.at(-1)?.[0]} (${money(sortedStrategies.at(-1)?.[1] ?? 0)})` : "not enough data"}

strategy ranking:
${summary.strategyRanking.map((item, index) => `  ${index + 1}. ${item.label} | ${money(item.netPnlUsd)} | trades=${item.trades} | signals=${item.signals} | ${item.status}`).join("\n")}

top 10 losing trades with reason:
${losingTrades || "  - none"}

top 10 rejected signals that were correctly skipped:
${correctlySkipped || "  - none"}
`);

function money(value: number): string {
  return `$${value.toFixed(4)}`;
}

function pct(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}
