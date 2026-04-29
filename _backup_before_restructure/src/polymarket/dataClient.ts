import {
  BotConfig,
  DataApiClosedPosition,
  DataApiPosition,
  DataApiTrade,
  LeaderboardTrader,
  TradeSide
} from "../types";

export interface LeaderboardParams {
  category?: string;
  timePeriod?: "DAY" | "WEEK" | "MONTH" | "ALL";
  orderBy?: "PNL" | "VOL";
  limit?: number;
  offset?: number;
  user?: string;
}

export interface TradeParams {
  user?: string;
  market?: string[];
  limit?: number;
  offset?: number;
  side?: TradeSide;
  takerOnly?: boolean;
}

export class DataClient {
  constructor(private readonly config: Pick<BotConfig, "dataApi">) {}

  async getLeaderboard(params: LeaderboardParams = {}): Promise<LeaderboardTrader[]> {
    return this.request<LeaderboardTrader[]>("/v1/leaderboard", {
      timePeriod: params.timePeriod ?? "ALL",
      orderBy: params.orderBy ?? "PNL",
      limit: params.limit ?? 25,
      offset: params.offset ?? 0,
      category: params.category,
      user: params.user
    });
  }

  async getTrades(params: TradeParams = {}): Promise<DataApiTrade[]> {
    return this.request<DataApiTrade[]>("/trades", {
      user: params.user,
      market: params.market?.join(","),
      limit: params.limit ?? 100,
      offset: params.offset ?? 0,
      side: params.side,
      takerOnly: params.takerOnly ?? true
    });
  }

  async getPositions(user: string, limit = 100): Promise<DataApiPosition[]> {
    return this.request<DataApiPosition[]>("/positions", {
      user,
      limit,
      offset: 0,
      sizeThreshold: 0
    });
  }

  async getClosedPositions(user: string, limit = 100): Promise<DataApiClosedPosition[]> {
    return this.request<DataApiClosedPosition[]>("/closed-positions", {
      user,
      limit,
      offset: 0
    });
  }

  private async request<T>(
    path: string,
    params: Record<string, string | number | boolean | undefined> = {}
  ): Promise<T> {
    const url = new URL(path, this.config.dataApi);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Data API ${response.status} ${response.statusText}: ${url.toString()}`);
    }

    return response.json() as Promise<T>;
  }
}
