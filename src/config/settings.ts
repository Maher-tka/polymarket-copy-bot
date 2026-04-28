import dotenv from "dotenv";
import { BotConfig, BotMode } from "../types";

dotenv.config();

const MODES: BotMode[] = ["research", "backtest", "paper", "live"];

type EnvSource = NodeJS.ProcessEnv | Record<string, string | undefined>;

function readBool(env: EnvSource, name: string, fallback: boolean): boolean {
  const value = env[name];
  if (value === undefined || value.trim() === "") return fallback;
  return ["true", "1", "yes", "y"].includes(value.toLowerCase());
}

function readNumber(env: EnvSource, name: string, fallback: number): number {
  const value = env[name];
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid number for ${name}: ${value}`);
  }
  return parsed;
}

function readString(env: EnvSource, name: string, fallback: string): string {
  return env[name]?.trim() || fallback;
}

function readOptionalString(env: EnvSource, name: string): string | undefined {
  const value = env[name]?.trim();
  return value || undefined;
}

function readCsv(env: EnvSource, name: string): string[] {
  return (env[name] || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function readMode(env: EnvSource): BotMode {
  const value = readString(env, "MODE", "paper").toLowerCase();
  if (!MODES.includes(value as BotMode)) {
    throw new Error(`Invalid MODE=${value}. Expected one of: ${MODES.join(", ")}.`);
  }
  return value as BotMode;
}

export function loadConfigFromEnv(env: EnvSource = process.env): BotConfig {
  const mode = readMode(env);
  const enableLiveTrading = readBool(env, "ENABLE_LIVE_TRADING", false);
  const paperTradingOnly = mode === "paper" ? readBool(env, "PAPER_TRADING_ONLY", true) : false;
  const paperTrading = mode === "paper" ? true : false;
  const liveTrading = mode === "live" && enableLiveTrading && readBool(env, "LIVE_TRADING", true);
  const realTradingEnabled =
    mode === "live" && enableLiveTrading && readBool(env, "REAL_TRADING_ENABLED", false);

  if (mode === "live") {
    if (!enableLiveTrading || !realTradingEnabled || !liveTrading) {
      throw new Error(
        "Live mode is locked. MODE=live requires ENABLE_LIVE_TRADING=true, REAL_TRADING_ENABLED=true, and LIVE_TRADING=true."
      );
    }
  }

  if (mode === "paper" && (liveTrading || realTradingEnabled || !paperTrading || !paperTradingOnly)) {
    throw new Error("Unsafe config: paper mode requires PAPER_TRADING_ONLY=true and all live trading flags false.");
  }

  const maxTradeSizeUsdc = readNumber(env, "MAX_TRADE_SIZE_USDC", readNumber(env, "MAX_TRADE_SIZE_USD", readNumber(env, "MAX_TRADE_USD", 5)));
  const maxDailyLossUsdc = readNumber(env, "MAX_DAILY_LOSS_USDC", readNumber(env, "MAX_DAILY_LOSS_USD", 8));

  return {
    mode,
    paperTradingOnly,
    paperTrading,
    liveTrading,
    enableLiveTrading,
    manualApproval: readBool(env, "MANUAL_APPROVAL", true),
    startingPaperBalance: readNumber(env, "STARTING_PAPER_BALANCE", 100),
    maxTradeUsd: readNumber(env, "MAX_TRADE_USD", maxTradeSizeUsdc),
    maxTradeSizeUsd: readNumber(env, "MAX_TRADE_SIZE_USD", maxTradeSizeUsdc),
    maxTradeSizeUsdc,
    maxMarketExposureUsd: readNumber(env, "MAX_MARKET_EXPOSURE_USD", 5),
    maxMarketAllocationPct: readNumber(env, "MAX_MARKET_ALLOCATION_PCT", 0.05),
    maxTraderAllocationPct: readNumber(env, "MAX_TRADER_ALLOCATION_PCT", 0.08),
    maxTotalExposurePct: readNumber(env, "MAX_TOTAL_EXPOSURE_PCT", readNumber(env, "MAX_DEPLOYED_CAPITAL_PCT", 0.25)),
    maxDailyLossUsd: readNumber(env, "MAX_DAILY_LOSS_USD", maxDailyLossUsdc),
    maxDailyLossUsdc,
    maxOpenPositions: readNumber(env, "MAX_OPEN_POSITIONS", 2),
    minTraderScore: readNumber(env, "MIN_TRADER_SCORE", 75),
    minMarketVolumeUsd: readNumber(env, "MIN_MARKET_VOLUME_USD", 10000),
    maxSpread: readNumber(env, "MAX_SPREAD", 0.015),
    maxEntryPrice: readNumber(env, "MAX_ENTRY_PRICE", 0.85),
    minEntryPrice: readNumber(env, "MIN_ENTRY_PRICE", 0.1),
    maxCopyPriceDifference: readNumber(env, "MAX_COPY_PRICE_DIFFERENCE", 0.03),
    copyDelayLimitSeconds: readNumber(env, "COPY_DELAY_LIMIT_SECONDS", 30),
    stopAfterErrors: readNumber(env, "STOP_AFTER_ERRORS", 3),
    killSwitchDrawdownPercent: readNumber(env, "KILL_SWITCH_DRAWDOWN_PERCENT", 5),
    orderStaleSeconds: readNumber(env, "ORDER_STALE_SECONDS", 1),
    defaultLatencyMs: readNumber(env, "DEFAULT_LATENCY_MS", 300),
    autoRedeemEnabled: readBool(env, "AUTO_REDEEM_ENABLED", false),
    autoRedeemDryRun: readBool(env, "AUTO_REDEEM_DRY_RUN", true),
    autoRedeemIntervalSeconds: readNumber(env, "AUTO_REDEEM_INTERVAL_SECONDS", 300),
    clobHost: readString(env, "POLYMARKET_CLOB_HOST", "https://clob.polymarket.com"),
    dataApi: readString(env, "POLYMARKET_DATA_API", "https://data-api.polymarket.com"),
    gammaApi: readString(env, "POLYMARKET_GAMMA_API", "https://gamma-api.polymarket.com"),
    dashboardPort: readNumber(env, "DASHBOARD_PORT", 3000),
    dashboardHost: readString(env, "DASHBOARD_HOST", "127.0.0.1"),
    quoteDaemonEnabled: readBool(env, "QUOTE_DAEMON_ENABLED", true),
    quoteDaemonPort: readNumber(env, "QUOTE_DAEMON_PORT", 3001),
    maxQuoteDelayMs: readNumber(env, "MAX_QUOTE_DELAY_MS", 1000),
    quoteFreshnessMs: readNumber(env, "QUOTE_FRESHNESS_MS", 1000),
    watchedWallets: readCsv(env, "WATCHED_WALLETS"),
    maxWatchedTraders: readNumber(env, "MAX_WATCHED_TRADERS", 5),
    leaderboardLimit: readNumber(env, "LEADERBOARD_LIMIT", 20),
    traderPollIntervalSeconds: readNumber(env, "TRADER_POLL_INTERVAL_SECONDS", 10),
    traderRefreshIntervalSeconds: readNumber(env, "TRADER_REFRESH_INTERVAL_SECONDS", 300),
    traderScoreDecayAfterMinutes: readNumber(env, "TRADER_SCORE_DECAY_AFTER_MINUTES", 30),
    traderScoreDecayPerHour: readNumber(env, "TRADER_SCORE_DECAY_PER_HOUR", 5),
    positionMarkIntervalSeconds: readNumber(env, "POSITION_MARK_INTERVAL_SECONDS", 10),
    enableMarketWebSocket: readBool(env, "ENABLE_MARKET_WEBSOCKET", true),
    replayRecentTradesOnStart: readBool(env, "REPLAY_RECENT_TRADES_ON_START", false),
    simulateSignals: readBool(env, "SIMULATE_SIGNALS", false),
    simulateSignalIntervalSeconds: readNumber(env, "SIMULATE_SIGNAL_INTERVAL_SECONDS", 10),
    realTradingEnabled,
    realTradingRequiresUiConfirmation: readBool(env, "REAL_TRADING_REQUIRES_UI_CONFIRMATION", true),
    bankrollRiskPct: readNumber(env, "BANKROLL_RISK_PCT", 0.01),
    maxDailyLossPct: readNumber(env, "MAX_DAILY_LOSS_PCT", readNumber(env, "MAX_DAILY_LOSS_PERCENT", 2) / 100),
    maxDeployedCapitalPct: readNumber(env, "MAX_DEPLOYED_CAPITAL_PCT", 0.25),
    maxPositionSizePct: readNumber(env, "MAX_POSITION_SIZE_PCT", 0.01),
    maxOneMarketExposureUsd: readNumber(env, "MAX_ONE_MARKET_EXPOSURE_USD", 5),
    maxStrategyOpenPositions: readNumber(env, "MAX_STRATEGY_OPEN_POSITIONS", 10),
    maxSlippage: readNumber(env, "MAX_SLIPPAGE", 0.003),
    maxStaleDataMs: readNumber(env, "MAX_STALE_DATA_MS", readNumber(env, "MAX_DATA_AGE_MS", 300)),
    maxDataAgeMs: readNumber(env, "MAX_DATA_AGE_MS", readNumber(env, "MAX_STALE_DATA_MS", 300)),
    maxTotalLatencyMs: readNumber(env, "MAX_TOTAL_LATENCY_MS", 1000),
    latencyPenaltyBpsPerSecond: readNumber(env, "LATENCY_PENALTY_BPS_PER_SECOND", 5),
    minRealEdge: readNumber(env, "MIN_REAL_EDGE", readNumber(env, "MIN_NET_EDGE", 0.025)),
    minSignalScore: readNumber(env, "MIN_SIGNAL_SCORE", 70),
    highRiskConfirmationCount: readNumber(env, "HIGH_RISK_CONFIRMATION_COUNT", 2),
    maxSignalsPerMinute: readNumber(env, "MAX_SIGNALS_PER_MINUTE", 30),
    maxTradesPerMinute: readNumber(env, "MAX_TRADES_PER_MINUTE", 6),
    maxActiveMarkets: readNumber(env, "MAX_ACTIVE_MARKETS", 12),
    lossCooldownSeconds: readNumber(env, "LOSS_COOLDOWN_SECONDS", 120),
    minCopyTradeUsd: readNumber(env, "MIN_COPY_TRADE_USD", 5),
    minRewardRiskRatio: readNumber(env, "MIN_REWARD_RISK_RATIO", 0.15),
    misleadingWinRateMinWinRate: readNumber(env, "MISLEADING_WIN_RATE_MIN_WIN_RATE", 0.9),
    misleadingWinRateMaxProfitPerTrade: readNumber(env, "MISLEADING_WIN_RATE_MAX_PROFIT_PER_TRADE", 0.01),
    finalEntryBufferSeconds: readNumber(env, "FINAL_ENTRY_BUFFER_SECONDS", 45),
    forcedRiskCheckSeconds: readNumber(env, "FORCED_RISK_CHECK_SECONDS", 60),
    stopAfterFailedFills: readNumber(env, "STOP_AFTER_FAILED_FILLS", 3),
    stopAfterConsecutiveLosses: readNumber(env, "STOP_AFTER_CONSECUTIVE_LOSSES", 3),
    minNetArbEdge: readNumber(env, "MIN_NET_ARB_EDGE", readNumber(env, "MIN_NET_EDGE", 0.025)),
    minNetEdge: readNumber(env, "MIN_NET_EDGE", readNumber(env, "MIN_NET_ARB_EDGE", 0.025)),
    minOrderBookDepthUsd: readNumber(env, "MIN_ORDER_BOOK_DEPTH_USD", 25),
    minDepthMultiplier: readNumber(env, "MIN_DEPTH_MULTIPLIER", 5),
    requireBothLegsFillable: readBool(env, "REQUIRE_BOTH_LEGS_FILLABLE", true),
    rejectPartialFills: readBool(env, "REJECT_PARTIAL_FILLS", true),
    arbitrageScanIntervalSeconds: readNumber(env, "ARBITRAGE_SCAN_INTERVAL_SECONDS", 3),
    arbitrageTargetShares: readNumber(env, "ARBITRAGE_TARGET_SHARES", 5),
    makerOrderTimeoutMs: readNumber(env, "MAKER_ORDER_TIMEOUT_MS", 1000),
    marketMakingIntervalSeconds: readNumber(env, "MARKET_MAKING_INTERVAL_SECONDS", 3),
    marketMakingMinEdge: readNumber(env, "MARKET_MAKING_MIN_EDGE", 0.0005),
    marketMakingMaxDataAgeMs: readNumber(env, "MARKET_MAKING_MAX_DATA_AGE_MS", 5_000),
    marketMakingMaxQueueDepthMultiplier: readNumber(env, "MARKET_MAKING_MAX_QUEUE_DEPTH_MULTIPLIER", 3),
    marketMakingAdverseSelectionBps: readNumber(env, "MARKET_MAKING_ADVERSE_SELECTION_BPS", 25),
    strategyLabAllMarkets: readBool(env, "STRATEGY_LAB_ALL_MARKETS", true),
    paperLearningEnabled: readBool(env, "PAPER_LEARNING_ENABLED", true),
    paperLearningAutoApply: readBool(env, "PAPER_LEARNING_AUTO_APPLY", true),
    paperLearningMinSignals: readNumber(env, "PAPER_LEARNING_MIN_SIGNALS", 250),
    paperLearningMinTrades: readNumber(env, "PAPER_LEARNING_MIN_TRADES", 30),
    whalePollIntervalSeconds: readNumber(env, "WHALE_POLL_INTERVAL_SECONDS", 5),
    whaleMinTradeUsd: readNumber(env, "WHALE_MIN_TRADE_USD", 1000),
    takerFeeRate: readNumber(env, "TAKER_FEE_RATE", 0.05),
    cryptoTakerFeeRate: readNumber(env, "CRYPTO_TAKER_FEE_RATE", 0.072),
    makerFeeRate: readNumber(env, "MAKER_FEE_RATE", 0),
    makerFailedFillRiskBps: readNumber(env, "MAKER_FAILED_FILL_RISK_BPS", 30),
    recorderEnabled: readBool(env, "RECORDER_ENABLED", true),
    backtestMode: mode === "backtest" || readBool(env, "BACKTEST_MODE", false),
    paperAutoSettleSeconds: readNumber(env, "PAPER_AUTO_SETTLE_SECONDS", 60),
    telegramBotToken: readOptionalString(env, "TELEGRAM_BOT_TOKEN"),
    telegramChatId: readOptionalString(env, "TELEGRAM_CHAT_ID"),
    polymarketPrivateKey: readOptionalString(env, "POLYMARKET_PRIVATE_KEY"),
    polymarketApiKey: readOptionalString(env, "POLYMARKET_API_KEY"),
    polymarketApiSecret: readOptionalString(env, "POLYMARKET_API_SECRET") ?? readOptionalString(env, "POLYMARKET_SECRET"),
    polymarketApiPassphrase: readOptionalString(env, "POLYMARKET_API_PASSPHRASE"),
    polymarketSecret: readOptionalString(env, "POLYMARKET_SECRET"),
    polymarketFunder: readOptionalString(env, "POLYMARKET_FUNDER"),
    marketlensApiKey: readOptionalString(env, "MARKETLENS_API_KEY")
  };
}

export function loadConfig(): BotConfig {
  return loadConfigFromEnv(process.env);
}
