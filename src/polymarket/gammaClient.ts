import { BotConfig, GammaMarket } from "../types";

export class GammaClient {
  constructor(private readonly config: Pick<BotConfig, "gammaApi">) {}

  async listMarkets(params: Record<string, string | number | boolean | undefined> = {}): Promise<GammaMarket[]> {
    return this.request<GammaMarket[]>("/markets", params);
  }

  async getMarketById(id: string | number): Promise<GammaMarket> {
    return this.request<GammaMarket>(`/markets/${id}`);
  }

  async getMarketBySlug(slug: string): Promise<GammaMarket | undefined> {
    if (!slug) return undefined;

    try {
      return await this.request<GammaMarket>(`/markets/slug/${encodeURIComponent(slug)}`);
    } catch {
      // The slug endpoint is official, but this fallback keeps the bot usable if
      // a deployment only supports query-style lookup.
      const markets = await this.listMarkets({ slug, limit: 1 });
      return markets[0];
    }
  }

  private async request<T>(
    path: string,
    params: Record<string, string | number | boolean | undefined> = {}
  ): Promise<T> {
    const url = new URL(path, this.config.gammaApi);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Gamma API ${response.status} ${response.statusText}: ${url.toString()}`);
    }

    return response.json() as Promise<T>;
  }
}
