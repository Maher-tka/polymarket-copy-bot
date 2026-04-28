import { config } from "./config";
import { logger } from "./logger";
import { BotStatus } from "./botStatus";
import { ClobPublicClient } from "./polymarket/clobPublicClient";
import { DataClient } from "./polymarket/dataClient";
import { GammaClient } from "./polymarket/gammaClient";
import { MarketWebSocket } from "./polymarket/marketWebSocket";
import { RiskManager } from "./risk/riskManager";
import { StrategyRiskManager } from "./risk/strategyRiskManager";
import { PositionSizer } from "./risk/positionSizer";
import { CopyExecutionPort, PaperExecutionLayer } from "./execution/executionLayer";
import { createDashboardServer } from "./dashboard/server";
import { TelegramNotifier } from "./notifications/telegram";
import { DemoSignalGenerator } from "./strategy/demoSignalGenerator";
import { LeaderboardService } from "./traders/leaderboard";
import { WalletWatcher } from "./traders/walletWatcher";
import { MarketFilter } from "./strategy/marketFilter";
import { Portfolio } from "./trading/portfolio";
import { PaperTrader } from "./trading/paperTrader";
import { CopySignal } from "./types";
import { MultiStrategyEngine } from "./strategy/multiStrategyEngine";
import { evaluateLatency } from "./latency/latencyEngine";
import { scoreSignal, shouldSkipSmartCopy } from "./strategy/signalScoring";
import { SignalThrottle } from "./risk/signalThrottle";
import { classifyMarketCategory } from "./risk/exposure";

