import { BotConfig, BotMode, CopySignal, PortfolioSnapshot, RiskDecision } from "../types";
import { logger } from "../logger";
import { calculateProspectiveExposure } from "./exposure";

export interface LiveOrderIntent {
  strategy: string;
  marketId: string;
  estimatedNotionalUsd: number;
  marketLiquidityUsd: number;
  approvedForLive: boolean;
}

export interface LiveRiskContext {
  mode: BotMode;
  openPositions: number;
  dailyPnlUsd: number;
  hourlyPnlUsd: number;
  apiErrorCount: number;
  abnormalFillBehavior: boolean;
}

export interface CopyTradeRiskContext {
  entryPrice?: number;
  expectedRewardUsd?: number;
}

export class RiskManager {
  private killSwitchActive = false;
  private paused = false;
  private errorCount = 0;

  constructor(
    private readonly config: Pick<
      BotConfig,
      | "mode"
      | "enableLiveTrading"
      | "realTradingEnabled"
      | "liveTrading"
      | "paperTrading"
      | "maxTradeUsd"
      | "maxTradeSizeUsdc"
      | "maxMarketExposureUsd"
      | "maxMarketAllocationPct"
      | "maxTraderAllocationPct"
      | "maxTotalExposurePct"
      | "maxPositionSizePct"
      | "maxOneMarketExposureUsd"
      | "maxDailyLossUsd"
      | "maxDailyLossUsdc"
      | "maxOpenPositions"
      | "stopAfterErrors"
      | "minDepthMultiplier"
      | "minRewardRiskRatio"
    >
  ) {}

  evaluate(
    signal: CopySignal,
    portfolio: PortfolioSnapshot,
    intendedTradeUsd: number,
    context: CopyTradeRiskContext = {}
  ): RiskDecision {
    const reasons: string[] = [];

    if (this.killSwitchActive) {
      reasons.push("Kill switch is active.");
    }

    if (this.paused) {
      reasons.push("Bot is paused.");
    }

    if (portfolio.dailyRealizedPnlUsd <= -Math.abs(this.config.maxDailyLossUsd)) {
      reasons.push("MAX_DAILY_LOSS_USD has been reached.");
    }

    if (this.errorCount >= this.config.stopAfterErrors) {
      reasons.push("STOP_AFTER_ERRORS reached; bot is paused by risk manager.");
    }

    if (intendedTradeUsd > this.config.maxTradeUsd) {
      reasons.push("Trade size exceeds MAX_TRADE_USD.");
    }

    const portfolioValueUsd = Math.max(1, portfolio.equityUsd || portfolio.startingBalanceUsd);
    if (signal.side === "BUY" && intendedTradeUsd > portfolioValueUsd * this.config.maxPositionSizePct) {
      reasons.push("Trade risk exceeds MAX_POSITION_SIZE_PCT of portfolio.");
    }

    if (intendedTradeUsd > portfolio.balanceUsd && signal.side === "BUY") {
      reasons.push("Not enough paper cash for this simulated buy.");
    }

    const existingPosition = portfolio.openPositions.find((position) => position.assetId === signal.assetId);
    if (signal.side === "BUY" && !existingPosition && portfolio.openPositions.length >= this.config.maxOpenPositions) {
      reasons.push("MAX_OPEN_POSITIONS reached.");
    }

    const marketExposure = portfolio.openPositions
      .filter((position) => position.conditionId === signal.conditionId)
      .reduce((total, position) => total + position.costBasisUsd, 0);

    if (signal.side === "BUY" && marketExposure + intendedTradeUsd > this.config.maxMarketExposureUsd) {
      reasons.push("MAX_MARKET_EXPOSURE_USD would be exceeded.");
    }

    if (signal.side === "BUY" && marketExposure + intendedTradeUsd > this.config.maxOneMarketExposureUsd) {
      reasons.push("MAX_ONE_MARKET_EXPOSURE_USD would be exceeded.");
    }

    if (signal.side === "BUY") {
      const prospective = calculateProspectiveExposure({
        positions: portfolio.openPositions,
        conditionId: signal.conditionId,
        marketTitle: signal.marketTitle,
        marketSlug: signal.marketSlug,
        traderWallet: signal.traderWallet,
        traderName: signal.traderName,
        tradeUsd: intendedTradeUsd
      });
      const maxMarketUsd = portfolioValueUsd * this.config.maxMarketAllocationPct;
      const maxTraderUsd = portfolioValueUsd * this.config.maxTraderAllocationPct;
      const maxTotalUsd = portfolioValueUsd * this.config.maxTotalExposurePct;

      if (prospective.marketExposureUsd > maxMarketUsd) {
        reasons.push("Market already saturated: MAX_MARKET_ALLOCATION_PCT would be exceeded.");
      }
      if (prospective.traderExposureUsd > maxTraderUsd) {
        reasons.push("Trader exposure limit hit: MAX_TRADER_ALLOCATION_PCT would be exceeded.");
      }
      if (prospective.totalExposureUsd > maxTotalUsd) {
        reasons.push("Total exposure limit hit: MAX_TOTAL_EXPOSURE_PCT would be exceeded.");
      }

      const rewardRisk = calculateRewardRiskRatio(signal, intendedTradeUsd, context);
      if (rewardRisk !== undefined && rewardRisk < this.config.minRewardRiskRatio) {
        reasons.push("Favorite trap filter: expected reward is too small versus downside risk.");
      }
    }

    return {
      accepted: reasons.length === 0,
      reasons
    };
  }

