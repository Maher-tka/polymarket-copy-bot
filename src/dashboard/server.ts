import express from "express";
import fs from "fs";
import path from "path";
import { BotConfig } from "../types";
import { BotStatus } from "../botStatus";
import { MemoryLogger } from "../logger";
import { RiskManager } from "../risk/riskManager";
import { Portfolio } from "../trading/portfolio";
import { MultiStrategyEngine } from "../strategy/multiStrategyEngine";

export interface DashboardDeps {
  config: BotConfig;
  portfolio: Portfolio;
  riskManager: RiskManager;
  logger: MemoryLogger;
  botStatus: BotStatus;
  strategyEngine?: MultiStrategyEngine;
}

export function createDashboardServer({ config, portfolio, riskManager, logger, botStatus, strategyEngine }: DashboardDeps) {
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
        maxDailyLossUsd: config.maxDailyLossUsd,
        maxDailyLossUsdc: config.maxDailyLossUsdc,
        maxOpenPositions: config.maxOpenPositions,
        traderPollIntervalSeconds: config.traderPollIntervalSeconds,
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
        paperLearningMinTrades: config.paperLearningMinTrades
      }
    };
  };

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
        app.listen(config.dashboardPort, () => resolve());
      })
  };
}

function resolvePublicDir(): string {
  const compiledPath = path.join(__dirname, "public");
  if (fs.existsSync(compiledPath)) return compiledPath;

  // When running from dist, keep serving the source dashboard assets.
  return path.join(process.cwd(), "src", "dashboard", "public");
}
