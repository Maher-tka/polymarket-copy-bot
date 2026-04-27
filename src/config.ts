import dotenv from "dotenv";
import { BotConfig } from "./types";

dotenv.config();

function readBool(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") return fallback;
  return ["true", "1", "yes", "y"].includes(value.toLowerCase());
}

function readNumber(name: string, fallback: number): number {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid number for ${name}: ${value}`);
  }
  return parsed;
}

function readString(name: string, fallback: string): string {
  return process.env[name]?.trim() || fallback;
}

function readCsv(name: string): string[] {
  return (process.env[name] || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function loadConfig(): BotConfig {
  const paperTradingOnly = readBool("PAPER_TRADING_ONLY", true);
  const paperTrading = paperTradingOnly ? true : readBool("PAPER_TRADING", true);
  const liveTrading = paperTradingOnly ? false : readBool("LIVE_TRADING", false);
  const realTradingEnabled = paperTradingOnly ? false : readBool("REAL_TRADING_ENABLED", false);

  // Safety rule: live mode can never run at the same time as paper mode.
  if (paperTrading && liveTrading) {
    throw new Error("Unsafe config: LIVE_TRADING and PAPER_TRADING cannot both be true.");
  }

  if (!paperTrading && !liveTrading) {
    throw new Error("No trading mode enabled. Set PAPER_TRADING=true for Version 1.");
  }

  return {
    paperTradingOnly,
    paperTrading,
    liveTrading,
    manualApproval: readBool("MANUAL_APPROVAL", true),
    startingPaperBalance: readNumber("STARTING_PAPER_BALANCE", 100),
    maxTradeUsd: readNumber("MAX_TRADE_USD", readNumber("MAX_TRADE_SIZE_USD", 5)),
    maxTradeSizeUsd: readNumber("MAX_TRADE_SIZE_USD", readNumber("MAX_TRADE_USD", 5)),
    maxMarketExposureUsd: readNumber("MAX_MARKET_EXPOSURE_USD", 5),
    maxDailyLossUsd: readNumber("MAX_DAILY_LOSS_USD", 8),
    maxOpenPositions: readNumber("MAX_OPEN_POSITIONS", 2),
    minTraderScore: readNumber("MIN_TRADER_SCORE", 75),
    minMarketVolumeUsd: readNumber("MIN_MARKET_VOLUME_USD", 10000),
    maxSpread: readNumber("MAX_SPREAD", 0.015),
    maxEntryPrice: readNumber("MAX_ENTRY_PRICE", 0.85),
    minEntryPrice: readNumber("MIN_ENTRY_PRICE", 0.1),
    maxCopyPriceDifference: readNumber("MAX_COPY_PRICE_DIFFERENCE", 0.03),
    copyDelayLimitSeconds: readNumber("COPY_DELAY_LIMIT_SECONDS", 30),
    stopAfterErrors: readNumber("STOP_AFTER_ERRORS", 3),
    clobHost: readString("POLYMARKET_CLOB_HOST", "https://clob.polymarket.com"),
    dataApi: readString("POLYMARKET_DATA_API", "https://data-api.polymarket.com"),
    gammaApi: readString("POLYMARKET_GAMMA_API", "https://gamma-api.polymarket.com"),
    dashboardPort: readNumber("DASHBOARD_PORT", 3000),
    watchedWallets: readCsv("WATCHED_WALLETS"),
    maxWatchedTraders: readNumber("MAX_WATCHED_TRADERS", 5),
    leaderboardLimit: readNumber("LEADERBOARD_LIMIT", 20),
    traderPollIntervalSeconds: readNumber("TRADER_POLL_INTERVAL_SECONDS", 20),
    positionMarkIntervalSeconds: readNumber("POSITION_MARK_INTERVAL_SECONDS", 30),
    enableMarketWebSocket: readBool("ENABLE_MARKET_WEBSOCKET", true),
    replayRecentTradesOnStart: readBool("REPLAY_RECENT_TRADES_ON_START", false),
    simulateSignals: readBool("SIMULATE_SIGNALS", false),
    simulateSignalIntervalSeconds: readNumber("SIMULATE_SIGNAL_INTERVAL_SECONDS", 10),
    realTradingEnabled,
    realTradingRequiresUiConfirmation: readBool("REAL_TRADING_REQUIRES_UI_CONFIRMATION", true),
    bankrollRiskPct: readNumber("BANKROLL_RISK_PCT", 0.01),
    maxDailyLossPct: readNumber("MAX_DAILY_LOSS_PCT", readNumber("MAX_DAILY_LOSS_PERCENT", 2) / 100),
    maxDeployedCapitalPct: readNumber("MAX_DEPLOYED_CAPITAL_PCT", 0.25),
    maxPositionSizePct: readNumber("MAX_POSITION_SIZE_PCT", 0.01),
    maxOneMarketExposureUsd: readNumber("MAX_ONE_MARKET_EXPOSURE_USD", 5),
    maxStrategyOpenPositions: readNumber("MAX_STRATEGY_OPEN_POSITIONS", 10),
    maxSlippage: readNumber("MAX_SLIPPAGE", 0.003),
    maxStaleDataMs: readNumber("MAX_STALE_DATA_MS", readNumber("MAX_DATA_AGE_MS", 300)),
    maxDataAgeMs: readNumber("MAX_DATA_AGE_MS", readNumber("MAX_STALE_DATA_MS", 300)),
    finalEntryBufferSeconds: readNumber("FINAL_ENTRY_BUFFER_SECONDS", 45),
    forcedRiskCheckSeconds: readNumber("FORCED_RISK_CHECK_SECONDS", 60),
    stopAfterFailedFills: readNumber("STOP_AFTER_FAILED_FILLS", 3),
    stopAfterConsecutiveLosses: readNumber("STOP_AFTER_CONSECUTIVE_LOSSES", 3),
    minNetArbEdge: readNumber("MIN_NET_ARB_EDGE", readNumber("MIN_NET_EDGE", 0.025)),
    minNetEdge: readNumber("MIN_NET_EDGE", readNumber("MIN_NET_ARB_EDGE", 0.025)),
    minOrderBookDepthUsd: readNumber("MIN_ORDER_BOOK_DEPTH_USD", 25),
    minDepthMultiplier: readNumber("MIN_DEPTH_MULTIPLIER", 5),
    requireBothLegsFillable: readBool("REQUIRE_BOTH_LEGS_FILLABLE", true),
    rejectPartialFills: readBool("REJECT_PARTIAL_FILLS", true),
    arbitrageScanIntervalSeconds: readNumber("ARBITRAGE_SCAN_INTERVAL_SECONDS", 10),
    arbitrageTargetShares: readNumber("ARBITRAGE_TARGET_SHARES", 5),
    makerOrderTimeoutMs: readNumber("MAKER_ORDER_TIMEOUT_MS", 1000),
    marketMakingIntervalSeconds: readNumber("MARKET_MAKING_INTERVAL_SECONDS", 10),
    marketMakingMinEdge: readNumber("MARKET_MAKING_MIN_EDGE", 0.0005),
    marketMakingMaxDataAgeMs: readNumber("MARKET_MAKING_MAX_DATA_AGE_MS", 15_000),
    strategyLabAllMarkets: readBool("STRATEGY_LAB_ALL_MARKETS", true),
    whalePollIntervalSeconds: readNumber("WHALE_POLL_INTERVAL_SECONDS", 10),
    whaleMinTradeUsd: readNumber("WHALE_MIN_TRADE_USD", 1000),
    takerFeeRate: readNumber("TAKER_FEE_RATE", 0.05),
    cryptoTakerFeeRate: readNumber("CRYPTO_TAKER_FEE_RATE", 0.072),
    makerFeeRate: readNumber("MAKER_FEE_RATE", 0),
    makerFailedFillRiskBps: readNumber("MAKER_FAILED_FILL_RISK_BPS", 30),
    recorderEnabled: readBool("RECORDER_ENABLED", true),
    backtestMode: readBool("BACKTEST_MODE", false),
    paperAutoSettleSeconds: readNumber("PAPER_AUTO_SETTLE_SECONDS", 60),
    telegramBotToken: process.env.TELEGRAM_BOT_TOKEN,
    telegramChatId: process.env.TELEGRAM_CHAT_ID,
    polymarketPrivateKey: process.env.POLYMARKET_PRIVATE_KEY,
    polymarketApiKey: process.env.POLYMARKET_API_KEY,
    polymarketApiSecret: process.env.POLYMARKET_API_SECRET,
    polymarketApiPassphrase: process.env.POLYMARKET_API_PASSPHRASE
  };
}

export const config = loadConfig();
