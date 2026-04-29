import { describe, expect, it } from "vitest";
import { evaluateSafeSell, PositionManager } from "../src/execution/positionManager";

const holdings = [{ marketId: "market-1", tokenSide: "YES" as const, shares: 10 }];

describe("positionManager", () => {
  it("rejects an exit when the position is missing", () => {
    const result = evaluateSafeSell(holdings, { marketId: "market-2", tokenSide: "YES", sellShares: 1 });

    expect(result.accepted).toBe(false);
    expect(result.reasons.join(" ")).toContain("missing");
  });

  it("rejects selling more than the current holdings", () => {
    const result = evaluateSafeSell(holdings, { marketId: "market-1", tokenSide: "YES", sellShares: 11 });

    expect(result.accepted).toBe(false);
    expect(result.reasons.join(" ")).toContain("exceeds current holdings");
  });

  it("calculates proportional exits from actual holdings", () => {
    const result = evaluateSafeSell(holdings, { marketId: "market-1", tokenSide: "YES", proportion: 0.25 });

    expect(result.accepted).toBe(true);
    expect(result.sharesToSell).toBe(2.5);
  });

  it("rejects invalid proportional exits", () => {
    const result = evaluateSafeSell(holdings, { marketId: "market-1", tokenSide: "YES", proportion: 1.5 });

    expect(result.accepted).toBe(false);
    expect(result.reasons.join(" ")).toContain("less than or equal to 1");
  });

  it("tracks positions by market_id and token_side", () => {
    const manager = new PositionManager();
    manager.upsert({ marketId: "market-1", tokenSide: "YES", shares: 3 });
    manager.upsert({ marketId: "market-1", tokenSide: "NO", shares: 7 });

    expect(manager.evaluateExit({ marketId: "market-1", tokenSide: "YES", sellShares: 3 }).accepted).toBe(true);
    expect(manager.evaluateExit({ marketId: "market-1", tokenSide: "NO", sellShares: 7 }).accepted).toBe(true);
  });
});
