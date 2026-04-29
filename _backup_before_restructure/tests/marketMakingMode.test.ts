import { describe, expect, it } from "vitest";
import {
  estimateMakerAdverseSelectionUsd,
  makerQueueAheadUsd,
  passiveBuyPrice
} from "../src/strategy/marketMakingMode";

describe("market-making maker simulation helpers", () => {
  it("improves a passive bid only when it can remain post-only", () => {
    expect(passiveBuyPrice(0.49, 0.52, 0.01)).toBeCloseTo(0.5);
    expect(passiveBuyPrice(0.49, 0.5, 0.01)).toBeCloseTo(0.49);
  });

  it("counts visible queue ahead at or above the maker limit", () => {
    const bids = [
      { price: "0.50", size: "100" },
      { price: "0.49", size: "50" },
      { price: "0.48", size: "100" }
    ];

    expect(makerQueueAheadUsd(bids, 0.5)).toBeCloseTo(50);
    expect(makerQueueAheadUsd(bids, 0.49)).toBeCloseTo(74.5);
  });

  it("charges an adverse-selection haircut before paper maker fills can look profitable", () => {
    expect(estimateMakerAdverseSelectionUsd(0.5, 10, 25)).toBeCloseTo(0.0125);
    expect(estimateMakerAdverseSelectionUsd(0.5, 10, 0)).toBe(0);
  });
});
