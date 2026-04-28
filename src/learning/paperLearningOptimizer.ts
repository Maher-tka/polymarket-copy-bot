import { BotConfig, PaperLearningAdjustment, PaperLearningState, StrategyEngineState, StrategyName } from "../types";

const MIN_MARKET_MAKING_DATA_AGE_MS = 1_000;
const MAX_MARKET_MAKING_DATA_AGE_MS = 15_000;
const MAX_MARKET_MAKING_MIN_EDGE = 0.003;

type LearningConfig = Pick<
  BotConfig,
  | "paperTradingOnly"
  | "realTradingEnabled"
  | "paperLearningEnabled"
  | "paperLearningAutoApply"
  | "paperLearningMinSignals"
  | "paperLearningMinTrades"
  | "marketMakingMaxDataAgeMs"
  | "marketMakingMinEdge"
  | "maxDataAgeMs"
>;

export class PaperLearningOptimizer {
  private state: PaperLearningState;
  private lastAppliedSampleKey = "";
  private appliedHistory: PaperLearningAdjustment[] = [];

  constructor(private readonly config: LearningConfig) {
    this.state = this.emptyState();
  }

  evaluate(engineState: StrategyEngineState): PaperLearningState {
    const enabled = this.isEnabled();
    const autoApply = enabled && this.config.paperLearningAutoApply;
    const summary = engineState.losingDiagnostics;
    const best = summary.strategyRanking[0];
    const sampleKey = `${summary.totalSignals}:${summary.tradesTaken}:${summary.netPnlUsd.toFixed(4)}:${summary.averageDataDelayMs.toFixed(0)}`;
    const canApplyThisSample = autoApply && sampleKey !== this.lastAppliedSampleKey;
    const recommendations: string[] = [];
    const appliedAdjustments: PaperLearningAdjustment[] = [];
    const disabledStrategies = new Set<StrategyName>();

    if (!enabled) {
      this.state = {
        ...this.emptyState(),
        notes: ["Paper learning is disabled or real trading safety flags are not paper-only."]
      };
      return this.state;
    }

    if (best) {
      recommendations.push(`Focus review on ${best.label}; it currently ranks best by paper net PnL.`);
    }

    if (summary.averageDataDelayMs > this.config.marketMakingMaxDataAgeMs) {
      const staleFloor = Math.max(MIN_MARKET_MAKING_DATA_AGE_MS, this.config.maxDataAgeMs);
      recommendations.push(
        this.config.marketMakingMaxDataAgeMs <= staleFloor
          ? "Average quote delay is high; stale tolerance is already at its paper-learning floor."
          : "Average quote delay is high; keep rejecting stale books and tighten market-making stale tolerance."
      );
      if (canApplyThisSample) {
        const nextAge = clampNumber(
          Math.min(this.config.marketMakingMaxDataAgeMs - 1_000, Math.max(this.config.maxDataAgeMs, this.config.marketMakingMaxDataAgeMs * 0.8)),
          staleFloor,
          MAX_MARKET_MAKING_DATA_AGE_MS
        );
        if (nextAge < this.config.marketMakingMaxDataAgeMs) {
          appliedAdjustments.push(this.applyNumber("marketMakingMaxDataAgeMs", nextAge, "Tightened stale quote tolerance after high average data delay."));
        }
      }
    }

    const marketMaking = summary.strategyRanking.find((item) => item.strategy === "market-making");
    if (marketMaking && marketMaking.trades >= this.config.paperLearningMinTrades && marketMaking.netPnlUsd < 0) {
      recommendations.push("Market making is negative after the minimum sample; require more spread edge before simulated fills.");
      if (canApplyThisSample) {
        const nextEdge = clampNumber(this.config.marketMakingMinEdge + 0.00025, 0.0005, MAX_MARKET_MAKING_MIN_EDGE);
        if (nextEdge > this.config.marketMakingMinEdge) {
          appliedAdjustments.push(this.applyNumber("marketMakingMinEdge", nextEdge, "Raised market-making minimum edge after negative paper PnL."));
        }
      }
    }

    for (const ranked of summary.strategyRanking) {
      const hasEnoughSignals = ranked.signals >= this.config.paperLearningMinSignals;
      const hasEnoughTrades = ranked.trades >= this.config.paperLearningMinTrades;
      const shouldDisable =
        ranked.strategy !== "market-making" &&
        ranked.status === "losing" &&
        (hasEnoughSignals || hasEnoughTrades) &&
        ranked.netPnlUsd <= 0;

      if (shouldDisable) {
        recommendations.push(`Pause ${ranked.label} paper execution; it is not positive after enough samples.`);
        if (autoApply) disabledStrategies.add(ranked.strategy);
      }
    }

    if (summary.lossesCausedByFees > 0 || summary.lossesCausedBySlippage > 0) {
      recommendations.push("Do not lower edge thresholds yet; fees or slippage are already consuming edge.");
    }

    // Mark the diagnostic sample as applied only when we actually changed settings.
    // This prevents one stale report from tightening the bot every five seconds.
    if (appliedAdjustments.length > 0) {
      this.lastAppliedSampleKey = sampleKey;
      this.appliedHistory = [...this.appliedHistory, ...appliedAdjustments].slice(-8);
    }

    this.state = {
      enabled,
      autoApply,
      focusedStrategy: best?.strategy,
      disabledStrategies: [...disabledStrategies],
      lastUpdatedAt: new Date().toISOString(),
      sampleSignals: summary.totalSignals,
      sampleTrades: summary.tradesTaken,
      recommendations: unique(recommendations).slice(0, 8),
      appliedAdjustments: this.appliedHistory,
      notes: [
        "Paper learning only changes in-memory paper-mode settings.",
        "It never enables live trading and never sends orders."
      ]
    };

    return this.state;
  }

  getState(): PaperLearningState {
    return this.state;
  }

  shouldRun(strategy: StrategyName): boolean {
    if (!this.state.enabled || !this.state.autoApply) return true;
    return !this.state.disabledStrategies.includes(strategy);
  }

  private isEnabled(): boolean {
    return this.config.paperLearningEnabled && this.config.paperTradingOnly && !this.config.realTradingEnabled;
  }

  private emptyState(): PaperLearningState {
    return {
      enabled: this.isEnabled(),
      autoApply: this.isEnabled() && this.config.paperLearningAutoApply,
      disabledStrategies: [],
      sampleSignals: 0,
      sampleTrades: 0,
      recommendations: [],
      appliedAdjustments: [],
      notes: []
    };
  }

  private applyNumber(setting: "marketMakingMaxDataAgeMs" | "marketMakingMinEdge", next: number, reason: string): PaperLearningAdjustment {
    const previous = this.config[setting];
    this.config[setting] = round(next);
    return {
      setting,
      from: previous,
      to: this.config[setting],
      reason
    };
  }
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function round(value: number): number {
  return Math.round(value * 10000) / 10000;
}
