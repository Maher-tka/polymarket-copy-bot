import { BotConfig } from "../types";

export interface ClaimablePosition {
  marketId: string;
  conditionId?: string;
  tokenId?: string;
  tokenSide?: "YES" | "NO";
  title?: string;
  claimableUsdc: number;
}

export interface RedemptionResult {
  marketId: string;
  redeemed: boolean;
  dryRun: boolean;
  claimableUsdc: number;
  txHash?: string;
  message: string;
}

export interface AutoRedeemAdapter {
  listResolvedClaimablePositions(): Promise<ClaimablePosition[]>;
  redeem(position: ClaimablePosition): Promise<{ txHash?: string; redeemedUsdc: number }>;
}

export interface AutoRedeemRunResult {
  enabled: boolean;
  dryRun: boolean;
  checked: number;
  redeemed: number;
  results: RedemptionResult[];
}

export class AutoRedeemService {
  constructor(private readonly config: Pick<BotConfig, "autoRedeemEnabled" | "autoRedeemDryRun">, private readonly adapter: AutoRedeemAdapter) {}

  async runOnce(): Promise<AutoRedeemRunResult> {
    if (!this.config.autoRedeemEnabled) {
      return { enabled: false, dryRun: this.config.autoRedeemDryRun, checked: 0, redeemed: 0, results: [] };
    }

    const claimable = await this.adapter.listResolvedClaimablePositions();
    const results: RedemptionResult[] = [];

    for (const position of claimable) {
      if (this.config.autoRedeemDryRun) {
        results.push({
          marketId: position.marketId,
          redeemed: false,
          dryRun: true,
          claimableUsdc: position.claimableUsdc,
          message: "Dry run only. No redemption transaction sent."
        });
        continue;
      }

      const result = await this.adapter.redeem(position);
      results.push({
        marketId: position.marketId,
        redeemed: result.redeemedUsdc > 0,
        dryRun: false,
        claimableUsdc: position.claimableUsdc,
        txHash: result.txHash,
        message: result.redeemedUsdc > 0 ? "Redeemed claimable winnings." : "Nothing redeemed."
      });
    }

    return {
      enabled: true,
      dryRun: this.config.autoRedeemDryRun,
      checked: claimable.length,
      redeemed: results.filter((result) => result.redeemed).length,
      results
    };
  }
}

export class NoopAutoRedeemAdapter implements AutoRedeemAdapter {
  async listResolvedClaimablePositions(): Promise<ClaimablePosition[]> {
    return [];
  }

  async redeem(_position: ClaimablePosition): Promise<{ txHash?: string; redeemedUsdc: number }> {
    throw new Error("Auto-redeem adapter is not connected. No transaction was sent.");
  }
}
