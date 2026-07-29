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
