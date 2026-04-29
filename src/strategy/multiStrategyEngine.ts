import { logger } from "../logger";
import { ClobPublicClient } from "../polymarket/clobPublicClient";
import { DataClient } from "../polymarket/dataClient";
import { GammaClient } from "../polymarket/gammaClient";
import { PaperExecutionLayer, StrategyExecutionPort } from "../execution/executionLayer";
import { PaperLearningOptimizer } from "../learning/paperLearningOptimizer";
import { StrategyRiskManager } from "../risk/strategyRiskManager";
import { LocalDatabase } from "../storage/localDatabase";
import { StrategyPaperTrader } from "../trading/strategyPaperTrader";
import { Portfolio } from "../trading/portfolio";
import { BinaryMarketCandidate, BotConfig, StrategyEngineState } from "../types";
import { MakerArbitrageMode } from "./makerArbitrageMode";
import { MarketMakingMode } from "./marketMakingMode";
import { NetArbitrageScanner } from "./netArbitrageScanner";
import {
  isCryptoUpDownMarket,
  isFiveOrFifteenMinuteCryptoMarket,
  isInsideCandidateFinalEntryWindow,
  isShortTermCryptoBinaryMarket,
  parseBinaryMarket,
  simulateOrderBookFill
} from "./orderBookMath";
import { StrategyStateStore } from "./strategyState";
import { WhaleTracker } from "./whaleTracker";
import { MarketEventQueue, scoreEvent } from "./eventQueue";
import { OrderBookCache } from "./orderBookCache";
import { QuoteDaemon } from "../marketData/quoteDaemon";

export class MultiStrategyEngine {
  private readonly database = new LocalDatabase();
  private readonly store: StrategyStateStore;
  private readonly execution: StrategyExecutionPort;
  private readonly learning: PaperLearningOptimizer;
  private readonly netArb: NetArbitrageScanner;
  private readonly makerArb: MakerArbitrageMode;
  private readonly marketMaking: MarketMakingMode;
  private readonly whaleTracker: WhaleTracker;
  private readonly eventQueue = new MarketEventQueue();
  private readonly orderBookCache: OrderBookCache;
  private timers: NodeJS.Timeout[] = [];
  private marketCache: BinaryMarketCandidate[] = [];
  private lastMarketLoadAt = 0;

  constructor(
    private readonly deps: {
      config: BotConfig;
      gammaClient: GammaClient;
      dataClient: DataClient;
      clobClient: ClobPublicClient;
      portfolio: Portfolio;
      strategyRisk: StrategyRiskManager;
      quoteDaemon?: QuoteDaemon;
      marketWebSocket?: { subscribe(assetIds: string[]): void; setSubscriptions?(assetIds: string[]): void };
    }
  ) {
    this.store = new StrategyStateStore(this.database, {
      realTradingEnabled: deps.config.realTradingEnabled,
      recorderEnabled: deps.config.recorderEnabled,
      backtestMode: deps.config.backtestMode
    });
    this.execution = new PaperExecutionLayer({ strategyTrader: new StrategyPaperTrader(this.store) });
    this.learning = new PaperLearningOptimizer(deps.config);
    this.orderBookCache = new OrderBookCache(deps.clobClient, {
      maxDataAgeMs: deps.config.maxDataAgeMs,
      maxQuoteDelayMs: deps.config.maxQuoteDelayMs,
      eventQueue: this.eventQueue,
      quoteDaemon: deps.quoteDaemon
    });
    const cachedClob = {
      getOrderBook: async (tokenId: string) => (await this.orderBookCache.getFreshOrderBook(tokenId)).book,
      getOrderBooks: async (tokenIds: string[]) => this.orderBookCache.getFreshOrderBooks(tokenIds)
    };
    this.netArb = new NetArbitrageScanner(
      cachedClob,
      this.store,
      this.execution,
      deps.strategyRisk,
      deps.config
    );
    this.makerArb = new MakerArbitrageMode(cachedClob, this.store, this.execution, deps.config);
    this.marketMaking = new MarketMakingMode(cachedClob, this.store, this.execution, deps.config);
    this.whaleTracker = new WhaleTracker(deps.dataClient, cachedClob, this.store, this.execution, deps.config, this.eventQueue);
  }

