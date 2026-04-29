import { describe, expect, it } from "vitest";
import { AutoRedeemAdapter, AutoRedeemService } from "../src/execution/autoRedeem";

const adapter: AutoRedeemAdapter = {
  async listResolvedClaimablePositions() {
    return [{ marketId: "market-1", tokenSide: "YES", claimableUsdc: 3 }];
  },
  async redeem(position) {
    return { txHash: `tx-${position.marketId}`, redeemedUsdc: position.claimableUsdc };
  }
};

describe("autoRedeem", () => {
  it("does nothing when disabled", async () => {
    const service = new AutoRedeemService({ autoRedeemEnabled: false, autoRedeemDryRun: true }, adapter);
    const result = await service.runOnce();

    expect(result.enabled).toBe(false);
    expect(result.checked).toBe(0);
    expect(result.redeemed).toBe(0);
  });

  it("detects claimables in dry run without redeeming", async () => {
    const service = new AutoRedeemService({ autoRedeemEnabled: true, autoRedeemDryRun: true }, adapter);
    const result = await service.runOnce();

    expect(result.checked).toBe(1);
    expect(result.redeemed).toBe(0);
    expect(result.results[0].dryRun).toBe(true);
  });

  it("redeems through the adapter only when enabled and not dry run", async () => {
    const service = new AutoRedeemService({ autoRedeemEnabled: true, autoRedeemDryRun: false }, adapter);
    const result = await service.runOnce();

    expect(result.checked).toBe(1);
    expect(result.redeemed).toBe(1);
    expect(result.results[0].txHash).toBe("tx-market-1");
  });
});
