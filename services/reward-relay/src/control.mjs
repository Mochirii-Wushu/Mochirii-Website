import { loadConfig } from "./config.mjs";
import { RelayState } from "./state.mjs";

const config = loadConfig();
const state = new RelayState(config.databasePath);
try {
  const command = process.argv[2] || "status";
  if (command === "status") {
    process.stdout.write(`${JSON.stringify(state.getControl())}\n`);
  } else if (command === "clear-suspension") {
    const expectedReason = process.argv[3] || "";
    if (!state.clearSuspension(expectedReason, Date.now())) {
      process.stderr.write("Suspension was not cleared: the expected reason did not exactly match current state.\n");
      process.exitCode = 2;
    }
  } else if (command === "unlock-link") {
    const rewardReference = process.argv[3] || "";
    if (!state.unlockRewardLink(rewardReference, Date.now())) {
      process.stderr.write("Link generation was not unlocked: no matching issued reward exists.\n");
      process.exitCode = 2;
    }
  } else {
    process.stderr.write("Usage: node src/control.mjs status | clear-suspension <exact-reason-code> | unlock-link <reward-reference>\n");
    process.exitCode = 2;
  }
} finally {
  state.close();
}
