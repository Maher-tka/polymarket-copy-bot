export type TradeSide = "BUY" | "SELL";
export type LogLevel = "debug" | "info" | "warn" | "error";

export interface CopySignal {
  id: string;
  traderWallet: string;
  traderName?: string;
  traderScore: number;
  side: TradeSide;
  assetId: string;
  conditionId: string;
  marketSlug?: string;
  marketTitle?: string;
  outcome?: string;
  traderSize: number;
  traderPrice: number;
  traderNotionalUsd: number;
  copyDelaySeconds: number;
  createdAt: string;
  simulated?: boolean;
}

export interface PaperPosition {
  id: string;
  assetId: string;
  conditionId: string;
  side?: TradeSide;
  marketTitle?: string;
  outcome?: string;
  traderCopied?: string;
  sourceSignalId?: string;
  status?: string;
  shares: number;
  avgEntryPrice: number;
  costBasisUsd: number;
  currentPrice: number;
  currentValueUsd: number;
  unrealizedPnlUsd: number;
  openedAt: string;
  updatedAt: string;
}

export interface ClosedPosition {
  id: string;
  assetId: string;
  conditionId: string;
  side?: TradeSide;
  marketTitle?: string;
  outcome?: string;
  traderCopied?: string;
  shares: number;
  entryPrice: number;
  exitPrice: number;
  costBasisUsd: number;
  proceedsUsd: number;
  realizedPnlUsd: number;
  openedAt: string;
  closedAt: string;
  sourceSignalId: string;
}

export interface SkippedTrade {
  id: string;
  signalId?: string;
  timestamp: string;
  reasons: string[];
  signal?: CopySignal;
}

export interface TraderScore {
  wallet: string;
  userName?: string;
  score: number;
  volumeUsd: number;
  realizedPnlUsd: number;
  winRate: number;
  marketsTraded: number;
  maxDrawdownUsd: number;
  notes: string[];
}

export interface LogEvent {
  id: string;
  level: LogLevel;
  message: string;
  timestamp: string;
  meta?: unknown;
}

export interface PortfolioSnapshot {
  balanceUsd: number;
  equityUsd: number;
  startingBalanceUsd: number;
  realizedPnlUsd: number;
  unrealizedPnlUsd: number;
  dailyRealizedPnlUsd: number;
  winRate: number;
  maxDrawdownUsd: number;
  maxDrawdownPct: number;
  openPositions: PaperPosition[];
  closedPositions: ClosedPosition[];
  latestSignals: CopySignal[];
  skippedTrades: SkippedTrade[];
}

export interface BotRuntimeStatus {
  apiConnected: boolean;
  walletWatcherActive: boolean;
  lastPollTime?: string;
  lastNewTradeDetectedAt?: string;
  watchedWalletCount: number;
  marketsLoaded: number;
  marketWebSocketConnected: boolean;
  marketWebSocketSubscribedAssets: number;
  lastMarketWebSocketMessageAt?: string;
  backupPollingConnected: boolean;
  simulateSignalsEnabled: boolean;
  lastSimulatedSignalAt?: string;
  telegramConfigured: boolean;
  webSocketLatencyMs?: number;
}

export interface RiskStatus {
  killSwitchActive: boolean;
  paused: boolean;
  errorCount: number;
  stopAfterErrors: number;
}

export type StrategyName =
  | "maker-arbitrage"
  | "net-arbitrage"
  | "market-making"
  | "btc-momentum-filter"
  | "whale-tracker";
export type StrategyStatus = "accepted" | "rejected" | "filled" | "partial" | "missed" | "cancelled" | "alert";
export type LossCause =
  | "fees"
  | "slippage"
  | "stale-data"
  | "illiquidity"
  | "failed-hedge"
  | "partial-fill"
  | "close-window"
  | "negative-edge";

