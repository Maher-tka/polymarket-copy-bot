import { EventEmitter } from "events";
import { BotConfig, CopySignal, TraderScore } from "../types";
import { DataClient } from "../polymarket/dataClient";
import { logger } from "../logger";
import { createCopySignal } from "../strategy/copySignal";
import { BotStatus } from "../botStatus";

type SignalHandler = (signal: CopySignal) => Promise<void>;

export class WalletWatcher extends EventEmitter {
  private timer?: NodeJS.Timeout;
  private readonly seenTradeIds = new Set<string>();
  private hasSeeded = false;

  constructor(
    private readonly dataClient: DataClient,
    private watchedTraders: TraderScore[],
    private readonly config: Pick<BotConfig, "traderPollIntervalSeconds" | "replayRecentTradesOnStart">,
    private readonly status?: BotStatus
  ) {
    super();
  }

  async start(onSignal: SignalHandler): Promise<void> {
    this.status?.setWalletWatcherActive(true);
    this.status?.setWatchedWalletCount(this.watchedTraders.length);

    logger.info("Starting wallet watcher.", {
      wallets: this.watchedTraders.map((trader) => trader.wallet),
      pollSeconds: this.config.traderPollIntervalSeconds
    });

    await this.pollOnce(onSignal);
    this.timer = setInterval(() => {
      this.pollOnce(onSignal).catch((error) => {
        logger.error("Wallet watcher poll failed.", { error: error instanceof Error ? error.message : String(error) });
      });
    }, this.config.traderPollIntervalSeconds * 1000);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.status?.setWalletWatcherActive(false);
  }

  replaceWatchedTraders(traders: TraderScore[]): void {
    this.watchedTraders = traders;
    this.status?.setWatchedWalletCount(traders.length);
    logger.info("Wallet watcher refreshed watched trader list.", {
      wallets: traders.map((trader) => trader.wallet),
      count: traders.length
    });
  }

  async pollOnce(onSignal: SignalHandler): Promise<void> {
    this.status?.setLastPollTime();

    for (const trader of this.watchedTraders) {
      const trades = await this.dataClient.getTrades({ user: trader.wallet, limit: 25 });
      const newestFirst = trades.filter(Boolean);

      if (!this.hasSeeded && !this.config.replayRecentTradesOnStart) {
        for (const trade of newestFirst) this.seenTradeIds.add(stableTradeId(trade));
        continue;
      }

      const newTrades = newestFirst
        .filter((trade) => !this.seenTradeIds.has(stableTradeId(trade)))
        .sort((a, b) => a.timestamp - b.timestamp);

      for (const trade of newTrades) {
        this.seenTradeIds.add(stableTradeId(trade));
        const signal = createCopySignal(trade, trader);
        if (!signal) continue;
        this.status?.setLastNewTradeDetected();
        this.emit("signal", signal);
        await onSignal(signal);
      }
    }

    if (!this.hasSeeded) {
      this.hasSeeded = true;
      logger.info(
        this.config.replayRecentTradesOnStart
          ? "Initial poll replayed recent public trades into paper mode."
          : "Initial poll seeded existing trades. Waiting for new watched-wallet trades."
      );
    }
  }
}

function stableTradeId(trade: {
  transactionHash?: string;
  proxyWallet?: string;
  conditionId?: string;
  asset?: string;
  side?: string;
  timestamp?: number;
  size?: number;
  price?: number;
}): string {
  return (
    trade.transactionHash ||
    [
      trade.proxyWallet,
      trade.conditionId,
      trade.asset,
      trade.side,
      trade.timestamp,
      trade.size,
      trade.price
    ].join(":")
  );
}
