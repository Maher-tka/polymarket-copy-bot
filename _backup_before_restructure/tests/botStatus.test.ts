import { describe, expect, it } from "vitest";
import { BotStatus } from "../src/botStatus";

describe("BotStatus", () => {
  it("tracks watcher, market, websocket, and demo status for the dashboard", () => {
    const status = new BotStatus();

    status.setWalletWatcherActive(true);
    status.setWatchedWalletCount(3);
    status.setMarketsLoaded(25);
    status.setMarketWebSocketStatus(true, 2, "2026-04-26T20:00:00.000Z");
    status.setSimulationEnabled(true);
    status.setLastPollTime(new Date("2026-04-26T20:01:00.000Z"));
    status.setLastNewTradeDetected(new Date("2026-04-26T20:02:00.000Z"));
    status.setLastSimulatedSignal(new Date("2026-04-26T20:03:00.000Z"));

    expect(status.getSnapshot()).toMatchObject({
      walletWatcherActive: true,
      backupPollingConnected: true,
      watchedWalletCount: 3,
      marketsLoaded: 25,
      marketWebSocketConnected: true,
      marketWebSocketSubscribedAssets: 2,
      simulateSignalsEnabled: true,
      lastPollTime: "2026-04-26T20:01:00.000Z",
      lastNewTradeDetectedAt: "2026-04-26T20:02:00.000Z",
      lastSimulatedSignalAt: "2026-04-26T20:03:00.000Z"
    });
  });
});
