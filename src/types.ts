export type TradeSide = "BUY" | "SELL";
export type TradingMode = "PAPER" | "LIVE";
export type LogLevel = "debug" | "info" | "warn" | "error";
export type BotMode = "research" | "backtest" | "paper" | "live";
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

export interface BotConfig {
  mode: BotMode;
  paperTradingOnly: boolean;
  paperTrading: boolean;
  liveTrading: boolean;
  enableLiveTrading: boolean;
  manualApproval: boolean;
  startingPaperBalance: number;
  maxTradeUsd: number;
  maxTradeSizeUsd: number;
  maxTradeSizeUsdc: number;
  maxMarketExposureUsd: number;
  maxDailyLossUsd: number;
  maxDailyLossUsdc: number;
  maxOpenPositions: number;
  minTraderScore: number;
  minMarketVolumeUsd: number;
  maxSpread: number;
  maxEntryPrice: number;
  minEntryPrice: number;
  maxCopyPriceDifference: number;
  copyDelayLimitSeconds: number;
  stopAfterErrors: number;
  killSwitchDrawdownPercent: number;
  orderStaleSeconds: number;
  defaultLatencyMs: number;
  autoRedeemEnabled: boolean;
  autoRedeemDryRun: boolean;
  autoRedeemIntervalSeconds: number;
  clobHost: string;
  dataApi: string;
  gammaApi: string;
  dashboardPort: number;
  watchedWallets: string[];
  maxWatchedTraders: number;
  leaderboardLimit: number;
  traderPollIntervalSeconds: number;
  positionMarkIntervalSeconds: number;
  enableMarketWebSocket: boolean;
  replayRecentTradesOnStart: boolean;
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
  stopAfterFailedFills: number;
  stopAfterConsecutiveLosses: number;
  minNetArbEdge: number;
  minNetEdge: number;
  minOrderBookDepthUsd: number;
  minDepthMultiplier: number;
  requireBothLegsFillable: boolean;
  rejectPartialFills: boolean;
  arbitrageScanIntervalSeconds: number;
  arbitrageTargetShares: number;
  makerOrderTimeoutMs: number;
  marketMakingIntervalSeconds: number;
  marketMakingMinEdge: number;
  marketMakingMaxDataAgeMs: number;
  marketMakingMaxQueueDepthMultiplier: number;
  marketMakingAdverseSelectionBps: number;
  strategyLabAllMarkets: boolean;
  paperLearningEnabled: boolean;
  paperLearningAutoApply: boolean;
  paperLearningMinSignals: number;
  paperLearningMinTrades: number;
  whalePollIntervalSeconds: number;
  whaleMinTradeUsd: number;
  takerFeeRate: number;
  cryptoTakerFeeRate: number;
  makerFeeRate: number;
  makerFailedFillRiskBps: number;
  recorderEnabled: boolean;
  backtestMode: boolean;
  paperAutoSettleSeconds: number;
  telegramBotToken?: string;
  telegramChatId?: string;
  polymarketPrivateKey?: string;
  polymarketApiKey?: string;
  polymarketApiSecret?: string;
  polymarketApiPassphrase?: string;
  polymarketSecret?: string;
  polymarketFunder?: string;
  marketlensApiKey?: string;
}

export interface LeaderboardTrader {
  rank: string;
  proxyWallet: string;
  userName?: string;
  vol: number;
  pnl: number;
  profileImage?: string;
  xUsername?: string;
  verifiedBadge?: boolean;
}

export interface DataApiTrade {
  proxyWallet: string;
  side: TradeSide;
  asset: string;
  conditionId: string;
  size: number;
  price: number;
  timestamp: number;
  title?: string;
  slug?: string;
  icon?: string;
  eventSlug?: string;
  outcome?: string;
  outcomeIndex?: number;
  name?: string;
  pseudonym?: string;
  transactionHash?: string;
}

export interface DataApiPosition {
  proxyWallet: string;
  asset: string;
  conditionId: string;
  size: number;
  avgPrice: number;
  initialValue: number;
  currentValue: number;
  cashPnl: number;
  percentPnl: number;
  totalBought: number;
  realizedPnl: number;
  curPrice: number;
  title?: string;
  slug?: string;
  outcome?: string;
  outcomeIndex?: number;
  oppositeOutcome?: string;
  oppositeAsset?: string;
  endDate?: string;
}

export interface DataApiClosedPosition {
  proxyWallet: string;
  asset: string;
  conditionId: string;
  avgPrice: number;
  totalBought: number;
  realizedPnl: number;
  curPrice: number;
  timestamp: number;
  title?: string;
  slug?: string;
  outcome?: string;
  outcomeIndex?: number;
  oppositeOutcome?: string;
  oppositeAsset?: string;
  endDate?: string;
}

