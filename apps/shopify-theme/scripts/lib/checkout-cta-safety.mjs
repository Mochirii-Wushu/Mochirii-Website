import path from "node:path";

const RUNTIME_TEXT_EXTENSIONS = new Set([
  ".css", ".csv", ".html", ".js", ".json", ".liquid", ".mjs", ".svg", ".txt", ".xml", ".yaml", ".yml",
]);
const RUNTIME_BINARY_EXTENSIONS = new Set([
  ".avif", ".eot", ".gif", ".ico", ".jpeg", ".jpg", ".mp3", ".mp4", ".ogg", ".otf", ".pdf", ".png",
  ".ttf", ".webm", ".webp", ".woff", ".woff2",
]);

export function checkoutSafetyFileKind(filePath) {
  const extension = typeof filePath === "string" ? path.extname(filePath).toLowerCase() : "";
  if (RUNTIME_TEXT_EXTENSIONS.has(extension)) return "text";
  if (RUNTIME_BINARY_EXTENSIONS.has(extension)) return "binary";
  return null;
}

export const FORBIDDEN_CHECKOUT_PRIMITIVES = Object.freeze([
  Object.freeze({
    category: "accelerated checkout payment_button",
    pattern: /\bpayment_button\b/iu,
  }),
  Object.freeze({
    category: "additional checkout buttons",
    pattern: /\b(?:additional_checkout_buttons|content_for_additional_checkout_buttons)\b|shopify-payment-button/iu,
  }),
  Object.freeze({
    category: "explicit checkout URL",
    pattern: /\b(?:checkout_url|checkoutUrl)\b|["'`](?:(?:https?:)?[/][/][^"'`]+)?[/]checkout(?:[/?#][^"'`]*)?["'`]/iu,
  }),
  Object.freeze({
    category: "cart permalink or direct-checkout primitive",
    pattern: /\bcart_permalink\b|["'`][^"'`]*[/]cart[/][^"'`]*:[^"'`]*["'`]/iu,
  }),
]);

export function checkoutPrimitiveCategories(source) {
  if (typeof source !== "string") return ["invalid runtime source"];
  return FORBIDDEN_CHECKOUT_PRIMITIVES
    .filter(({ pattern }) => pattern.test(source))
    .map(({ category }) => category);
}
