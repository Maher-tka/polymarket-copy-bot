import {
  StrategyDiagnosticRecord,
  SimulatedMakerOrder,
  StrategyEngineState,
  StrategyMetrics,
  StrategyName,
  StrategyOpportunity,
  StrategyPaperTrade,
  StrategyRejection
} from "../types";
import { LocalDatabase } from "../storage/localDatabase";
import { actualEdge, buildLosingDiagnostics, explainLoss, tradePnl } from "../diagnostics/analyzer";

const MAX_ITEMS = 250;
const STRATEGIES: StrategyName[] = [
  "maker-arbitrage",
  "net-arbitrage",
  "market-making",
  "btc-momentum-filter",
  "whale-tracker"
];

export class StrategyStateStore {
  private realTradingUiConfirmed = false;
  private emergencyStopped = false;
  private readonly opportunities: StrategyOpportunity[] = [];
  private readonly paperTrades: StrategyPaperTrade[] = [];
  private readonly rejectedSignals: StrategyRejection[] = [];
  private readonly diagnostics: StrategyDiagnosticRecord[] = [];
  private readonly makerOrders: SimulatedMakerOrder[] = [];

  constructor(
    private readonly database: LocalDatabase,
    private readonly options: {
      realTradingEnabled: boolean;
      recorderEnabled: boolean;
      backtestMode: boolean;
    }
  ) {
    this.hydrateFromDatabase();
  }

  addOpportunity(opportunity: StrategyOpportunity): void {
    this.opportunities.unshift(opportunity);
    this.opportunities.splice(MAX_ITEMS);
    this.database.recordOpportunity(opportunity);
  }

  addPaperTrade(trade: StrategyPaperTrade): void {
    this.paperTrades.unshift(trade);
    this.paperTrades.splice(MAX_ITEMS);
    this.updateDiagnosticForTrade(trade);
    this.database.recordPaperTrade(trade);
  }

  updatePaperTrade(id: string, patch: Partial<StrategyPaperTrade>): void {
    const trade = this.paperTrades.find((item) => item.id === id);
    if (trade) {
      Object.assign(trade, patch);
      this.updateDiagnosticForTrade(trade);
      this.database.recordPaperTradeUpdate(trade);
    }
  }

  addRejection(rejection: StrategyRejection): void {
    this.rejectedSignals.unshift(rejection);
    this.rejectedSignals.splice(MAX_ITEMS);
    this.database.recordRejection(rejection);
  }

  addDiagnostic(record: StrategyDiagnosticRecord): void {
    this.diagnostics.unshift(record);
    this.diagnostics.splice(MAX_ITEMS);
    this.database.recordDiagnostic(record);
  }

  upsertMakerOrder(order: SimulatedMakerOrder): void {
    const index = this.makerOrders.findIndex((item) => item.id === order.id);
    if (index >= 0) {
      this.makerOrders[index] = order;
    } else {
      this.makerOrders.unshift(order);
      this.makerOrders.splice(MAX_ITEMS);
    }
  }

  setEmergencyStopped(stopped: boolean): void {
    this.emergencyStopped = stopped;
  }

  setRealTradingUiConfirmed(confirmed: boolean): void {
    this.realTradingUiConfirmed = confirmed;
  }

  getState(): StrategyEngineState {
    const recorder = this.database.getRecorderStatus();
    return {
      activeMode: this.options.realTradingEnabled && this.realTradingUiConfirmed ? "Real" : "Paper",
      realTradingEnabled: this.options.realTradingEnabled,
      realTradingUiConfirmed: this.realTradingUiConfirmed,
      emergencyStopped: this.emergencyStopped,
      activeStrategies: STRATEGIES,
      opportunities: [...this.opportunities],
      paperTrades: [...this.paperTrades],
      rejectedSignals: [...this.rejectedSignals],
      diagnostics: [...this.diagnostics],
      losingDiagnostics: buildLosingDiagnostics({
        diagnostics: this.diagnostics,
        trades: this.paperTrades,
        rejections: this.rejectedSignals
      }),
      makerOrders: [...this.makerOrders],
      metrics: STRATEGIES.map((strategy) => calculateMetrics(strategy, this.paperTrades, this.rejectedSignals, this.makerOrders)),
      marketEvents: [],
      recorder: {
        enabled: this.options.recorderEnabled,
        snapshotsRecorded: recorder.snapshotsRecorded,
        lastSnapshotAt: recorder.lastSnapshotAt,
        path: recorder.path
      },
      backtest: {
        enabled: this.options.backtestMode,
        availableSnapshots: recorder.snapshotsRecorded
      }
    };
  }

  private updateDiagnosticForTrade(trade: StrategyPaperTrade): void {
    const diagnostic = this.diagnostics.find((item) => item.opportunityId === trade.opportunityId || item.tradeId === trade.id);
    if (!diagnostic) return;

    diagnostic.tradeId = trade.id;
    diagnostic.finalPnlUsd = tradePnl(trade);
    diagnostic.grossPnlUsd = trade.grossPnlUsd;
    diagnostic.feesUsd = trade.feesUsd;
    diagnostic.slippageUsd = trade.slippageUsd;
    diagnostic.fillRate = trade.fillRate;
    diagnostic.partialFill = trade.fillRate > 0 && trade.fillRate < 1;
    diagnostic.failedFill = trade.fillRate <= 0;
    diagnostic.failedHedge = trade.failedHedge;
    diagnostic.lossCause = trade.lossCause;
    diagnostic.reasonForLoss = trade.lossReason ?? (tradePnl(trade) < 0 ? explainLoss(trade) : undefined);
    diagnostic.simulatedExitValue = trade.exitValueUsd;
    this.database.recordDiagnostic(diagnostic);
  }