  async start(): Promise<void> {
    logger.info("Starting multi-strategy paper engine.", {
      realTradingEnabled: this.deps.config.realTradingEnabled,
      realTradingRequiresUiConfirmation: this.deps.config.realTradingRequiresUiConfirmation
    });

    await this.runScannerTick();
    await this.runWhaleTick();

    this.timers.push(setInterval(() => this.runScannerTick().catch((error) => this.logError(error)), this.deps.config.arbitrageScanIntervalSeconds * 1000));
    this.timers.push(setInterval(() => this.runMakerTick().catch((error) => this.logError(error)), this.deps.config.arbitrageScanIntervalSeconds * 1000));
    this.timers.push(setInterval(() => this.runMarketMakingTick().catch((error) => this.logError(error)), this.deps.config.marketMakingIntervalSeconds * 1000));
    this.timers.push(setInterval(() => this.runWhaleTick().catch((error) => this.logError(error)), this.deps.config.whalePollIntervalSeconds * 1000));
    this.timers.push(setInterval(() => this.execution.settleAgedStrategyTrades(this.deps.config.paperAutoSettleSeconds), 5_000));
    this.timers.push(setInterval(() => this.runForcedCloseRiskCheck().catch((error) => this.logError(error)), 5_000));
    this.timers.push(setInterval(() => this.refreshLearning(), 5_000));
  }

  stop(): void {
    for (const timer of this.timers) clearInterval(timer);
    this.timers = [];
  }

  getState(): StrategyEngineState {
    const state = this.store.getState();
    return { ...state, learning: this.learning.getState(), marketEvents: this.eventQueue.peek(100) };
  }

  exportCsv(): string {
    return this.database.exportPaperTradesCsv(this.getState());
  }

  setEmergencyStopped(stopped: boolean): void {
    this.store.setEmergencyStopped(stopped);
    logger.warn(stopped ? "Strategy emergency stop activated." : "Strategy emergency stop cleared.");
  }

  setRealTradingUiConfirmed(confirmed: boolean): void {
    if (confirmed && !this.deps.config.realTradingEnabled) {
      logger.warn("UI real-trading confirmation ignored because REAL_TRADING_ENABLED=false.");
      this.store.setRealTradingUiConfirmed(false);
      return;
    }
    this.store.setRealTradingUiConfirmed(confirmed);
    logger.warn(confirmed ? "Real-trading UI confirmation set." : "Real-trading UI confirmation cleared.");
  }

  observeMarketWebSocketMessage(message: unknown): void {
    this.orderBookCache.observeWebSocketMessage(message);
  }

  private async runScannerTick(): Promise<void> {
    this.refreshLearning();
    if (!this.learning.shouldRun("net-arbitrage")) return;
    const candidates = await this.loadMarketCandidates();
    if (!this.shouldRunForEvents(["spread-tightened", "freshness-restored", "price-jump", "copy-signal"], candidates)) return;
    await this.netArb.scan(candidates, this.deps.portfolio.getSnapshot());
    await this.recordSnapshots(candidates.slice(0, 4));
  }

  private async runMakerTick(): Promise<void> {
    this.refreshLearning();
    if (!this.learning.shouldRun("maker-arbitrage")) return;
    const candidates = await this.loadMarketCandidates();
    if (!this.shouldRunForEvents(["spread-tightened", "freshness-restored", "price-jump"], candidates)) return;
    await this.makerArb.tick(candidates, this.deps.portfolio.getSnapshot());
  }

  private async runMarketMakingTick(): Promise<void> {
    this.refreshLearning();
    if (!this.learning.shouldRun("market-making")) return;
    const candidates = await this.loadMarketCandidates();
    if (!this.shouldRunForEvents(["spread-tightened", "freshness-restored", "liquidity-drop"], candidates)) return;
    await this.marketMaking.tick(candidates, this.deps.portfolio.getSnapshot());
  }

  private async runWhaleTick(): Promise<void> {
    this.refreshLearning();
    if (!this.learning.shouldRun("whale-tracker")) return;
    await this.whaleTracker.poll(this.deps.portfolio.getSnapshot());
  }

