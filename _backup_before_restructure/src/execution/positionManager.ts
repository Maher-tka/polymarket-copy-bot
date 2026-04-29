export type TokenSide = "YES" | "NO";

export interface PositionLedgerEntry {
  marketId: string;
  tokenSide: TokenSide;
  tokenId?: string;
  shares: number;
}

export interface ExitOrderRequest {
  marketId: string;
  tokenSide: TokenSide;
  sellShares?: number;
  proportion?: number;
}

export interface SafeSellDecision {
  accepted: boolean;
  sharesToSell: number;
  reasons: string[];
  position?: PositionLedgerEntry;
}

export function positionKey(marketId: string, tokenSide: TokenSide): string {
  return `${marketId}:${tokenSide}`;
}

export function evaluateSafeSell(positions: PositionLedgerEntry[], request: ExitOrderRequest): SafeSellDecision {
  const reasons: string[] = [];
  const position = positions.find(
    (item) => item.marketId === request.marketId && item.tokenSide === request.tokenSide
  );

  if (!position) {
    reasons.push("Position is missing for market_id and token_side.");
    return { accepted: false, sharesToSell: 0, reasons };
  }

  if (!Number.isFinite(position.shares) || position.shares <= 0) {
    reasons.push("Current holdings are zero or invalid.");
  }

  const hasExplicitShares = request.sellShares !== undefined;
  const hasProportion = request.proportion !== undefined;
  if (hasExplicitShares === hasProportion) {
    reasons.push("Exit request must provide exactly one of sellShares or proportion.");
  }

  let sharesToSell = 0;
  if (hasExplicitShares) {
    sharesToSell = Number(request.sellShares);
  } else if (hasProportion) {
    const proportion = Number(request.proportion);
    if (!Number.isFinite(proportion) || proportion <= 0 || proportion > 1) {
      reasons.push("Proportional exit must be greater than 0 and less than or equal to 1.");
    } else {
      sharesToSell = position.shares * proportion;
    }
  }

  if (!Number.isFinite(sharesToSell) || sharesToSell <= 0) {
    reasons.push("Sell size is missing, zero, or invalid.");
  }

  if (sharesToSell > position.shares) {
    reasons.push("Sell size exceeds current holdings.");
  }

  return {
    accepted: reasons.length === 0,
    sharesToSell: reasons.length === 0 ? roundShares(sharesToSell) : 0,
    reasons,
    position
  };
}

export class PositionManager {
  private readonly positions = new Map<string, PositionLedgerEntry>();

  upsert(position: PositionLedgerEntry): void {
    this.positions.set(positionKey(position.marketId, position.tokenSide), { ...position });
  }

  remove(marketId: string, tokenSide: TokenSide): void {
    this.positions.delete(positionKey(marketId, tokenSide));
  }

  list(): PositionLedgerEntry[] {
    return [...this.positions.values()].map((position) => ({ ...position }));
  }

  evaluateExit(request: ExitOrderRequest): SafeSellDecision {
    return evaluateSafeSell(this.list(), request);
  }
}

function roundShares(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
