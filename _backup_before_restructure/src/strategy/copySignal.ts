import { CopySignal, DataApiTrade, TraderScore } from "../types";

export function createCopySignal(trade: DataApiTrade, trader: TraderScore): CopySignal | undefined {
  const price = Number(trade.price);
  const size = Number(trade.size);
  const timestampSeconds = normalizeTimestamp(trade.timestamp);

  if (!trade.asset || !trade.conditionId || !Number.isFinite(price) || !Number.isFinite(size)) {
    return undefined;
  }

  const copyDelaySeconds = Math.max(0, Math.floor(Date.now() / 1000 - timestampSeconds));
  const sourceTradeId = trade.transactionHash || `${trade.proxyWallet}:${trade.asset}:${trade.timestamp}:${trade.side}`;

  return {
    id: `signal-${sourceTradeId}`,
    traderWallet: trade.proxyWallet,
    traderName: trader.userName,
    traderScore: trader.score,
    side: trade.side,
    assetId: trade.asset,
    conditionId: trade.conditionId,
    marketSlug: trade.slug,
    marketTitle: trade.title,
    outcome: trade.outcome,
    outcomeIndex: trade.outcomeIndex,
    traderSize: size,
    traderPrice: price,
    traderNotionalUsd: round(price * size),
    traderTradeTimestamp: timestampSeconds,
    copyDelaySeconds,
    createdAt: new Date().toISOString(),
    sourceTradeId
  };
}

function normalizeTimestamp(timestamp: number): number {
  return timestamp > 10_000_000_000 ? Math.floor(timestamp / 1000) : timestamp;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
