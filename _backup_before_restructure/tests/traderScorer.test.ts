import { describe, expect, it } from "vitest";
import { decayTraderScore, scoreTrader } from "../src/traders/traderScorer";

describe("scoreTrader", () => {
  it("scores a diversified profitable trader higher than a weak trader", () => {
    const strong = scoreTrader({
      leaderboardTrader: {
        rank: "1",
        proxyWallet: "0x1111111111111111111111111111111111111111",
        userName: "Strong",
        vol: 100000,
        pnl: 8000
      },
      trades: Array.from({ length: 25 }, (_, index) => ({
        proxyWallet: "0x1111111111111111111111111111111111111111",
        side: "BUY" as const,
        asset: `asset-${index}`,
        conditionId: `market-${index}`,
        size: 100,
        price: 0.5,
        timestamp: Math.floor(Date.now() / 1000)
      })),
      positions: [],
      closedPositions: Array.from({ length: 20 }, (_, index) => ({
        proxyWallet: "0x1111111111111111111111111111111111111111",
        asset: `asset-${index}`,
        conditionId: `market-${index}`,
        avgPrice: 0.4,
        totalBought: 10,
        realizedPnl: index % 4 === 0 ? -5 : 20,
        curPrice: 0.6,
        timestamp: Math.floor(Date.now() / 1000) - index * 3600
      }))
    });

    const weak = scoreTrader({
      leaderboardTrader: {
        rank: "2",
        proxyWallet: "0x2222222222222222222222222222222222222222",
        userName: "Weak",
        vol: 100,
        pnl: -50
      },
      trades: [],
      positions: [],
      closedPositions: []
    });

    expect(strong.score).toBeGreaterThan(weak.score);
    expect(strong.breakdown.realizedPnl).toBeGreaterThan(0);
  });

  it("penalizes one-market profit concentration", () => {
    const concentrated = scoreTrader({
      leaderboardTrader: {
        rank: "3",
        proxyWallet: "0x3333333333333333333333333333333333333333",
        vol: 10000,
        pnl: 1000
      },
      trades: Array.from({ length: 15 }, (_, index) => ({
        proxyWallet: "0x3333333333333333333333333333333333333333",
        side: "BUY" as const,
        asset: `asset-${index}`,
        conditionId: index < 14 ? "same-market" : "other-market",
        size: 100,
        price: 0.5,
        timestamp: Math.floor(Date.now() / 1000)
      })),
      positions: [],
      closedPositions: [
        {
          proxyWallet: "0x3333333333333333333333333333333333333333",
          asset: "a",
          conditionId: "same-market",
          avgPrice: 0.2,
          totalBought: 100,
          realizedPnl: 1000,
          curPrice: 0.7,
          timestamp: Math.floor(Date.now() / 1000)
        }
      ]
    });

    expect(concentrated.breakdown.penalties).toBeGreaterThanOrEqual(10);
  });

  it("decays stale trader scores after inactivity", () => {
    const trader = scoreTrader({
      leaderboardTrader: {
        rank: "4",
        proxyWallet: "0x4444444444444444444444444444444444444444",
        vol: 10000,
        pnl: 500
      },
      trades: [
        {
          proxyWallet: "0x4444444444444444444444444444444444444444",
          side: "BUY" as const,
          asset: "asset",
          conditionId: "market",
          size: 100,
          price: 0.5,
          timestamp: 1_000
        }
      ],
      positions: [],
      closedPositions: []
    });

    const decayed = decayTraderScore(
      trader,
      { traderScoreDecayAfterMinutes: 30, traderScoreDecayPerHour: 5 },
      1_000_000_000
    );

    expect(decayed.score).toBeLessThan(trader.score);
    expect(decayed.staleScorePenalty).toBeGreaterThan(0);
  });
});
