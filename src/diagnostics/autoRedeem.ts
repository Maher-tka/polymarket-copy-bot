import { loadConfig } from "../config/settings";
import { AutoRedeemService, NoopAutoRedeemAdapter } from "../execution/autoRedeem";

async function main(): Promise<void> {
  const config = loadConfig();
  const service = new AutoRedeemService(config, new NoopAutoRedeemAdapter());
  const result = await service.runOnce();

  console.log("Auto-redeem Utility");
  console.log("===================");
  console.log(`enabled: ${result.enabled}`);
  console.log(`dryRun: ${result.dryRun}`);
  console.log(`checked: ${result.checked}`);
  console.log(`redeemed: ${result.redeemed}`);

  if (!result.enabled) {
    console.log("Auto-redeem is disabled. No markets checked and no transactions sent.");
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
