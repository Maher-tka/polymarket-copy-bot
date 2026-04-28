import { describe, expect, it } from "vitest";
import { runLivePreflight } from "../src/execution/livePreflight";
import { loadConfigFromEnv } from "../src/config/settings";

describe("livePreflight", () => {
  it("fails closed in default paper mode", async () => {
    const config = loadConfigFromEnv({});
    const result = await runLivePreflight(config);

    expect(result.passed).toBe(false);
    expect(result.checks.some((check) => check.name === "Mode" && check.status === "fail")).toBe(true);
    expect(result.checks.some((check) => check.name === "REAL_TRADING_ENABLED" && check.status === "fail")).toBe(true);
  });

  it("passes only when live config, adapters, balance, and env checks pass", async () => {
    const config = loadConfigFromEnv({
      MODE: "live",
      ENABLE_LIVE_TRADING: "true",
      REAL_TRADING_ENABLED: "true",
      LIVE_TRADING: "true",
      PAPER_TRADING_ONLY: "false",
      MAX_TRADE_SIZE_USDC: "5",
      POLYMARKET_API_KEY: "api-key",
      POLYMARKET_API_SECRET: "api-secret",
      POLYMARKET_API_PASSPHRASE: "passphrase",
      POLYMARKET_FUNDER: "0xfunder",
      POLYMARKET_PRIVATE_KEY: "0xprivate"
    });

    const result = await runLivePreflight(config, {
      apiHealthCheck: async () => true,
      authCheck: async () => true,
      tokenApprovalsCheck: async () => true,
      usdcBalanceCheck: async () => 6,
      walletConnectedCheck: async () => true
    });

    expect(result.passed).toBe(true);
  });

  it("fails when USDC balance is below tiny incubation size", async () => {
    const config = loadConfigFromEnv({
      MODE: "live",
      ENABLE_LIVE_TRADING: "true",
      REAL_TRADING_ENABLED: "true",
      LIVE_TRADING: "true",
      PAPER_TRADING_ONLY: "false",
      MAX_TRADE_SIZE_USDC: "5",
      POLYMARKET_API_KEY: "api-key",
      POLYMARKET_API_SECRET: "api-secret",
      POLYMARKET_API_PASSPHRASE: "passphrase",
      POLYMARKET_FUNDER: "0xfunder",
      POLYMARKET_PRIVATE_KEY: "0xprivate"
    });

    const result = await runLivePreflight(config, {
      apiHealthCheck: async () => true,
      authCheck: async () => true,
      tokenApprovalsCheck: async () => true,
      usdcBalanceCheck: async () => 2,
      walletConnectedCheck: async () => true
    });

    expect(result.passed).toBe(false);
    expect(result.checks.find((check) => check.name === "USDC balance")?.status).toBe("fail");
  });
});