export interface StrategyOpportunity {
  id: string;
  strategy: StrategyName;
  marketTitle?: string;
  conditionId: string;
  side?: TradeSide;
  rawCost?: number;
  estimatedTakerFees?: number;
  estimatedSlippage?: number;
  netCost?: number;
  edge: number;
  score?: number;
  targetShares?: number;
  targetNotionalUsd?: number;
  depthUsd?: number;
  status: StrategyStatus;
  reason?: string;
  createdAt: string;
  latencyMs?: number;
  marketEndDate?: string;
  secondsToClose?: number;
  projectedLockedProfitUsd?: number;
  failedFillRiskUsd?: number;
}

export interface StrategyRejection {
  id: string;
  strategy: StrategyName;
  marketTitle?: string;
  conditionId?: string;
  reasons: string[];
  edge?: number;
  createdAt: string;
}

export interface StrategyPaperTrade {
  id: string;
  strategy: StrategyName;
  opportunityId?: string;
  marketTitle?: string;
  conditionId: string;
  side: "ARBITRAGE_PAIR" | TradeSide;
  shares: number;
  entryCostUsd: number;
  exitValueUsd?: number;
  grossPnlUsd: number;
  realizedPnlUsd: number;
  unrealizedPnlUsd: number;
  feesUsd: number;
  slippageUsd: number;
  edge: number;
  actualEdge?: number;
  fillRate: number;
  status: StrategyStatus;
  openedAt: string;
  closedAt?: string;
  yesTokenId?: string;
  noTokenId?: string;
  marketEndDate?: string;
  secondsToClose?: number;
  failedHedge?: boolean;
  rejectionReason?: string;
  lossReason?: string;
  lossCause?: LossCause;
  exitReason?: string;
}

export interface StrategyDiagnosticRecord {
  id: string;
  opportunityId?: string;
  tradeId?: string;
  timestamp: string;
  market?: string;
  strategy: StrategyName;
  yesBestBid?: number;
  yesBestAsk?: number;
  noBestBid?: number;
  noBestAsk?: number;
  spread?: number;
  orderBookDepthUsd?: number;
  dataAgeMs?: number;
  rawEdge?: number;
  estimatedFeesUsd?: number;
  estimatedSlippageUsd?: number;
  netEdge?: number;
  accepted: boolean;
  rejectionReasons: string[];
  simulatedEntryPrice?: number;
  simulatedExitValue?: number;
  finalPnlUsd?: number;
  grossPnlUsd?: number;
  feesUsd?: number;
  slippageUsd?: number;
  fillRate?: number;
  partialFill?: boolean;
  failedFill?: boolean;
  failedHedge?: boolean;
  secondsToClose?: number;
  tooCloseToClose?: boolean;
  exitLiquidityPoor?: boolean;
  lossCause?: LossCause;
  missedFill?: boolean;
  reasonForLoss?: string;
  createdAt: string;
}

export interface SimulatedMakerOrder {
  id: string;
  strategy: StrategyName;
  conditionId: string;
  marketTitle?: string;
  tokenId: string;
  side: TradeSide;
  limitPrice: number;
  shares: number;
  filledShares: number;
  status: "open" | "partial" | "filled" | "cancelled" | "hedged";
  createdAt: string;
  expiresAt: string;
  hedgeTokenId?: string;
  hedgeMaxLossUsd?: number;
  marketEndDate?: string;
  postOnly?: boolean;
  projectedLockedProfitUsd?: number;
  failedFillRiskUsd?: number;
  missedFill?: boolean;
  failedHedge?: boolean;
}

export interface StrategyMetrics {
  strategy: StrategyName;
  simulatedPnlUsd: number;
  winRate: number;
  maxDrawdownUsd: number;
  fillRate: number;
  averageEdge: number;
  averageActualEdge: number;
  averageSlippage: number;
  rejectedCount: number;
  acceptedCount: number;
  failedFillCount: number;
  makerFillRate?: number;
  missedOpportunityRate?: number;
  spreadPnlUsd?: number;
  inventoryPnlUsd?: number;
}

