import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(path.join(appRoot, "config/settings_data.json"), "utf8");
const settings = JSON.parse(source.replace(/^\s*[/][*][\s\S]*?[*][/]\s*/u, ""));

if (settings.current?.checkout_cta_enabled !== false) {
  console.error("Payment-dependent test boundary failed: the theme checkout CTA must remain disabled.");
  process.exit(1);
}

console.error(
  "Payment-dependent checkout, order, billing, and shipment tests remain excluded. " +
  "The theme setting does not disable Shopify checkout; run those tests only in the separately approved final payment phase.",
);
process.exit(2);
