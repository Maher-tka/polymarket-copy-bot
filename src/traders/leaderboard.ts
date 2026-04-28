import { BotConfig, LeaderboardTrader, TraderScore } from "../types";
import { DataClient } from "../polymarket/dataClient";
import { logger } from "../logger";
import { decayTraderScore, scoreTrader } from "./traderScorer";

const WALLET_PATTERN = /^0x[a-fA-F0-9]{40}$/;

export class LeaderboardService {
  constructor(
    private readonly dataClient: DataClient,
    private readonly config: Pick<
      BotConfig,
      | "watchedWallets"
      | "leaderboardLimit"
      | "maxWatchedTraders"
      | "minTraderScore"
      | "traderScoreDecayAfterMinutes"
      | "traderScoreDecayPerHour"
    >
  ) {}

  async selectWatchedTraders(): Promise<TraderScore[]> {
    const candidates =
      this.config.watchedWallets.length > 0
        ? this.config.watchedWallets.map((wallet, index) => syntheticLeaderboardTrader(wallet, index))
        : await this.dataClient.getLeaderboard({
            timePeriod: "ALL",
            orderBy: "PNL",
            limit: this.config.leaderboardLimit
          });

    const validCandidates = candidates.filter((trader) => {
      const valid = WALLET_PATTERN.test(trader.proxyWallet);
      if (!valid) logger.warn("Skipping invalid wallet address.", { wallet: trader.proxyWallet });
      return valid;
    });

    const scored: TraderScore[] = [];

    // Beginner note: this fetches public trader history and turns it into a 0-100 score.
    for (const trader of validCandidates) {
      try {
        const [trades, positions, closedPositions] = await Promise.all([
          this.dataClient.getTrades({ user: trader.proxyWallet, limit: 100 }),
          this.dataClient.getPositions(trader.proxyWallet, 100),
          this.dataClient.getClosedPositions(trader.proxyWallet, 100)
        ]);

        scored.push(decayTraderScore(scoreTrader({ leaderboardTrader: trader, trades, positions, closedPositions }), this.config));
      } catch (error) {
        logger.warn("Could not score trader from public APIs.", {
          wallet: trader.proxyWallet,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    const sorted = scored.sort((a, b) => b.score - a.score);
    const eligible =
      this.config.watchedWallets.length > 0
        ? sorted
        : sorted.filter((trader) => trader.score >= this.config.minTraderScore);

    return eligible.slice(0, this.config.maxWatchedTraders);
  }
}

function syntheticLeaderboardTrader(wallet: string, index: number): LeaderboardTrader {
  return {
    rank: String(index + 1),
    proxyWallet: wallet,
    userName: `Configured wallet ${index + 1}`,
    vol: 0,
    pnl: 0
  };
}
