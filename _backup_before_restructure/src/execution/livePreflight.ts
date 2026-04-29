import { BotConfig } from "../types";

export type PreflightStatus = "pass" | "fail" | "warn" | "skip";

export interface LivePreflightCheck {
  name: string;
  status: PreflightStatus;
  message: string;
}

export interface LivePreflightResult {
  passed: boolean;
  checks: LivePreflightCheck[];
}

export interface LivePreflightDeps {
  apiHealthCheck?: () => Promise<boolean>;
  authCheck?: () => Promise<boolean>;
  tokenApprovalsCheck?: () => Promise<boolean>;
  usdcBalanceCheck?: () => Promise<number>;
  walletConnectedCheck?: () => Promise<boolean>;
}

export async function runLivePreflight(
  config: BotConfig,
  deps: LivePreflightDeps = {}
): Promise<LivePreflightResult> {
  const checks: LivePreflightCheck[] = [];

  addCheck(checks, "Mode", config.mode === "live", `MODE is ${config.mode}; live trading requires MODE=live.`);
  addCheck(checks, "ENABLE_LIVE_TRADING", config.enableLiveTrading, "ENABLE_LIVE_TRADING must be true for live mode.");
  addCheck(checks, "REAL_TRADING_ENABLED", config.realTradingEnabled, "REAL_TRADING_ENABLED must be true for live mode.");
  addCheck(checks, "LIVE_TRADING", config.liveTrading && !config.paperTrading, "LIVE_TRADING=true and PAPER_TRADING=false are required.");
  addCheck(checks, "Paper-only guard", !config.paperTradingOnly, "PAPER_TRADING_ONLY must be false before live trading.");
  addCheck(checks, "Max trade size", config.maxTradeSizeUsdc > 0 && config.maxTradeSizeUsdc <= 5, "MAX_TRADE_SIZE_USDC must be configured and tiny during incubation.");
  addCheck(checks, "Daily loss limit", config.maxDailyLossUsdc > 0, "MAX_DAILY_LOSS_USDC must be configured.");
  addCheck(checks, "Open position limit", config.maxOpenPositions > 0, "MAX_OPEN_POSITIONS must be configured.");

  const missingEnv = requiredLiveEnv(config);
  checks.push({
    name: "Required env vars",
    status: missingEnv.length === 0 ? "pass" : "fail",
    message:
      missingEnv.length === 0
        ? "Required live env vars are present. Secret values were not printed."
        : `Missing required live env vars: ${missingEnv.join(", ")}. Secret values were not printed.`
  });

  checks.push(await adapterCheck("Wallet connected", deps.walletConnectedCheck, "Wallet connection was not checked by an adapter."));
  checks.push(await adapterCheck("Polymarket auth", deps.authCheck, "Polymarket auth was not checked by an adapter."));
  checks.push(await adapterCheck("Token approvals", deps.tokenApprovalsCheck, "Token approvals were not checked by an adapter."));

  if (deps.usdcBalanceCheck) {
    try {
      const balance = await deps.usdcBalanceCheck();
      checks.push({
        name: "USDC balance",
        status: balance >= config.maxTradeSizeUsdc ? "pass" : "fail",
        message: `USDC balance check returned ${balance.toFixed(2)} USDC.`
      });
    } catch (error) {
      checks.push({ name: "USDC balance", status: "fail", message: errorMessage(error) });
    }
  } else {
    checks.push({ name: "USDC balance", status: "fail", message: "USDC balance was not checked by an adapter." });
  }

  checks.push(await adapterCheck("API connection", deps.apiHealthCheck, "API health was not checked by an adapter."));

  return {
    passed: checks.every((check) => check.status === "pass"),
    checks
  };
}

export async function defaultApiHealthCheck(url: string): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5_000);
  try {
    const response = await fetch(url, { method: "GET", signal: controller.signal });
    return response.ok || response.status < 500;
  } finally {
    clearTimeout(timer);
  }
}

function requiredLiveEnv(config: BotConfig): string[] {
  const missing: string[] = [];
  if (!config.polymarketApiKey) missing.push("POLYMARKET_API_KEY");
  if (!config.polymarketApiSecret && !config.polymarketSecret) missing.push("POLYMARKET_API_SECRET or POLYMARKET_SECRET");
  if (!config.polymarketApiPassphrase) missing.push("POLYMARKET_API_PASSPHRASE");
  if (!config.polymarketFunder) missing.push("POLYMARKET_FUNDER");
  if (!config.polymarketPrivateKey) missing.push("POLYMARKET_PRIVATE_KEY");
  return missing;
}

function addCheck(checks: LivePreflightCheck[], name: string, condition: boolean, failureMessage: string): void {
  checks.push({
    name,
    status: condition ? "pass" : "fail",
    message: condition ? "OK" : failureMessage
  });
}

async function adapterCheck(
  name: string,
  adapter: (() => Promise<boolean>) | undefined,
  missingMessage: string
): Promise<LivePreflightCheck> {
  if (!adapter) return { name, status: "fail", message: missingMessage };
  try {
    const ok = await adapter();
    return { name, status: ok ? "pass" : "fail", message: ok ? "OK" : `${name} check returned false.` };
  } catch (error) {
    return { name, status: "fail", message: errorMessage(error) };
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
