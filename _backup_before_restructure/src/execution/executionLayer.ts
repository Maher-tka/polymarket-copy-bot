import {
  CopySignal,
  FillSimulation,
  PositionSizeDecision,
  StrategyName,
  StrategyOpportunity,
  StrategyPaperTrade,
  TradeExecutionResult
} from "../types";
import { PaperTrader } from "../trading/paperTrader";
import { StrategyPaperTrader } from "../trading/strategyPaperTrader";

export interface CopyExecutionPort {
  executeCopySignal(signal: CopySignal, entryPrice: number, size: PositionSizeDecision): TradeExecutionResult;
}

export interface StrategyExecutionPort {
  executePairedArbitrage(
    opportunity: StrategyOpportunity,
    yesFill: FillSimulation,
    noFill: FillSimulation,
    strategy?: StrategyName
  ): StrategyPaperTrade;
  executeSingleLeg(
    strategy: StrategyName,
    opportunity: StrategyOpportunity,
    fill: FillSimulation,
    expectedEdgeUsd: number
  ): StrategyPaperTrade;
  settleAgedStrategyTrades(maxAgeSeconds: number): void;
}

export class PaperExecutionLayer implements CopyExecutionPort, StrategyExecutionPort {
  constructor(
    private readonly deps: {
      copyTrader?: PaperTrader;
      strategyTrader?: StrategyPaperTrader;
    }
  ) {}

  executeCopySignal(signal: CopySignal, entryPrice: number, size: PositionSizeDecision): TradeExecutionResult {
    if (!this.deps.copyTrader) {
      throw new Error("Copy paper execution is not configured.");
    }
    return this.deps.copyTrader.execute(signal, entryPrice, size);
  }

  executePairedArbitrage(
    opportunity: StrategyOpportunity,
    yesFill: FillSimulation,
    noFill: FillSimulation,
    strategy?: StrategyName
  ): StrategyPaperTrade {
    return this.strategyTrader().executePairedArbitrage(opportunity, yesFill, noFill, strategy);
  }

  executeSingleLeg(
    strategy: StrategyName,
    opportunity: StrategyOpportunity,
    fill: FillSimulation,
    expectedEdgeUsd: number
  ): StrategyPaperTrade {
    return this.strategyTrader().executeSingleLeg(strategy, opportunity, fill, expectedEdgeUsd);
  }

  settleAgedStrategyTrades(maxAgeSeconds: number): void {
    this.strategyTrader().settleAgedTrades(maxAgeSeconds);
  }

  private strategyTrader(): StrategyPaperTrader {
    if (!this.deps.strategyTrader) {
      throw new Error("Strategy paper execution is not configured.");
    }
    return this.deps.strategyTrader;
  }
}

export class LockedRealExecutionLayer {
  async execute(): Promise<never> {
    throw new Error("Real execution is locked. Keep PAPER_TRADING_ONLY=true and REAL_TRADING_ENABLED=false.");
  }
}