async function main(): Promise<void> {
  if (config.mode !== "paper") {
    throw new Error(`MODE=${config.mode} is parsed and reserved, but this runtime currently only starts PAPER mode.`);
  }

  if (config.paperTradingOnly && (config.liveTrading || config.realTradingEnabled || !config.paperTrading)) {
    throw new Error("Unsafe config: PAPER_TRADING_ONLY=true requires PAPER_TRADING=true and all live trading flags false.");
  }

  if (!config.paperTrading || config.liveTrading || config.realTradingEnabled) {
    throw new Error("Real trading is disabled in this build. Set PAPER_TRADING_ONLY=true and PAPER_TRADING=true.");
  }

  const dataClient = new DataClient(config);
  const gammaClient = new GammaClient(config);
  const clobPublicClient = new ClobPublicClient(config);
  const portfolio = new Portfolio(config.startingPaperBalance, "PAPER");
  const botStatus = new BotStatus();
  const riskManager = new RiskManager(config);
  const strategyRiskManager = new StrategyRiskManager(config, riskManager);
  const positionSizer = new PositionSizer(config);
  const marketFilter = new MarketFilter(config);
  const paperTrader = new PaperTrader(portfolio);
  const execution = new PaperExecutionLayer({ copyTrader: paperTrader });
  const signalThrottle = new SignalThrottle(config);
  const telegram = new TelegramNotifier(config);
  const marketWebSocket = config.enableMarketWebSocket ? new MarketWebSocket() : undefined;
  botStatus.setApiConnected(true);
  botStatus.setSimulationEnabled(config.simulateSignals);
  botStatus.setTelegramConfigured(Boolean(config.telegramBotToken && config.telegramChatId));
  if (marketWebSocket) {
    const wsStatus = marketWebSocket.getStatus();
    botStatus.setMarketWebSocketStatus(
      wsStatus.connected,
      wsStatus.subscribedAssets,
      wsStatus.lastMessageAt,
      wsStatus.latencyMs
    );
    marketWebSocket.on("status", (status) => {
      botStatus.setMarketWebSocketStatus(status.connected, status.subscribedAssets, status.lastMessageAt, status.latencyMs);
    });
  }

  const strategyEngine = new MultiStrategyEngine({
    config,
    gammaClient,
    dataClient,
    clobClient: clobPublicClient,
    portfolio,
    strategyRisk: strategyRiskManager
  });
  marketWebSocket?.on("message", (message) => strategyEngine.observeMarketWebSocketMessage(message));

  const dashboard = createDashboardServer({ config, portfolio, riskManager, logger, botStatus, strategyEngine });
  await dashboard.start();
  logger.info(`Dashboard running at http://${config.dashboardHost}:${config.dashboardPort}`);
  logger.info("Version 1 started in PAPER mode only. No real orders can be placed.");
  await strategyEngine.start();

  const leaderboard = new LeaderboardService(dataClient, config);
  const watchedTraders = await leaderboard.selectWatchedTraders();
  portfolio.setWatchedTraders(watchedTraders);

  if (watchedTraders.length === 0) {
    logger.warn("No watched traders selected. Add WATCHED_WALLETS or lower MIN_TRADER_SCORE after reviewing filters.");
  } else {
    logger.info("Watched traders selected.", {
      traders: watchedTraders.map((trader) => ({
        wallet: trader.wallet,
        score: trader.score,
        userName: trader.userName
      }))
    });
  }

  const watcher = new WalletWatcher(dataClient, watchedTraders, config, botStatus);
  await watcher.start((signal) =>
    processSignal({
      signal,
      gammaClient,
      clobPublicClient,
      marketFilter,
      positionSizer,
      riskManager,
      execution,
      portfolio,
      telegram,
      signalThrottle,
      marketWebSocket
    })
  );
  let traderRefreshInFlight = false;
  setInterval(() => {
    if (traderRefreshInFlight) return;
    traderRefreshInFlight = true;
    refreshWatchedTraders({ leaderboard, watcher, portfolio })
      .catch((error) => riskManager.recordError(error))
      .finally(() => {
        traderRefreshInFlight = false;
      });
  }, config.traderRefreshIntervalSeconds * 1000);

  if (config.simulateSignals) {
    const demoSignalGenerator = new DemoSignalGenerator(
      gammaClient,
      clobPublicClient,
      portfolio,
      config,
      botStatus
    );
    await demoSignalGenerator.start((signal) =>
      processSignal({
        signal,
        gammaClient,
        clobPublicClient,
        marketFilter,
        positionSizer,
        riskManager,
        execution,
        portfolio,
        telegram,
        signalThrottle,
        marketWebSocket
      })
    );
  }

  setInterval(() => {
    markOpenPositions(portfolio, clobPublicClient).catch((error) => riskManager.recordError(error));
  }, config.positionMarkIntervalSeconds * 1000);
}

interface ProcessSignalDeps {
  signal: CopySignal;
  gammaClient: GammaClient;
  clobPublicClient: ClobPublicClient;
  marketFilter: MarketFilter;
  positionSizer: PositionSizer;
  riskManager: RiskManager;
  execution: CopyExecutionPort;
  portfolio: Portfolio;
  telegram: TelegramNotifier;
  signalThrottle: SignalThrottle;
  marketWebSocket?: MarketWebSocket;
}

