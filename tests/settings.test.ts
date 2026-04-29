import { describe, expect, it } from "vitest";
import { loadConfigFromEnv } from "../src/config/settings";

describe("settings", () => {
  it("defaults to safe paper mode", () => {
    const config = loadConfigFromEnv({});

    expect(config.mode).toBe("paper");
    expect(config.paperTrading).toBe(true);
    expect(config.paperTradingOnly).toBe(true);
    expect(config.enableLiveTrading).toBe(false);
    expect(config.realTradingEnabled).toBe(false);
    expect(config.liveTrading).toBe(false);
    expect(config.paperScoutMode).toBe(false);
  });

  it("rejects unknown modes", () => {
    expect(() => loadConfigFromEnv({ MODE: "chaos" })).toThrow("Invalid MODE");
  });

  it("fails closed when live mode is missing explicit live flags", () => {
    expect(() => loadConfigFromEnv({ MODE: "live" })).toThrow("Live mode is locked");
  });

  it("parses live mode only when every live confirmation flag is enabled", () => {
    const config = loadConfigFromEnv({
      MODE: "live",
      ENABLE_LIVE_TRADING: "true",
      REAL_TRADING_ENABLED: "true",
      LIVE_TRADING: "true",
      MAX_TRADE_SIZE_USDC: "3",
      MAX_DAILY_LOSS_USDC: "7"
    });

    expect(config.mode).toBe("live");
    expect(config.paperTrading).toBe(false);
    expect(config.paperTradingOnly).toBe(false);
    expect(config.enableLiveTrading).toBe(true);
    expect(config.realTradingEnabled).toBe(true);
    expect(config.liveTrading).toBe(true);
    expect(config.maxTradeSizeUsdc).toBe(3);
    expect(config.maxDailyLossUsdc).toBe(7);
  });

  it("parses paper scout mode controls without enabling it by default", () => {
    const config = loadConfigFromEnv({
      PAPER_SCOUT_MODE: "true",
      PAPER_SCOUT_MAX_NEGATIVE_EDGE: "0.012",
      PAPER_SCOUT_MAX_SPREAD: "0.021",
      PAPER_SCOUT_INTERVAL_SECONDS: "15",
      PAPER_SCOUT_MAX_OPEN_TRADES: "2"
    });

    expect(config.paperScoutMode).toBe(true);
    expect(config.paperScoutMaxNegativeEdge).toBe(0.012);
    expect(config.paperScoutMaxSpread).toBe(0.021);
    expect(config.paperScoutIntervalSeconds).toBe(15);
    expect(config.paperScoutMaxOpenTrades).toBe(2);
  });
});
