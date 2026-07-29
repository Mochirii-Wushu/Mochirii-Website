import { loadConfig } from "./config.mjs";

const config = loadConfig(process.env, { forHashOnly: true });
if (config.mode === "disabled") {
  process.stderr.write("Set TREMENDOUS_MODE to sandbox or production and supply the nonsecret allowlists before deriving a configuration hash.\n");
  process.exitCode = 2;
} else {
  process.stdout.write(`${config.derivedConfigurationHash}\n`);
}
