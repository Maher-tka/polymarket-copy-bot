export interface SignalThrottleConfig {
  maxSignalsPerMinute: number;
  maxTradesPerMinute: number;
  maxActiveMarkets: number;
  lossCooldownSeconds: number;
}

export class SignalThrottle {
  private readonly signalTimes: number[] = [];
  private readonly tradeTimes: number[] = [];
  private readonly repeatedSignals = new Map<string, number>();
  private lossCooldownUntilMs = 0;

  constructor(private readonly config: SignalThrottleConfig) {}

  evaluateSignal(marketKey: string, activeMarkets: string[] = [], nowMs = Date.now()): string[] {
    this.prune(nowMs);
    const reasons: string[] = [];
    if (this.signalTimes.length >= this.config.maxSignalsPerMinute) {
      reasons.push("Signal throttle: MAX_SIGNALS_PER_MINUTE reached.");
    }
    if (new Set(activeMarkets).size > this.config.maxActiveMarkets) {
      reasons.push("Signal throttle: MAX_ACTIVE_MARKETS reached.");
    }
    const repeatedCount = this.repeatedSignals.get(marketKey) ?? 0;
    if (repeatedCount >= 5) {
      reasons.push("Signal throttle: repeated low-quality signal for same market.");
    }
    if (nowMs < this.lossCooldownUntilMs) {
      reasons.push("Signal throttle: cooldown active after loss streak.");
    }
    return reasons;
  }

  recordSignal(marketKey: string, accepted: boolean, nowMs = Date.now()): void {
    this.prune(nowMs);
    this.signalTimes.push(nowMs);
    if (!accepted) this.repeatedSignals.set(marketKey, (this.repeatedSignals.get(marketKey) ?? 0) + 1);
    else this.repeatedSignals.delete(marketKey);
  }

  evaluateTrade(nowMs = Date.now()): string[] {
    this.prune(nowMs);
    return this.tradeTimes.length >= this.config.maxTradesPerMinute
      ? ["Trade throttle: MAX_TRADES_PER_MINUTE reached."]
      : [];
  }

  recordTrade(nowMs = Date.now()): void {
    this.prune(nowMs);
    this.tradeTimes.push(nowMs);
  }

  startLossCooldown(nowMs = Date.now()): void {
    this.lossCooldownUntilMs = nowMs + this.config.lossCooldownSeconds * 1000;
  }

  private prune(nowMs: number): void {
    const cutoff = nowMs - 60_000;
    while (this.signalTimes[0] !== undefined && this.signalTimes[0] < cutoff) this.signalTimes.shift();
    while (this.tradeTimes[0] !== undefined && this.tradeTimes[0] < cutoff) this.tradeTimes.shift();
  }
}
