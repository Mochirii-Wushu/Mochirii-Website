import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { SUPABASE_FUNCTIONS_URL } from "./lib/public-urls.mjs";

export const GATEWAY_STATUS_URL = SUPABASE_FUNCTIONS_URL + "/reaper-gateway-operations/status";

/** One anonymous read of the owner-controlled, fixed public status contract. */
export async function checkGatewayStatus(fetchImpl = fetch, timeoutMs = 10_000) {
  const controller = new AbortController();
  let reader;
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error("Gateway health deadline."));
    }, timeoutMs);
  });
  try {
    await Promise.race([
      (async () => {
        const response = await fetchImpl(GATEWAY_STATUS_URL, {
          method: "GET", redirect: "error", signal: controller.signal,
          headers: { Accept: "text/plain", "Accept-Encoding": "identity", "User-Agent": "MochiriiGatewayHealth/1.0" },
        });
        const type = response.headers.get("content-type") || "";
        const length = response.headers.get("content-length");
        if (response.status !== 200 || response.redirected || response.url !== GATEWAY_STATUS_URL ||
          !/^text\/plain(?:; charset=utf-8)?$/iu.test(type) || response.headers.get("cache-control") !== "no-store" ||
          !["", "identity"].includes(response.headers.get("content-encoding") || "") ||
          (length !== null && length !== "2") || !response.body) throw new Error("Invalid Gateway status.");
        reader = response.body.getReader();
        const bytes = [];
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          if (bytes.length + value.byteLength > 2) throw new Error("Gateway status limit.");
          bytes.push(...value);
        }
        if (bytes.length !== 2 || bytes[0] !== 111 || bytes[1] !== 107) throw new Error("Gateway unavailable.");
      })(),
      deadline,
    ]);
  } catch {
    throw new Error("Gateway hosted health unavailable; review readiness, heartbeat and recovery receipts.");
  } finally {
    clearTimeout(timer);
    controller.abort();
    void reader?.cancel().catch(() => undefined);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    await checkGatewayStatus();
    console.log("Gateway hosted health passed.");
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
