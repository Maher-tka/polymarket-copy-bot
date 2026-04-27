import { BotConfig, CopySignal, PortfolioSnapshot, RiskDecision } from "../types";
import { logger } from "../logger";

export class RiskManager {
  private killSwitchActive = false;
  private paused = false;
  private errorCount = 0;

  constructor(
    private readonly config: Pick<
      BotConfig,
      "maxTradeUsd" | "maxMarketExposureUsd" | "maxDailyLossUsd" | "maxOpenPositions" | "stopAfterErrors"
    >
  ) {}

  evaluate(signal: CopySignal, portfolio: PortfolioSnapshot, intendedTradeUsd: number): RiskDecision {
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

    return {
      accepted: reasons.length === 0,
      reasons
    };
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
