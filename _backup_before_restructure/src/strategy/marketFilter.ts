import { BotConfig, CopySignal, FilterDecision, MarketSnapshot } from "../types";

export class MarketFilter {
  constructor(
    private readonly config: Pick<
      BotConfig,
      | "minTraderScore"
      | "minMarketVolumeUsd"
      | "maxSpread"
      | "maxEntryPrice"
      | "minEntryPrice"
      | "maxCopyPriceDifference"
      | "copyDelayLimitSeconds"
      | "maxTradeUsd"
    >
  ) {}

  evaluate(signal: CopySignal, snapshot: MarketSnapshot): FilterDecision {
    const reasons: string[] = [];
    const entryPrice = snapshot.currentEntryPrice;

    if (signal.traderScore < this.config.minTraderScore) {
      reasons.push(`Trader score ${signal.traderScore} is below MIN_TRADER_SCORE ${this.config.minTraderScore}.`);
    }

    if (!snapshot.market) {
      reasons.push("Market metadata could not be loaded from Gamma API.");
    } else {
      if (snapshot.market.closed) reasons.push("Market is closed.");
      if (snapshot.market.active === false) reasons.push("Market is not active.");
      if (snapshot.market.enableOrderBook === false) reasons.push("Market does not have order book trading enabled.");
    }

    if (snapshot.volumeUsd < this.config.minMarketVolumeUsd) {
      reasons.push(`Market volume $${snapshot.volumeUsd.toFixed(2)} is below MIN_MARKET_VOLUME_USD.`);
    }

    if (!Number.isFinite(snapshot.spread) || snapshot.spread > this.config.maxSpread) {
      reasons.push(`Spread ${formatNumber(snapshot.spread)} is above MAX_SPREAD ${this.config.maxSpread}.`);
    }

    if (entryPrice === undefined || !Number.isFinite(entryPrice)) {
      reasons.push("No usable best bid/ask price in the CLOB order book.");
    } else {
      if (entryPrice > this.config.maxEntryPrice) {
        reasons.push(`Entry price ${entryPrice.toFixed(3)} is above MAX_ENTRY_PRICE.`);
      }
      if (entryPrice < this.config.minEntryPrice) {
        reasons.push(`Entry price ${entryPrice.toFixed(3)} is below MIN_ENTRY_PRICE.`);
      }

      const priceDifference = Math.abs(entryPrice - signal.traderPrice);
      if (priceDifference > this.config.maxCopyPriceDifference) {
        reasons.push(
          `Current price moved ${priceDifference.toFixed(3)} from trader price; above MAX_COPY_PRICE_DIFFERENCE.`
        );
      }
    }

    if (signal.copyDelaySeconds > this.config.copyDelayLimitSeconds) {
      reasons.push(`Copy delay ${signal.copyDelaySeconds}s is above COPY_DELAY_LIMIT_SECONDS.`);
    }

    if (snapshot.availableLiquidityUsd < Math.min(this.config.maxTradeUsd, signal.traderNotionalUsd)) {
      reasons.push("Not enough visible order book liquidity within the max copy price difference.");
    }

    return {
      accepted: reasons.length === 0,
      reasons,
      currentEntryPrice: entryPrice,
      availableLiquidityUsd: snapshot.availableLiquidityUsd
    };
  }
}

function formatNumber(value: number): string {
  return Number.isFinite(value) ? value.toFixed(3) : "unknown";
}