async function processSignal(deps: ProcessSignalDeps): Promise<void> {
  const {
    signal,
    gammaClient,
    clobPublicClient,
    marketFilter,
    positionSizer,
    riskManager,
    execution,
    portfolio,
    telegram,
    signalThrottle,
    marketWebSocket
  } = deps;

  const signalDetectedAtMs = Date.now();
  portfolio.addSignal(signal);
  logger.info("New copy signal created.", {
    trader: signal.traderWallet,
    score: signal.traderScore,
    side: signal.side,
    market: signal.marketTitle,
    copiedPrice: signal.traderPrice
  });
  await telegram.send("copy_signal", `${signal.side} ${signal.outcome ?? signal.assetId} at ${signal.traderPrice}`);

  try {
    const market = signal.marketSlug ? await gammaClient.getMarketBySlug(signal.marketSlug) : undefined;
    signal.marketCategory = classifyMarketCategory(signal.marketTitle ?? market?.question, signal.marketSlug ?? market?.slug);
    const decisionStartedAtMs = Date.now();
    const snapshot = await clobPublicClient.buildMarketSnapshot(
      signal.assetId,
      signal.side,
      market,
      config.maxCopyPriceDifference,
      signal.traderPrice
    );
    const decisionCompletedAtMs = Date.now();
    const orderBookTimestampMs = snapshot.orderBook?.timestamp
      ? normalizeTimestampMs(snapshot.orderBook.timestamp)
      : undefined;
    const latencyDecision = evaluateLatency(
      {
        sourceEventTimestampMs: signal.traderTradeTimestamp * 1000,
        detectedAtMs: signalDetectedAtMs,
        decisionStartedAtMs,
        decisionCompletedAtMs,
        simulatedExecutionAtMs: Date.now(),
        dataTimestampMs: orderBookTimestampMs
      },
      config
    );

    const throttleReasons = signalThrottle.evaluateSignal(
      signal.conditionId,
      portfolio.getSnapshot().openPositions.map((position) => position.conditionId)
    );
    if (throttleReasons.length > 0) {
      signalThrottle.recordSignal(signal.conditionId, false);
      portfolio.addSkipped(throttleReasons, signal);
      logger.info("Trade skipped by signal throttle.", { reasons: throttleReasons, signalId: signal.id });
      return;
    }

    const filterDecision = marketFilter.evaluate(signal, snapshot);
    const smartCopyReasons = shouldSkipSmartCopy({ signal, snapshot, latency: latencyDecision.metrics, config });
    const entryPrice = filterDecision.currentEntryPrice ?? signal.traderPrice;
    const rawEdge = signal.side === "BUY" ? Math.max(0, signal.traderPrice - entryPrice) : Math.max(0, entryPrice - signal.traderPrice);
    const realEdge = rawEdge - latencyDecision.penaltyEdge;
    const score = scoreSignal(
      {
        signal,
        snapshot,
        portfolio: portfolio.getSnapshot(),
        realEdge,
        expectedProfitUsd: realEdge * Math.max(1, signal.traderSize),
        latency: latencyDecision.metrics,
        confirmations: [
          "copy-trader",
          ...(snapshot.spread <= config.maxSpread ? ["tight-spread" as const] : []),
          ...(latencyDecision.metrics.dataAgeMs <= config.maxDataAgeMs ? ["fresh-book" as const] : []),
          ...(realEdge > config.minRealEdge ? ["positive-edge" as const] : [])
        ],
        highRisk: signal.traderNotionalUsd > config.maxTradeUsd
      },
      config
    );
    const combinedRejectReasons = [
      ...latencyDecision.reasons,
      ...filterDecision.reasons,
      ...smartCopyReasons,
      ...score.reasons
    ];
    signal.signalScore = score.score;
    signal.confirmations = score.confirmations;
    signal.realEdge = realEdge;
    signal.latency = latencyDecision.metrics;
    signal.detectedAt = new Date(signalDetectedAtMs).toISOString();

    if (combinedRejectReasons.length > 0) {
      signalThrottle.recordSignal(signal.conditionId, false);
      portfolio.addSkipped(combinedRejectReasons, signal);
      logger.info("Trade skipped by smart copy / latency / scoring gates.", {
        reasons: combinedRejectReasons,
        score: score.score,
        realEdge,
        latency: latencyDecision.metrics,
        signalId: signal.id
      });
      await telegram.send("trade_skipped", combinedRejectReasons.join(" | "));
      return;
    }

    const portfolioSnapshot = portfolio.getSnapshot();
    const size = positionSizer.calculate(
      signal,
      portfolioSnapshot,
      filterDecision.currentEntryPrice,
      filterDecision.availableLiquidityUsd ?? 0
    );

    if (!size.accepted) {
      portfolio.addSkipped(size.reasons, signal);
      logger.info("Trade skipped by position sizing.", { reasons: size.reasons, signalId: signal.id });
      await telegram.send("trade_skipped", size.reasons.join(" | "));
      return;
    }

    const riskDecision = riskManager.evaluate(signal, portfolioSnapshot, size.tradeUsd, {
      entryPrice: filterDecision.currentEntryPrice ?? signal.traderPrice
    });
    if (!riskDecision.accepted) {
      portfolio.addSkipped(riskDecision.reasons, signal);
      logger.warn("Trade skipped by risk manager.", { reasons: riskDecision.reasons, signalId: signal.id });
      await telegram.send("trade_skipped", riskDecision.reasons.join(" | "));
      return;
    }

    const tradeThrottleReasons = signalThrottle.evaluateTrade();
    if (tradeThrottleReasons.length > 0) {
      signalThrottle.recordSignal(signal.conditionId, false);
      portfolio.addSkipped(tradeThrottleReasons, signal);
      logger.info("Trade skipped by trade throttle.", { reasons: tradeThrottleReasons, signalId: signal.id });
      return;
    }

    const result = execution.executeCopySignal(signal, filterDecision.currentEntryPrice ?? signal.traderPrice, size);
    signalThrottle.recordSignal(signal.conditionId, true);
    signalThrottle.recordTrade();
    marketWebSocket?.subscribe([signal.assetId]);
    await markOpenPositions(portfolio, clobPublicClient);

    if (result.success) {
      await telegram.send("trade_simulated", `Paper ${signal.side} simulated for $${size.tradeUsd}.`);
    } else if (result.skipped) {
      await telegram.send("trade_skipped", result.skipped.reasons.join(" | "));
    }

    if (portfolio.getSnapshot().dailyRealizedPnlUsd <= -Math.abs(config.maxDailyLossUsd)) {
      await telegram.send("daily_loss_limit", "Daily loss limit reached. Risk manager will skip new trades.");
    }
  } catch (error) {
    riskManager.recordError(error);
    await telegram.send("bot_error", error instanceof Error ? error.message : String(error));
  }
}