  private refreshLearning(): void {
    const before = this.learning.getState();
    const next = this.learning.evaluate(this.store.getState());
    const previousAdjustments = new Set(before.appliedAdjustments.map((adjustment) => JSON.stringify(adjustment)));
    for (const adjustment of next.appliedAdjustments.filter((item) => !previousAdjustments.has(JSON.stringify(item)))) {
      logger.info("Paper learning applied tuning.", adjustment);
    }
    const newlyDisabled = next.disabledStrategies.filter((strategy) => !before.disabledStrategies.includes(strategy));
    if (newlyDisabled.length > 0) {
      logger.warn("Paper learning paused losing strategy execution.", { strategies: newlyDisabled });
    }
  }

  private async loadMarketCandidates(): Promise<BinaryMarketCandidate[]> {
    const cacheAge = Date.now() - this.lastMarketLoadAt;
    if (this.marketCache.length > 0 && cacheAge < 60_000) {
      const activeCache = this.pruneInactiveMarketCache();
      if (activeCache.length > 0) return activeCache;
    }

    const markets = await this.deps.gammaClient.listMarkets({
      active: true,
      closed: false,
      limit: 1000,
      order: "volume24hr",
      ascending: false
    });

    const orderBookMarkets = markets.filter(
      (market) => market.active !== false && !market.closed && market.enableOrderBook !== false
    );
    const upDownCandidates = orderBookMarkets
      .filter((market) => market.active !== false && !market.closed && market.enableOrderBook !== false)
      .filter(isCryptoUpDownMarket)
      .map(parseBinaryMarket)
      .filter((candidate): candidate is BinaryMarketCandidate => Boolean(candidate))
      .sort((a, b) => b.volumeUsd - a.volumeUsd);
    const broaderCryptoCandidates = orderBookMarkets
      .filter(isShortTermCryptoBinaryMarket)
      .map(parseBinaryMarket)
      .filter((candidate): candidate is BinaryMarketCandidate => Boolean(candidate))
      .sort((a, b) => b.volumeUsd - a.volumeUsd);
    const fallbackCryptoCandidates = this.deps.config.strategyLabAllMarkets ? broaderCryptoCandidates : [];
    const allLiquidCandidates = this.deps.config.strategyLabAllMarkets
      ? orderBookMarkets
          .map(parseBinaryMarket)
          .filter((candidate): candidate is BinaryMarketCandidate => Boolean(candidate))
          .filter((candidate) => candidate.volumeUsd >= this.deps.config.minMarketVolumeUsd)
          .sort((a, b) => b.volumeUsd - a.volumeUsd)
      : [];

    const recentTradeCandidates = await this.loadCandidatesFromRecentTrades();
    const byCondition = new Map<string, BinaryMarketCandidate>();
    // Up/Down markets are preferred, then liquid paper-lab markets. The broad
    // universe is paper-only and helps prove whether a >60% strategy is market
    // structure edge or just crypto-specific noise.
    for (const candidate of [...upDownCandidates, ...allLiquidCandidates, ...fallbackCryptoCandidates, ...recentTradeCandidates]) {
      byCondition.set(candidate.conditionId, candidate);
    }

    const rawCandidates = [...byCondition.values()];
    this.marketCache = rawCandidates
      .filter(isFiveOrFifteenMinuteCryptoMarket)
      .filter((candidate) => !isInsideCandidateFinalEntryWindow(candidate, this.deps.config.finalEntryBufferSeconds))
      .sort((a, b) => b.volumeUsd - a.volumeUsd)
      .slice(0, Math.max(1, Math.floor(this.deps.config.maxActiveMarkets)));
    const tokenIds = this.marketCache.flatMap((candidate) => [candidate.yesTokenId, candidate.noTokenId]);
    this.syncMarketDataSubscriptions(tokenIds);
    await this.waitForQuoteWarmup(tokenIds);
    for (const candidate of this.marketCache.slice(0, 20)) {
      this.eventQueue.enqueue({
        type: "freshness-restored",
        priority: scoreEvent("freshness-restored", 0),
        conditionId: candidate.conditionId,
        tokenId: candidate.yesTokenId,
        marketTitle: candidate.title,
        reason: "Market candidate loaded for event-driven paper scan.",
        liquidityUsd: candidate.liquidityUsd
      });
    }

    this.lastMarketLoadAt = Date.now();
    logger.info("Multi-strategy market universe loaded.", {
      actionableCandidates: this.marketCache.length,
      filteredFinalWindowCandidates: rawCandidates.length - this.marketCache.length,
      allLiquidCandidates: allLiquidCandidates.length,
      gammaCandidates: fallbackCryptoCandidates.length,
      upDownCandidates: upDownCandidates.length,
      recentTradeCandidates: recentTradeCandidates.length
    });
    return this.marketCache;
  }

