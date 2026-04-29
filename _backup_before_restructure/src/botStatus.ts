import { BotRuntimeStatus } from "./types";

export class BotStatus {
  private state: BotRuntimeStatus = {
    apiConnected: false,
    walletWatcherActive: false,
    watchedWalletCount: 0,
    marketsLoaded: 0,
    marketWebSocketConnected: false,
    marketWebSocketSubscribedAssets: 0,
    backupPollingConnected: false,
    simulateSignalsEnabled: false,
    telegramConfigured: false
  };

  getSnapshot(): BotRuntimeStatus {
    return { ...this.state };
  }

  setWalletWatcherActive(active: boolean): void {
    this.state.walletWatcherActive = active;
    this.state.backupPollingConnected = active;
  }

  setLastPollTime(date = new Date()): void {
    this.state.lastPollTime = date.toISOString();
  }

  setLastNewTradeDetected(date = new Date()): void {
    this.state.lastNewTradeDetectedAt = date.toISOString();
  }

  setWatchedWalletCount(count: number): void {
    this.state.watchedWalletCount = count;
  }

  setMarketsLoaded(count: number): void {
    this.state.marketsLoaded = count;
  }

  setApiConnected(connected: boolean): void {
    this.state.apiConnected = connected;
  }

  setMarketWebSocketStatus(
    connected: boolean,
    subscribedAssets: number,
    lastMessageAt?: string,
    latencyMs?: number
  ): void {
    this.state.marketWebSocketConnected = connected;
    this.state.marketWebSocketSubscribedAssets = subscribedAssets;
    if (lastMessageAt) this.state.lastMarketWebSocketMessageAt = lastMessageAt;
    if (latencyMs !== undefined) this.state.webSocketLatencyMs = latencyMs;
  }

  setSimulationEnabled(enabled: boolean): void {
    this.state.simulateSignalsEnabled = enabled;
  }

  setLastSimulatedSignal(date = new Date()): void {
    this.state.lastSimulatedSignalAt = date.toISOString();
  }

  setTelegramConfigured(configured: boolean): void {
    this.state.telegramConfigured = configured;
  }
}
