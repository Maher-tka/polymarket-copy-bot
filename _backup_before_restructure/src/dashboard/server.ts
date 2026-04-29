import express from "express";
import fs from "fs";
import path from "path";
import { BotConfig } from "../types";
import { BotStatus } from "../botStatus";
import { MemoryLogger } from "../logger";
import { RiskManager } from "../risk/riskManager";
import { Portfolio } from "../trading/portfolio";
import { MultiStrategyEngine } from "../strategy/multiStrategyEngine";
import { QuoteDaemon } from "../marketData/quoteDaemon";

export interface DashboardDeps {
  config: BotConfig;
  portfolio: Portfolio;
  riskManager: RiskManager;
  logger: MemoryLogger;
  botStatus: BotStatus;
  strategyEngine?: MultiStrategyEngine;
  quoteDaemon?: QuoteDaemon;
}

export function createDashboardServer({ config, portfolio, riskManager, logger, botStatus, strategyEngine, quoteDaemon }: DashboardDeps) {
  const app = express();
  app.use(express.json());

  const publicDir = resolvePublicDir();
  app.use(express.static(publicDir));

  const buildState = () => {
    const snapshot = portfolio.getSnapshot();
    return {
      strategyName: "Copy + Confirm + Risk Control Bot",
      mode: config.paperTrading ? "PAPER" : "LIVE",
      liveTradingEnabledInVersion1: false,
      manualApproval: config.manualApproval,
      status: botStatus.getSnapshot(),
      portfolio: snapshot,
      watchedTraders: portfolio.getWatchedTraders(),
      risk: riskManager.getStatus(),
      quoteDaemon: quoteDaemon?.getHealth(),
      strategies: strategyEngine?.getState(),
      logs: logger.getLogs(),
      safeConfig: {
        mode: config.mode,
        paperTradingOnly: config.paperTradingOnly,
        enableLiveTrading: config.enableLiveTrading,
        maxTradeUsd: config.maxTradeUsd,
        maxTradeSizeUsd: config.maxTradeSizeUsd,
        maxTradeSizeUsdc: config.maxTradeSizeUsdc,
        maxMarketExposureUsd: config.maxMarketExposureUsd,
        maxMarketAllocationPct: config.maxMarketAllocationPct,
        maxTraderAllocationPct: config.maxTraderAllocationPct,
        maxTotalExposurePct: config.maxTotalExposurePct,
        maxDailyLossUsd: config.maxDailyLossUsd,
        maxDailyLossUsdc: config.maxDailyLossUsdc,
        maxOpenPositions: config.maxOpenPositions,
        traderPollIntervalSeconds: config.traderPollIntervalSeconds,
        traderRefreshIntervalSeconds: config.traderRefreshIntervalSeconds,
        traderScoreDecayAfterMinutes: config.traderScoreDecayAfterMinutes,
        traderScoreDecayPerHour: config.traderScoreDecayPerHour,
        positionMarkIntervalSeconds: config.positionMarkIntervalSeconds,
        arbitrageScanIntervalSeconds: config.arbitrageScanIntervalSeconds,
        marketMakingIntervalSeconds: config.marketMakingIntervalSeconds,
        whalePollIntervalSeconds: config.whalePollIntervalSeconds,
        enableMarketWebSocket: config.enableMarketWebSocket,
        minTraderScore: config.minTraderScore,
        maxSpread: config.maxSpread,
        simulateSignals: config.simulateSignals,
        simulateSignalIntervalSeconds: config.simulateSignalIntervalSeconds,
        realTradingEnabled: config.realTradingEnabled,
        realTradingRequiresUiConfirmation: config.realTradingRequiresUiConfirmation,
        bankrollRiskPct: config.bankrollRiskPct,
        maxDailyLossPct: config.maxDailyLossPct,
        maxDeployedCapitalPct: config.maxDeployedCapitalPct,
        maxPositionSizePct: config.maxPositionSizePct,
        maxOneMarketExposureUsd: config.maxOneMarketExposureUsd,
        maxStrategyOpenPositions: config.maxStrategyOpenPositions,
        maxSlippage: config.maxSlippage,
        maxStaleDataMs: config.maxStaleDataMs,
        maxDataAgeMs: config.maxDataAgeMs,
        orderStaleSeconds: config.orderStaleSeconds,
        defaultLatencyMs: config.defaultLatencyMs,
        killSwitchDrawdownPercent: config.killSwitchDrawdownPercent,
        finalEntryBufferSeconds: config.finalEntryBufferSeconds,
        forcedRiskCheckSeconds: config.forcedRiskCheckSeconds,
        minNetArbEdge: config.minNetArbEdge,
        minNetEdge: config.minNetEdge,
        paperScoutMode: config.paperScoutMode,
        paperScoutMaxNegativeEdge: config.paperScoutMaxNegativeEdge,
        paperScoutMaxSpread: config.paperScoutMaxSpread,
        paperScoutIntervalSeconds: config.paperScoutIntervalSeconds,
        paperScoutMaxOpenTrades: config.paperScoutMaxOpenTrades,
        minOrderBookDepthUsd: config.minOrderBookDepthUsd,
        minDepthMultiplier: config.minDepthMultiplier,
        requireBothLegsFillable: config.requireBothLegsFillable,
        rejectPartialFills: config.rejectPartialFills,
        stopAfterConsecutiveLosses: config.stopAfterConsecutiveLosses,
        takerFeeRate: config.takerFeeRate,
        cryptoTakerFeeRate: config.cryptoTakerFeeRate,
        makerFeeRate: config.makerFeeRate,
        marketMakingMinEdge: config.marketMakingMinEdge,
        marketMakingMaxDataAgeMs: config.marketMakingMaxDataAgeMs,
        marketMakingMaxQueueDepthMultiplier: config.marketMakingMaxQueueDepthMultiplier,
        marketMakingAdverseSelectionBps: config.marketMakingAdverseSelectionBps,
        strategyLabAllMarkets: config.strategyLabAllMarkets,
        paperLearningEnabled: config.paperLearningEnabled,
        paperLearningAutoApply: config.paperLearningAutoApply,
        paperLearningMinSignals: config.paperLearningMinSignals,
        paperLearningMinTrades: config.paperLearningMinTrades,
        dashboardHost: config.dashboardHost,
        quoteDaemonEnabled: config.quoteDaemonEnabled,
        quoteDaemonPort: config.quoteDaemonPort,
        maxQuoteDelayMs: config.maxQuoteDelayMs,
        quoteFreshnessMs: config.quoteFreshnessMs,
        maxTotalLatencyMs: config.maxTotalLatencyMs,
        latencyPenaltyBpsPerSecond: config.latencyPenaltyBpsPerSecond,
        minRealEdge: config.minRealEdge,
        minSignalScore: config.minSignalScore,
        highRiskConfirmationCount: config.highRiskConfirmationCount,
        maxSignalsPerMinute: config.maxSignalsPerMinute,
        maxTradesPerMinute: config.maxTradesPerMinute,
        maxActiveMarkets: config.maxActiveMarkets,
        lossCooldownSeconds: config.lossCooldownSeconds,
        minCopyTradeUsd: config.minCopyTradeUsd,
        minRewardRiskRatio: config.minRewardRiskRatio,
        misleadingWinRateMinWinRate: config.misleadingWinRateMinWinRate,
        misleadingWinRateMaxProfitPerTrade: config.misleadingWinRateMaxProfitPerTrade
      }
    };
  };

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.get("/ready", (_req, res) => {
    const status = botStatus.getSnapshot();
    const lastWsAt = status.lastMarketWebSocketMessageAt ? new Date(status.lastMarketWebSocketMessageAt).getTime() : 0;
    const wsAgeMs = lastWsAt ? Date.now() - lastWsAt : Number.POSITIVE_INFINITY;

    const risk = riskManager.getStatus();
    const warnings: string[] = [];
    if ((status.watchedWalletCount ?? 0) === 0 && !config.simulateSignals) {
      warnings.push("No watched wallets selected; copy-trading loop will be idle.");
    }
    const quoteHealth = quoteDaemon?.getHealth();
    if (quoteHealth && quoteHealth.lastMessageAgeMs !== undefined && quoteHealth.lastMessageAgeMs > config.maxQuoteDelayMs) {
      warnings.push("Quote daemon data is delayed; strategies may reject opportunities as stale.");
    }

    if (quoteHealth) {
      if (
        quoteHealth.averageQuoteDelayMs !== undefined &&
        Number.isFinite(quoteHealth.averageQuoteDelayMs) &&
        quoteHealth.averageQuoteDelayMs > config.quoteFreshnessMs
      ) {
        warnings.push("Quote daemon average quote delay exceeds QUOTE_FRESHNESS_MS; order books may be unusable.");
      }
      if ((quoteHealth.staleQuoteCount ?? 0) > 0) {
        warnings.push("Quote daemon is serving stale quotes; many opportunities will be rejected for missing top-of-book.");
      }
    }

    if (
      status.webSocketLatencyMs !== undefined &&
      Number.isFinite(status.webSocketLatencyMs) &&
      status.webSocketLatencyMs > config.maxTotalLatencyMs
    ) {
      warnings.push("Market WebSocket latency exceeds MAX_TOTAL_LATENCY_MS; strategies may reject opportunities.");
    }

    const quoteOk = config.quoteDaemonEnabled ? Boolean(quoteHealth?.connected) : true;
    const marketWsOk = !config.enableMarketWebSocket || Boolean(status.marketWebSocketConnected);
    const marketDataOk = quoteOk && (config.quoteDaemonEnabled ? true : marketWsOk);

    const wsFreshOk =
      !config.enableMarketWebSocket || !status.marketWebSocketConnected
        ? true
        : wsAgeMs < Math.max(30_000, config.maxStaleDataMs * 20);

    if (!quoteOk) warnings.push("Quote daemon is disconnected; strategies cannot build order books.");
    if (!marketWsOk) warnings.push("Market WebSocket is disconnected; strategy telemetry may be degraded.");
    if (config.enableMarketWebSocket && status.marketWebSocketConnected && !wsFreshOk) {
      warnings.push("Market WebSocket feed is stale; reconnect may be required.");
    }
    const ok =
      Boolean(status.apiConnected) &&
      marketDataOk &&
      wsFreshOk &&
      !risk.killSwitchActive &&
      !risk.paused;

    res.status(ok ? 200 : 503).json({
      ok,
      mode: config.paperTrading ? "PAPER" : "LIVE",
      apiConnected: status.apiConnected,
      backupPollingConnected: status.backupPollingConnected,
      marketWebSocketConnected: status.marketWebSocketConnected,
      webSocketLatencyMs: status.webSocketLatencyMs,
      marketWebSocketAgeMs: Number.isFinite(wsAgeMs) ? wsAgeMs : null,
      risk,
      warnings
    });
  });

  app.get("/api/state", (_req, res) => {
    res.json(buildState());
  });

  app.get("/api/events", (req, res) => {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive"
    });

    const writeState = () => {
      res.write(`data: ${JSON.stringify(buildState())}\n\n`);
    };

    writeState();
    const timer = setInterval(writeState, 500);

    req.on("close", () => {
      clearInterval(timer);
    });
  });

  app.post("/api/kill-switch", (req, res) => {
    riskManager.setKillSwitch(Boolean(req.body?.active));
    res.json(riskManager.getStatus());
  });

  app.post("/api/pause", (_req, res) => {
    riskManager.setPaused(true);
    res.json(riskManager.getStatus());
  });

  app.post("/api/resume", (_req, res) => {
    riskManager.setPaused(false);
    res.json(riskManager.getStatus());
  });

  app.post("/api/strategy-emergency-stop", (req, res) => {
    strategyEngine?.setEmergencyStopped(Boolean(req.body?.active));
    res.json(strategyEngine?.getState() ?? {});
  });

  app.post("/api/real-trading-confirmation", (req, res) => {
    strategyEngine?.setRealTradingUiConfirmed(Boolean(req.body?.confirmed));
    res.json(strategyEngine?.getState() ?? {});
  });

  app.get("/api/export/paper-trades.csv", (_req, res) => {
    const csv = strategyEngine?.exportCsv() ?? "";
    res.header("content-type", "text/csv; charset=utf-8");
    res.attachment("paper-trades.csv");
    res.send(csv);
  });

  return {
    start: () =>
      new Promise<void>((resolve) => {
        app.listen(config.dashboardPort, config.dashboardHost, () => resolve());
      })
  };
}

function resolvePublicDir(): string {
  const compiledPath = path.join(__dirname, "public");
  if (fs.existsSync(compiledPath)) return compiledPath;

  // When running from dist, keep serving the source dashboard assets.
  return path.join(process.cwd(), "src", "dashboard", "public");
}