  private pruneInactiveMarketCache(): BinaryMarketCandidate[] {
    const active = this.marketCache.filter(
      (candidate) => !isInsideCandidateFinalEntryWindow(candidate, this.deps.config.finalEntryBufferSeconds)
    );
    if (active.length !== this.marketCache.length) {
      this.marketCache = active;
      this.syncMarketDataSubscriptions(active.flatMap((candidate) => [candidate.yesTokenId, candidate.noTokenId]));
    }
    return this.marketCache;
  }

  private syncMarketDataSubscriptions(tokenIds: string[]): void {
    this.deps.quoteDaemon?.setSubscriptions(tokenIds);
    if (this.deps.marketWebSocket?.setSubscriptions) {
      this.deps.marketWebSocket.setSubscriptions(tokenIds);
    } else {
      this.deps.marketWebSocket?.subscribe(tokenIds);
    }
  }

  private async loadCandidatesFromRecentTrades(): Promise<BinaryMarketCandidate[]> {
    const candidates: BinaryMarketCandidate[] = [];
    const trades = await this.deps.dataClient.getTrades({ limit: 120, takerOnly: true });
    const seen = new Set<string>();

    for (const trade of trades) {
      const text = `${trade.title ?? ""} ${trade.slug ?? ""}`.toLowerCase();
      const looksCryptoUpDown =
        (text.includes("bitcoin") || text.includes("btc") || text.includes("ethereum") || text.includes("eth")) &&
        (text.includes("up or down") ||
          text.includes("updown") ||
          text.includes("above") ||
          text.includes("below") ||
          text.includes("reach") ||
          text.includes("hit") ||
          text.includes("dip"));
      if (!looksCryptoUpDown || seen.has(trade.conditionId)) continue;

      try {
        const marketByToken = await this.deps.clobClient.getMarketByToken(trade.asset);
        seen.add(trade.conditionId);
        const candidate = {
          conditionId: marketByToken.condition_id || trade.conditionId,
          slug: trade.slug,
          title: trade.title,
          volumeUsd: Number(trade.price) * Number(trade.size),
          liquidityUsd: 0,
          yesTokenId: marketByToken.primary_token_id,
          noTokenId: marketByToken.secondary_token_id,
          yesOutcome: trade.outcomeIndex === 0 ? trade.outcome ?? "Up" : "Up",
          noOutcome: trade.outcomeIndex === 1 ? trade.outcome ?? "Down" : "Down",
          endDate: marketByToken.end_date_iso ?? marketByToken.end_date
        };
        if (!isFiveOrFifteenMinuteCryptoMarket(candidate)) continue;
        candidates.push(candidate);
      } catch (error) {
        logger.debug("Could not build crypto Up/Down candidate from recent trade.", {
          market: trade.title,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    return candidates;
  }

  private async waitForQuoteWarmup(tokenIds: string[]): Promise<void> {
    const quoteDaemon = this.deps.quoteDaemon;
    const uniqueTokenIds = [...new Set(tokenIds.filter(Boolean))];
    if (!quoteDaemon || uniqueTokenIds.length === 0) return;

    const minimumFreshQuotes = Math.max(2, Math.ceil(uniqueTokenIds.length * 0.75));
    const deadline = Date.now() + Math.min(2_000, Math.max(500, this.deps.config.maxDataAgeMs));
    while (Date.now() < deadline) {
      const freshQuotes = uniqueTokenIds.filter((tokenId) => quoteDaemon.getQuote(tokenId)?.isFresh).length;
      if (freshQuotes >= minimumFreshQuotes) return;
      await sleep(100);
    }

    logger.debug("Quote warmup finished before all active assets were fresh.", {
      freshQuotes: uniqueTokenIds.filter((tokenId) => quoteDaemon.getQuote(tokenId)?.isFresh).length,
      totalAssets: uniqueTokenIds.length,
      minimumFreshQuotes
    });
  }

  private async runForcedCloseRiskCheck(): Promise<void> {
    const state = this.store.getState();
    for (const trade of state.paperTrades) {
      if (trade.closedAt || !trade.marketEndDate || trade.side === "ARBITRAGE_PAIR") continue;
      const secondsToClose = (new Date(trade.marketEndDate).getTime() - Date.now()) / 1000;
      if (!Number.isFinite(secondsToClose) || secondsToClose > this.deps.config.forcedRiskCheckSeconds) continue;

      const exitTokenId = trade.side === "BUY" ? trade.yesTokenId : trade.noTokenId;
      if (!exitTokenId) {
        this.store.addDiagnostic({
          id: `diag-close-risk-${trade.id}-${Date.now()}`,
          tradeId: trade.id,
          timestamp: new Date().toISOString(),
          market: trade.marketTitle,
          strategy: trade.strategy,
          accepted: false,
          rejectionReasons: ["Exit impossible / illiquid: missing token id for forced risk check."],
          secondsToClose: Math.max(0, Math.round(secondsToClose)),
          exitLiquidityPoor: true,
          lossCause: "illiquidity",
          createdAt: new Date().toISOString()
        });
        continue;
      }

      try {
        const book = await this.deps.clobClient.getOrderBook(exitTokenId);
        const exitFill = simulateSellExit(book, trade.shares);
        if (exitFill.fillRate < 1) {
          this.store.addDiagnostic({
            id: `diag-close-risk-${trade.id}-${Date.now()}`,
            tradeId: trade.id,
            timestamp: new Date().toISOString(),
            market: trade.marketTitle,
            strategy: trade.strategy,
            accepted: false,
            rejectionReasons: ["Exit impossible / illiquid: visible bids cannot fully exit before close."],
            orderBookDepthUsd: exitFill.depthUsd,
            secondsToClose: Math.max(0, Math.round(secondsToClose)),
            fillRate: exitFill.fillRate,
            partialFill: exitFill.partial,
            exitLiquidityPoor: true,
            lossCause: "illiquidity",
            createdAt: new Date().toISOString()
          });
        }
      } catch (error) {
        logger.warn("Forced close risk check could not read exit book.", {
          tradeId: trade.id,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
  }

  private shouldRunForEvents(types: string[], candidates: BinaryMarketCandidate[]): boolean {
    const events = this.eventQueue.drainMatching(types, 20);
    if (events.length === 0) return candidates.length > 0 && this.marketCache.length === 0;
    return true;
  }

  private async recordSnapshots(candidates: BinaryMarketCandidate[]): Promise<void> {
    if (!this.deps.config.recorderEnabled) return;

    for (const candidate of candidates) {
      try {
        const [yesBook, noBook] = await Promise.all([
          this.deps.clobClient.getOrderBook(candidate.yesTokenId),
          this.deps.clobClient.getOrderBook(candidate.noTokenId)
        ]);
        this.database.recordOrderBookSnapshot({
          market: candidate,
          yesBook,
          noBook
        });
      } catch (error) {
        logger.debug("Recorder skipped order book snapshot.", { error: error instanceof Error ? error.message : String(error) });
      }
    }
  }

  private logError(error: unknown): void {
    const err = error instanceof Error ? error : new Error(String(error));
    const stack = err.stack ? err.stack.split("\n").slice(0, 8).join("\n") : undefined;
    const cause = (err as { cause?: unknown }).cause;
    logger.error("Multi-strategy engine tick failed.", {
      name: err.name,
      message: err.message,
      stack,
      cause: cause instanceof Error ? { name: cause.name, message: cause.message } : cause
    });
  }
}

function simulateSellExit(book: Parameters<typeof simulateOrderBookFill>[0], shares: number) {
  return simulateOrderBookFill(book, "SELL", shares, 0);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
