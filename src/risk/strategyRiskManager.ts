import { BotConfig, StrategyEngineState, StrategyOpportunity } from "../types";
import { PortfolioSnapshot } from "../types";
import { RiskManager } from "./riskManager";

export class StrategyRiskManager {
  private failedFillCount = 0;

  constructor(
    private readonly config: Pick<
      BotConfig,
      | "maxDailyLossPct"
      | "maxDeployedCapitalPct"
      | "maxPositionSizePct"
      | "maxTradeSizeUsd"
      | "maxOneMarketExposureUsd"
      | "maxStrategyOpenPositions"
      | "maxSlippage"
      | "stopAfterFailedFills"
      | "stopAfterConsecutiveLosses"
    >,
    private readonly riskManager: RiskManager
  ) {}

  evaluate(
    opportunity: StrategyOpportunity,
    portfolio: PortfolioSnapshot,
    strategyState: StrategyEngineState,
    intendedCapitalUsd: number,
    slippagePct: number
  ): string[] {
    const reasons: string[] = [];
    const riskStatus = this.riskManager.getStatus();
    const openTrades = strategyState.paperTrades.filter((trade) => !trade.closedAt);
    const deployedCapital = openTrades.reduce((total, trade) => total + trade.entryCostUsd, 0);
    const oneMarketExposure = openTrades
      .filter((trade) => trade.conditionId === opportunity.conditionId)
      .reduce((total, trade) => total + trade.entryCostUsd, 0);

    if (riskStatus.killSwitchActive || strategyState.emergencyStopped) reasons.push("Emergency stop / kill switch is active.");
    if (riskStatus.paused) reasons.push("Bot is paused.");
    if (this.failedFillCount >= this.config.stopAfterFailedFills) reasons.push("Repeated failed fills threshold reached.");
    if (countConsecutiveLosses(strategyState) >= this.config.stopAfterConsecutiveLosses) {
      reasons.push("Stop-after-consecutive-losses threshold reached.");
    }
    if (portfolio.dailyRealizedPnlUsd <= -portfolio.startingBalanceUsd * this.config.maxDailyLossPct) {
      reasons.push("Max daily loss percentage reached.");
    }
    if (intendedCapitalUsd > this.config.maxTradeSizeUsd + 0.0001) {
      reasons.push("Position exceeds MAX_TRADE_SIZE_USD.");
    }
    const pctCap = portfolio.equityUsd * this.config.maxPositionSizePct;
    const positionCap = Number.isFinite(pctCap) && pctCap > 0 ? Math.min(this.config.maxTradeSizeUsd, pctCap) : this.config.maxTradeSizeUsd;
    if (intendedCapitalUsd > positionCap + 0.0001) {
      reasons.push("Position exceeds max position size percentage.");
    }
    if (deployedCapital + intendedCapitalUsd > portfolio.equityUsd * this.config.maxDeployedCapitalPct) {
      reasons.push("Max deployed capital percentage would be exceeded.");
    }
    if (oneMarketExposure + intendedCapitalUsd > this.config.maxOneMarketExposureUsd) {
      reasons.push("Max one-market exposure would be exceeded.");
    }
    if (openTrades.length >= this.config.maxStrategyOpenPositions) reasons.push("Max open strategy positions reached.");
    if (slippagePct > this.config.maxSlippage) reasons.push("Estimated slippage exceeds max slippage.");

    return reasons;
  }

  recordFill(fillRate: number): void {
    if (fillRate < 1) this.failedFillCount += 1;
  }

  getFailedFillCount(): number {
    return this.failedFillCount;
  }
}

function countConsecutiveLosses(strategyState: StrategyEngineState): number {
  let count = 0;
  const trades = strategyState.paperTrades
    .filter((trade) => !isPaperScoutTrade(trade, strategyState))
    .filter((trade) => trade.closedAt || trade.realizedPnlUsd !== 0)
    .sort((a, b) => new Date(b.closedAt ?? b.openedAt).getTime() - new Date(a.closedAt ?? a.openedAt).getTime());

  for (const trade of trades) {
    const pnl = trade.realizedPnlUsd + trade.unrealizedPnlUsd;
    if (pnl < 0) count += 1;
    else break;
  }

  return count;
}

function isPaperScoutTrade(
  trade: StrategyEngineState["paperTrades"][number],
  strategyState: StrategyEngineState
): boolean {
  if (trade.paperScout) return true;
  const opportunity = strategyState.opportunities.find((item) => item.id === trade.opportunityId);
  if (opportunity?.paperScout || opportunity?.reason?.startsWith("Paper scout mode:")) return true;

  // Older local paper-trade records were created before paperScout was stored.
  // A negative-edge net-arb fill can only come from scout mode because the
  // normal net-arb path requires a positive edge before executing.
  return trade.strategy === "net-arbitrage" && trade.edge < 0 && trade.lossReason === "Negative edge after costs.";
}