export interface LosingDiagnosticsSummary {
  totalSignals: number;
  tradesTaken: number;
  rejectedSignals: number;
  rejectionReasons: Array<{ reason: string; count: number }>;
  winRate: number;
  netPnlUsd: number;
  grossPnlUsd: number;
  totalFeesUsd: number;
  totalSlippageUsd: number;
  estimatedFeesUsd: number;
  estimatedSlippageUsd: number;
  averageSpread: number;
  averageDataDelayMs: number;
  failedFills: number;
  partialFills: number;
  failedHedges: number;
  tradesTooCloseToClose: number;
  lossesCausedByFees: number;
  lossesCausedBySlippage: number;
  lossesCausedByStaleData: number;
  lossesCausedByIlliquidity: number;
  averageRawEdge: number;
  averageNetEdge: number;
  averageEdge: number;
  averageActualEdge: number;
  averageDepthUsd: number;
  worstTrade?: StrategyPaperTrade;
  bestTrade?: StrategyPaperTrade;
  mostProfitableStrategy?: StrategyName;
  leastProfitableStrategy?: StrategyName;
  strategyRanking: Array<{
    strategy: StrategyName;
    label: string;
    trades: number;
    signals: number;
    netPnlUsd: number;
    winRate: number;
    averageNetEdge: number;
    averageActualEdge: number;
    status: "real-locked-positive" | "paper-candidate" | "needs-more-data" | "losing";
  }>;
}

export interface StrategyEngineState {
  activeMode: "Scanner" | "Paper" | "Real";
  realTradingEnabled: boolean;
  realTradingUiConfirmed: boolean;
  emergencyStopped: boolean;
  activeStrategies: StrategyName[];
  opportunities: StrategyOpportunity[];
  paperTrades: StrategyPaperTrade[];
  rejectedSignals: StrategyRejection[];
  diagnostics: StrategyDiagnosticRecord[];
  losingDiagnostics: LosingDiagnosticsSummary;
  makerOrders: SimulatedMakerOrder[];
  metrics: StrategyMetrics[];
  recorder: {
    enabled: boolean;
    snapshotsRecorded: number;
    lastSnapshotAt?: string;
    path: string;
  };
  backtest: {
    enabled: boolean;
    availableSnapshots: number;
    lastRunAt?: string;
  };
}

export interface DashboardState {
  strategyName: string;
  mode: "PAPER" | "LIVE";
  liveTradingEnabledInVersion1: boolean;
  manualApproval: boolean;
  status: BotRuntimeStatus;
  portfolio: PortfolioSnapshot;
  watchedTraders: TraderScore[];
  risk: RiskStatus;
  strategies?: StrategyEngineState;
  logs: LogEvent[];
  safeConfig: {
    paperTradingOnly: boolean;
    maxTradeUsd: number;
    maxTradeSizeUsd: number;
    maxMarketExposureUsd: number;
    maxDailyLossUsd: number;
    maxOpenPositions: number;
    minTraderScore: number;
    maxSpread: number;
    simulateSignals: boolean;
    simulateSignalIntervalSeconds: number;
    realTradingEnabled: boolean;
    realTradingRequiresUiConfirmation: boolean;
    bankrollRiskPct: number;
    maxDailyLossPct: number;
    maxDeployedCapitalPct: number;
    maxPositionSizePct: number;
    maxOneMarketExposureUsd: number;
    maxStrategyOpenPositions: number;
    maxSlippage: number;
    maxStaleDataMs: number;
    maxDataAgeMs: number;
    finalEntryBufferSeconds: number;
    forcedRiskCheckSeconds: number;
    minNetArbEdge: number;
    minNetEdge: number;
    minOrderBookDepthUsd: number;
    minDepthMultiplier: number;
    requireBothLegsFillable: boolean;
    rejectPartialFills: boolean;
    stopAfterConsecutiveLosses: number;
    takerFeeRate: number;
    cryptoTakerFeeRate: number;
    makerFeeRate: number;
    marketMakingMinEdge: number;
    marketMakingMaxDataAgeMs: number;
    strategyLabAllMarkets: boolean;
  };
}

export interface EquityPoint {
  time: string;
  equity: number;
  realized: number;
  unrealized: number;
}