export interface GammaMarket {
  id?: string;
  question?: string;
  conditionId?: string;
  slug?: string;
  volume?: string;
  volumeNum?: number;
  liquidity?: string;
  liquidityNum?: number;
  volume24hr?: number;
  active?: boolean;
  closed?: boolean;
  archived?: boolean;
  enableOrderBook?: boolean;
  clobTokenIds?: string;
  outcomes?: string;
  outcomePrices?: string;
  bestBid?: number;
  bestAsk?: number;
  lastTradePrice?: number;
  spread?: number;
  endDate?: string;
  endDateIso?: string;
  endDateTime?: string;
  gameStartTime?: string;
}

export interface OrderBookLevel {
  price: string;
  size: string;
}

export interface OrderBook {
  market: string;
  asset_id: string;
  timestamp: string;
  hash: string;
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  min_order_size: string;
  tick_size: string;
  neg_risk: boolean;
  last_trade_price?: string;
}

export interface MarketSnapshot {
  assetId: string;
  conditionId?: string;
  market?: GammaMarket;
  orderBook?: OrderBook;
  spread: number;
  bestBid?: number;
  bestAsk?: number;
  currentEntryPrice?: number;
  volumeUsd: number;
  liquidityUsd: number;
  availableLiquidityUsd: number;
}

export interface TraderScore {
  wallet: string;
  userName?: string;
  score: number;
  rank?: string;
  volumeUsd: number;
  realizedPnlUsd: number;
  winRate: number;
  marketsTraded: number;
  maxDrawdownUsd: number;
  breakdown: {
    realizedPnl: number;
    winRate: number;
    volume: number;
    recentPerformance: number;
    consistency: number;
    lowDrawdown: number;
    penalties: number;
  };
  notes: string[];
}

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
  outcomeIndex?: number;
  traderSize: number;
  traderPrice: number;
  traderNotionalUsd: number;
  traderTradeTimestamp: number;
  copyDelaySeconds: number;
  createdAt: string;
  sourceTradeId: string;
  simulated?: boolean;
  simulationNote?: string;
}

export interface FilterDecision {
  accepted: boolean;
  reasons: string[];
  currentEntryPrice?: number;
  availableLiquidityUsd?: number;
}

export interface RiskDecision {
  accepted: boolean;
  reasons: string[];
}

export interface PositionSizeDecision {
  accepted: boolean;
  reasons: string[];
  tradeUsd: number;
  shares: number;
}

export interface PaperPosition {
  id: string;
  assetId: string;
  conditionId: string;
  side?: TradeSide;
  marketTitle?: string;
  marketSlug?: string;
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

export interface PortfolioSnapshot {
  mode: TradingMode;
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

export interface LogEvent {
  id: string;
  level: LogLevel;
  message: string;
  timestamp: string;
  meta?: unknown;
}

export interface TradeExecutionResult {
  success: boolean;
  skipped?: SkippedTrade;
  position?: PaperPosition;
  closedPosition?: ClosedPosition;
}

export interface FillSimulation {
  requestedShares: number;
  filledShares: number;
  fillRate: number;
  averagePrice: number;
  topOfBookPrice?: number;
  notionalUsd: number;
  slippageUsd: number;
  slippagePct: number;
  feeUsd: number;
  partial: boolean;
  depthUsd: number;
}

export interface BinaryMarketCandidate {
  conditionId: string;
  slug?: string;
  title?: string;
  volumeUsd: number;
  liquidityUsd: number;
  yesTokenId: string;
  noTokenId: string;
  yesOutcome: string;
  noOutcome: string;
  endDate?: string;
}

export interface StrategyOpportunity {
  id: string;
  strategy: StrategyName;
  marketTitle?: string;
  marketSlug?: string;
  conditionId: string;
  yesTokenId?: string;
  noTokenId?: string;
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
  expiresAt?: string;
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

export interface PaperLearningAdjustment {
  setting: string;
  from: number | string | boolean;
  to: number | string | boolean;
  reason: string;
}

export interface PaperLearningState {
  enabled: boolean;
  autoApply: boolean;
  focusedStrategy?: StrategyName;
  disabledStrategies: StrategyName[];
  lastUpdatedAt?: string;
  sampleSignals: number;
  sampleTrades: number;
  recommendations: string[];
  appliedAdjustments: PaperLearningAdjustment[];
  notes: string[];
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
  learning?: PaperLearningState;
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
