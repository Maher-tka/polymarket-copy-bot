import { BotConfig, CopySignal, PositionSizeDecision } from "../types";
import { ClobLiveClient } from "../polymarket/clobLiveClient";

export class LiveTrader {
  private readonly clobLiveClient: ClobLiveClient;

  constructor(private readonly config: BotConfig) {
    this.clobLiveClient = new ClobLiveClient(config);
  }

  async execute(_signal: CopySignal, _size: PositionSizeDecision): Promise<never> {
    // This is the guardrail that matters most in Version 1:
    // even if someone flips LIVE_TRADING=true, this module refuses to place orders.
    if (this.config.paperTradingOnly || !this.config.realTradingEnabled || !this.config.liveTrading || this.config.paperTrading) {
      throw new Error("Live trader is locked. Keep PAPER_TRADING_ONLY=true and REAL_TRADING_ENABLED=false.");
    }

    if (this.config.manualApproval) {
      throw new Error("Manual approval flow is not implemented in Version 1, so live trading is blocked.");
    }

    await this.clobLiveClient.createTradingClient();
    throw new Error("Unreachable: Version 1 never creates live orders.");
  }
}
