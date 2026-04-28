import { LatencyMetrics } from "../types";

export interface LatencyConfig {
  maxDataAgeMs: number;
  maxTotalLatencyMs: number;
  latencyPenaltyBpsPerSecond: number;
}

export interface LatencyTraceInput {
  dataTimestampMs?: number;
  sourceEventTimestampMs?: number;
  detectedAtMs?: number;
  decisionStartedAtMs?: number;
  decisionCompletedAtMs?: number;
  simulatedExecutionAtMs?: number;
  nowMs?: number;
}

export interface LatencyDecision {
  accepted: boolean;
  reasons: string[];
  metrics: LatencyMetrics;
  penaltyEdge: number;
}

export function buildLatencyMetrics(input: LatencyTraceInput): LatencyMetrics {
  const now = input.nowMs ?? Date.now();
  const detectedAt = input.detectedAtMs ?? now;
  const decisionStartedAt = input.decisionStartedAtMs ?? detectedAt;
  const decisionCompletedAt = input.decisionCompletedAtMs ?? decisionStartedAt;
  const simulatedExecutionAt = input.simulatedExecutionAtMs ?? decisionCompletedAt;
  const sourceEventAt = input.sourceEventTimestampMs ?? detectedAt;
  const dataAgeMs =
    input.dataTimestampMs === undefined ? 0 : Math.max(0, simulatedExecutionAt - input.dataTimestampMs);

  return {
    dataAgeMs,
    signalDetectionLatencyMs: Math.max(0, detectedAt - sourceEventAt),
    decisionLatencyMs: Math.max(0, decisionCompletedAt - decisionStartedAt),
    simulatedExecutionLatencyMs: Math.max(0, simulatedExecutionAt - decisionCompletedAt),
    totalLatencyMs: Math.max(0, simulatedExecutionAt - sourceEventAt)
  };
}

export function evaluateLatency(input: LatencyTraceInput, config: LatencyConfig): LatencyDecision {
  const metrics = buildLatencyMetrics(input);
  const reasons: string[] = [];

  if (metrics.dataAgeMs > config.maxDataAgeMs) {
    reasons.push(`Data age ${Math.round(metrics.dataAgeMs)}ms exceeds MAX_DATA_AGE_MS ${config.maxDataAgeMs}.`);
  }

  if (metrics.totalLatencyMs > config.maxTotalLatencyMs) {
    reasons.push(`Total latency ${Math.round(metrics.totalLatencyMs)}ms exceeds MAX_TOTAL_LATENCY_MS ${config.maxTotalLatencyMs}.`);
  }

  return {
    accepted: reasons.length === 0,
    reasons,
    metrics,
    penaltyEdge: latencyPenaltyEdge(metrics.totalLatencyMs, config.latencyPenaltyBpsPerSecond)
  };
}

export function latencyPenaltyEdge(totalLatencyMs: number, penaltyBpsPerSecond: number): number {
  if (!Number.isFinite(totalLatencyMs) || !Number.isFinite(penaltyBpsPerSecond)) return 0;
  return Math.max(0, (totalLatencyMs / 1000) * (penaltyBpsPerSecond / 10_000));
}

export function applyLatencyPenalty(rawEdge: number, totalLatencyMs: number, penaltyBpsPerSecond: number): number {
  return rawEdge - latencyPenaltyEdge(totalLatencyMs, penaltyBpsPerSecond);
}
