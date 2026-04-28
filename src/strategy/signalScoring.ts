import { BotConfig, CopySignal, LatencyMetrics, MarketSnapshot, PortfolioSnapshot, StrategyName } from "../types";

export interface SignalScoreInput {
  signal?: CopySignal;
  snapshot?: MarketSnapshot;
  portfolio?: PortfolioSnapshot;
  realEdge: number;
  expectedProfitUsd: number;
  latency: LatencyMetrics;
  confirmations: Array<StrategyName | "whale" | "copy-trader" | "liquidity" | "fresh-book" | "tight-spread" | "positive-edge">;
  highRisk?: boolean;
}

export interface SignalScoreResult {
  accepted: boolean;
  score: number;
  confirmations: string[];
  reasons: string[];
  positive: string[];
  negative: string[];
}

type SignalScoringConfig = Pick<
  BotConfig,
  | "minSignalScore"
  | "highRiskConfirmationCount"
  | "minTraderScore"
  | "minMarketVolumeUsd"
  | "maxSpread"
  | "maxDataAgeMs"
  | "maxTotalLatencyMs"
  | "minRealEdge"
  | "minCopyTradeUsd"
>;

export function scoreSignal(input: SignalScoreInput, config: SignalScoringConfig): SignalScoreResult {
  const positive: string[] = [];
  const negative: string[] = [];
  const confirmations = unique(input.confirmations.map(String));
  let score = 50;

  if (input.signal && input.signal.traderScore >= config.minTraderScore) {
    score += 12;
    positive.push("strong trader copied");
  } else if (input.signal) {
    score -= 15;
    negative.push("weak trader score");
  }

  if ((input.snapshot?.availableLiquidityUsd ?? 0) >= Math.max(config.minCopyTradeUsd, input.expectedProfitUsd * 20)) {
    score += 8;
    positive.push("good liquidity");
  } else {
    score -= 10;
    negative.push("low liquidity");
  }

  if ((input.snapshot?.spread ?? Number.POSITIVE_INFINITY) <= config.maxSpread) {
    score += 8;
    positive.push("tight spread");
  } else {
    score -= 12;
    negative.push("wide spread");
  }

  if (input.latency.dataAgeMs <= config.maxDataAgeMs) {
    score += 8;
    positive.push("fresh order book");
  } else {
    score -= 18;
    negative.push("stale data");
  }

  if (input.latency.totalLatencyMs <= config.maxTotalLatencyMs) {
    score += 8;
    positive.push("acceptable latency");
  } else {
    score -= 18;
    negative.push("high latency");
  }

  if (input.realEdge > config.minRealEdge) {
    score += 12;
    positive.push("positive real edge");
  } else {
    score -= 20;
    negative.push("tiny or negative expected profit");
  }

  if (confirmations.length >= 2) {
    score += 10;
    positive.push("confirmation from more than one source");
  }

  if (input.snapshot && input.snapshot.volumeUsd < config.minMarketVolumeUsd) {
    score -= 8;
    negative.push("market volume below threshold");
  }

  const reasons: string[] = [];
  if (score < config.minSignalScore) reasons.push(`Signal score ${Math.round(score)} is below MIN_SIGNAL_SCORE ${config.minSignalScore}.`);
  if (input.highRisk && confirmations.length < config.highRiskConfirmationCount) {
    reasons.push(`High-risk trade needs at least ${config.highRiskConfirmationCount} confirmations.`);
  }
  if (input.realEdge <= config.minRealEdge) reasons.push("Real edge is not positive enough after costs and latency.");
  if (input.signal && input.signal.traderNotionalUsd < config.minCopyTradeUsd) {
    reasons.push("Source trade is below MIN_COPY_TRADE_USD.");
  }

  return {
    accepted: reasons.length === 0,
    score: Math.round(clamp(score, 0, 100)),
    confirmations,
    reasons,
    positive,
    negative
  };
}

export function shouldSkipSmartCopy(input: {
  signal: CopySignal;
  snapshot: MarketSnapshot;
  latency: LatencyMetrics;
  config: Pick<
    BotConfig,
    | "minTraderScore"
    | "minCopyTradeUsd"
    | "maxCopyPriceDifference"
    | "maxDataAgeMs"
    | "maxTotalLatencyMs"
  >;
}): string[] {
  const reasons: string[] = [];
  const entry = input.snapshot.currentEntryPrice;
  if (input.signal.traderScore < input.config.minTraderScore) reasons.push("Smart copy skipped: trader score is too weak.");
  if (input.signal.traderNotionalUsd < input.config.minCopyTradeUsd) reasons.push("Smart copy skipped: source trade is too small.");
  if (entry !== undefined && Math.abs(entry - input.signal.traderPrice) > input.config.maxCopyPriceDifference) {
    reasons.push("Smart copy skipped: price already moved too far from source trade.");
  }
  if (input.latency.dataAgeMs > input.config.maxDataAgeMs) reasons.push("Smart copy skipped: order book data is stale.");
  if (input.latency.totalLatencyMs > input.config.maxTotalLatencyMs) reasons.push("Smart copy skipped: signal latency is too high.");
  return reasons;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