  evaluateLiveOrder(intent: LiveOrderIntent, context: LiveRiskContext): RiskDecision {
    const reasons: string[] = [];

    if (!this.config.enableLiveTrading) reasons.push("ENABLE_LIVE_TRADING is false.");
    if (!this.config.realTradingEnabled) reasons.push("REAL_TRADING_ENABLED is false.");
    if (!this.config.liveTrading || this.config.paperTrading) reasons.push("Live mode requires LIVE_TRADING=true and PAPER_TRADING=false.");
    if (this.config.mode !== "live" || context.mode !== "live") reasons.push("MODE must be live for real orders.");
    if (this.killSwitchActive) reasons.push("Kill switch is active.");
    if (this.paused) reasons.push("Bot is paused.");
    if (!intent.approvedForLive) reasons.push("Strategy is not approved for live trading.");
    if (intent.estimatedNotionalUsd > this.config.maxTradeSizeUsdc) reasons.push("Order exceeds MAX_TRADE_SIZE_USDC.");
    if (context.dailyPnlUsd <= -Math.abs(this.config.maxDailyLossUsdc)) reasons.push("MAX_DAILY_LOSS_USDC has been reached.");
    if (context.openPositions >= this.config.maxOpenPositions) reasons.push("MAX_OPEN_POSITIONS reached.");
    if (intent.marketLiquidityUsd < intent.estimatedNotionalUsd * this.config.minDepthMultiplier) {
      reasons.push("Market liquidity is too low for the intended live order.");
    }
    if (context.apiErrorCount >= this.config.stopAfterErrors) reasons.push("API error count reached STOP_AFTER_ERRORS.");
    if (context.abnormalFillBehavior) reasons.push("Order placement/fill behavior is abnormal.");

    const decision = {
      accepted: reasons.length === 0,
      reasons
    };

    logger.info("Live order risk decision evaluated.", {
      accepted: decision.accepted,
      strategy: intent.strategy,
      marketId: intent.marketId,
      estimatedNotionalUsd: intent.estimatedNotionalUsd,
      reasons
    });

    return decision;
  }

  recordError(error: unknown): void {
    this.errorCount += 1;
    logger.error("Risk manager recorded bot error.", {
      error: error instanceof Error ? error.message : String(error),
      errorCount: this.errorCount
    });

    if (this.errorCount >= this.config.stopAfterErrors) {
      this.killSwitchActive = true;
      logger.error("Kill switch activated because STOP_AFTER_ERRORS was reached.");
    }
  }

  setKillSwitch(active: boolean): void {
    this.killSwitchActive = active;
    logger.warn(active ? "Kill switch activated manually." : "Kill switch deactivated manually.");
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    logger.warn(paused ? "Bot paused manually." : "Bot resumed manually.");
  }

  getStatus(): { killSwitchActive: boolean; paused: boolean; errorCount: number; stopAfterErrors: number } {
    return {
      killSwitchActive: this.killSwitchActive,
      paused: this.paused,
      errorCount: this.errorCount,
      stopAfterErrors: this.config.stopAfterErrors
    };
  }
}

function calculateRewardRiskRatio(
  signal: CopySignal,
  intendedTradeUsd: number,
  context: CopyTradeRiskContext
): number | undefined {
  if (intendedTradeUsd <= 0 || signal.side !== "BUY") return undefined;
  if (context.expectedRewardUsd !== undefined && Number.isFinite(context.expectedRewardUsd)) {
    return Math.max(0, context.expectedRewardUsd) / intendedTradeUsd;
  }

  const entryPrice = context.entryPrice ?? signal.traderPrice;
  if (!Number.isFinite(entryPrice) || entryPrice <= 0 || entryPrice >= 1) return undefined;
  const shares = intendedTradeUsd / entryPrice;
  const maxRewardUsd = shares * Math.max(0, 1 - entryPrice);
  return maxRewardUsd / intendedTradeUsd;
}