  private hydrateFromDatabase(): void {
    this.opportunities.push(...this.database.readRecentRecords<StrategyOpportunity>("opportunity", MAX_ITEMS));
    this.paperTrades.push(...this.database.readRecentRecords<StrategyPaperTrade>("paperTrade", MAX_ITEMS));
    this.rejectedSignals.push(...this.database.readRecentRecords<StrategyRejection>("rejection", MAX_ITEMS));
    this.diagnostics.push(...this.database.readRecentRecords<StrategyDiagnosticRecord>("diagnostic", MAX_ITEMS));
  }
}

function calculateMetrics(
  strategy: StrategyName,
  allTrades: StrategyPaperTrade[],
  allRejections: StrategyRejection[],
  allOrders: SimulatedMakerOrder[]
): StrategyMetrics {
  const trades = allTrades.filter((trade) => trade.strategy === strategy);
  const rejections = allRejections.filter((rejection) => rejection.strategy === strategy);
  const orders = allOrders.filter((order) => order.strategy === strategy);
  const completed = trades.filter((trade) => trade.closedAt || trade.realizedPnlUsd !== 0);
  const wins = completed.filter((trade) => trade.realizedPnlUsd + trade.unrealizedPnlUsd > 0).length;
  const acceptedCount = trades.length;
  const pnlValues = trades.map((trade) => trade.realizedPnlUsd + trade.unrealizedPnlUsd);
  const winPnl = pnlValues.filter((pnl) => pnl > 0);
  const lossPnl = pnlValues.filter((pnl) => pnl < 0);
  const grossProfit = winPnl.reduce((total, pnl) => total + pnl, 0);
  const grossLoss = Math.abs(lossPnl.reduce((total, pnl) => total + pnl, 0));
  const totalPnl = pnlValues.reduce((total, pnl) => total + pnl, 0);
  const netProfitPerTrade = trades.length > 0 ? totalPnl / trades.length : 0;
  const winRate = completed.length > 0 ? wins / completed.length : 0;
  const averageWin = winPnl.length > 0 ? grossProfit / winPnl.length : 0;
  const averageLoss = lossPnl.length > 0 ? grossLoss / lossPnl.length : 0;
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Number.POSITIVE_INFINITY : 0;
  const expectancyPerTrade = winRate * averageWin - (1 - winRate) * averageLoss;
  const feesSlippage = trades.reduce((total, trade) => total + trade.feesUsd + trade.slippageUsd, 0);
  const fillRate = average(trades.map((trade) => trade.fillRate));
  const failedFillCount = trades.filter((trade) => trade.fillRate < 1).length;
  const makerFilled = orders.filter((order) => order.status === "filled" || order.status === "hedged").length;
  const missed =
    trades.filter((trade) => trade.status === "missed").length +
    orders.filter((order) => order.status === "cancelled" || order.missedFill).length;

  return {
    strategy,
    simulatedPnlUsd: round(totalPnl),
    winRate: round(winRate),
    maxDrawdownUsd: round(maxDrawdown(trades)),
    fillRate: round(fillRate),
    averageEdge: round(average(trades.map((trade) => trade.edge))),
    averageActualEdge: round(average(trades.map((trade) => trade.actualEdge ?? actualEdge(trade)))),
    netProfitPerTrade: round(netProfitPerTrade),
    averageWin: round(averageWin),
    averageLoss: round(averageLoss),
    profitFactor: round(profitFactor),
    expectancyPerTrade: round(expectancyPerTrade),
    realizedPnlUsd: round(trades.reduce((total, trade) => total + trade.realizedPnlUsd, 0)),
    unrealizedPnlUsd: round(trades.reduce((total, trade) => total + trade.unrealizedPnlUsd, 0)),
    feesSlippageAdjustedPnlUsd: round(totalPnl - feesSlippage),
    latencyAdjustedPnlUsd: round(totalPnl),
    latencyAverageMs: 0,
    latencyP95Ms: 0,
    misleadingWinRateWarning:
      winRate >= 0.9 && netProfitPerTrade <= 0.01
        ? "High win rate is misleading: net profit per trade is too small."
        : undefined,
    averageSlippage: round(average(trades.map((trade) => trade.slippageUsd))),
    rejectedCount: rejections.length,
    acceptedCount,
    failedFillCount,
    makerFillRate: orders.length > 0 ? round(makerFilled / orders.length) : undefined,
    missedOpportunityRate: acceptedCount + missed > 0 ? round(missed / (acceptedCount + missed)) : undefined,
    spreadPnlUsd:
      strategy === "market-making"
        ? round(trades.reduce((total, trade) => total + Math.max(0, trade.realizedPnlUsd + trade.unrealizedPnlUsd), 0))
        : undefined,
    inventoryPnlUsd:
      strategy === "market-making"
        ? round(trades.reduce((total, trade) => total + Math.min(0, trade.realizedPnlUsd + trade.unrealizedPnlUsd), 0))
        : undefined
  };
}

function maxDrawdown(trades: StrategyPaperTrade[]): number {
  let equity = 0;
  let peak = 0;
  let drawdown = 0;
  for (const trade of [...trades].reverse()) {
    equity += trade.realizedPnlUsd + trade.unrealizedPnlUsd;
    peak = Math.max(peak, equity);
    drawdown = Math.max(drawdown, peak - equity);
  }
  return drawdown;
}

function average(values: number[]): number {
  const finite = values.filter(Number.isFinite);
  return finite.length === 0 ? 0 : finite.reduce((total, value) => total + value, 0) / finite.length;
}

function round(value: number): number {
  return Math.round(value * 10000) / 10000;
}