async function refreshWatchedTraders(input: {
  leaderboard: LeaderboardService;
  watcher: WalletWatcher;
  portfolio: Portfolio;
}): Promise<void> {
  const traders = await input.leaderboard.selectWatchedTraders();
  input.portfolio.setWatchedTraders(traders);
  input.watcher.replaceWatchedTraders(traders);
  logger.info("Trader refresh completed.", {
    count: traders.length,
    topTrader: traders[0]
      ? {
          wallet: traders[0].wallet,
          score: traders[0].score,
          staleScorePenalty: traders[0].staleScorePenalty,
          lastActiveAt: traders[0].lastActiveAt
        }
      : undefined
  });
}

function normalizeTimestampMs(timestamp: string): number | undefined {
  const raw = Number(timestamp);
  if (Number.isFinite(raw)) return raw > 10_000_000_000 ? raw : raw * 1000;
  const parsed = new Date(timestamp).getTime();
  return Number.isFinite(parsed) ? parsed : undefined;
}

async function markOpenPositions(portfolio: Portfolio, clobPublicClient: ClobPublicClient): Promise<void> {
  const snapshot = portfolio.getSnapshot();
  for (const position of snapshot.openPositions) {
    try {
      const orderBook = await clobPublicClient.getOrderBook(position.assetId);
      const bestBid = orderBook.bids
        .map((level) => Number(level.price))
        .filter(Number.isFinite)
        .sort((a, b) => b - a)[0];

      const markPrice = bestBid ?? Number(orderBook.last_trade_price) ?? position.currentPrice;
      portfolio.markPosition(position.assetId, markPrice);
    } catch (error) {
      logger.warn("Could not mark open paper position to market.", {
        assetId: position.assetId,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
}

process.on("unhandledRejection", (error) => {
  logger.error("Unhandled promise rejection.", { error: error instanceof Error ? error.message : String(error) });
});

main().catch((error) => {
  logger.error("Bot failed to start.", { error: error instanceof Error ? error.message : String(error) });
  process.exitCode = 1;
});
