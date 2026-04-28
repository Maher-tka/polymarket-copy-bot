import { runLivePreflight, defaultApiHealthCheck } from "../execution/livePreflight";
import { loadConfigFromEnv } from "../config/settings";

async function main(): Promise<void> {
  let config;
  try {
    config = loadConfigFromEnv(process.env);
  } catch (error) {
    console.error("Live Pre-flight Validation");
    console.error("==========================");
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
    return;
  }

  const result = await runLivePreflight(config, {
    apiHealthCheck: () => defaultApiHealthCheck(config.clobHost)
  });

  console.log("Live Pre-flight Validation");
  console.log("==========================");
  for (const check of result.checks) {
    console.log(`[${check.status.toUpperCase()}] ${check.name}: ${check.message}`);
  }
  console.log("");
  console.log(result.passed ? "PASS: live pre-flight is clean." : "FAIL: live trading must remain locked.");

  process.exitCode = result.passed ? 0 : 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
