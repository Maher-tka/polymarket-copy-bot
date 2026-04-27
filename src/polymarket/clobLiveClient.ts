import { BotConfig } from "../types";

export interface GeoblockResponse {
  blocked: boolean;
  ip?: string;
  country?: string;
  region?: string;
}

export class ClobLiveClient {
  private readonly liveTradingAllowedInVersion1 = false;

  constructor(private readonly config: BotConfig) {}

  async getGeoblockStatus(): Promise<GeoblockResponse> {
    const response = await fetch("https://polymarket.com/api/geoblock");
    if (!response.ok) {
      throw new Error(`Could not check Polymarket geoblock status: ${response.status}`);
    }
    return response.json() as Promise<GeoblockResponse>;
  }

  async createTradingClient(): Promise<never> {
    // Version 1 intentionally refuses to construct a live trading client.
    // The dynamic SDK import belongs here, and only here, when a future version
    // enables real orders after explicit review.
    if (!this.liveTradingAllowedInVersion1) {
      throw new Error("Live trading is disabled in Version 1. No CLOB SDK client was created.");
    }

    if (!this.config.liveTrading || this.config.paperTrading) {
      throw new Error("Live trading requires LIVE_TRADING=true and PAPER_TRADING=false.");
    }

    const geo = await this.getGeoblockStatus();
    if (geo.blocked) {
      throw new Error(`Polymarket trading is geoblocked for country=${geo.country} region=${geo.region}.`);
    }

    throw new Error("Live trading implementation is intentionally unavailable in Version 1.");
  }
}
