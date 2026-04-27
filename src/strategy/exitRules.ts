import { PaperPosition } from "../types";

export interface ExitRuleDecision {
  shouldExit: boolean;
  reason?: string;
}

export function evaluateExitRules(position: PaperPosition): ExitRuleDecision {
  // Version 1 exits mainly when a watched wallet emits a SELL signal for an
  // asset we already hold. This hook is here so you can later add stop loss,
  // take profit, or time-based exits without touching the paper trader.
  if (position.shares <= 0) {
    return { shouldExit: true, reason: "Position has no shares left." };
  }

  return { shouldExit: false };
}
