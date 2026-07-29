import assert from "node:assert/strict";
import test from "node:test";
import { checkoutPrimitiveCategories, checkoutSafetyFileKind } from "./lib/checkout-cta-safety.mjs";

test("runtime inventory classifies executable text and known binary assets", () => {
  for (const filename of ["theme.js", "module.mjs", "template.liquid", "settings.json", "icon.svg", "style.css"]) {
    assert.equal(checkoutSafetyFileKind(filename), "text");
  }
  for (const filename of ["photo.webp", "font.woff2", "video.mp4"]) {
    assert.equal(checkoutSafetyFileKind(filename), "binary");
  }
  assert.equal(checkoutSafetyFileKind("future.runtime"), null);
});

test("safe cart and product controls do not claim to disable Shopify checkout", () => {
  const safeSource = `
    {% if settings.checkout_cta_enabled %}
      <button type="submit" name="checkout">Checkout</button>
    {% else %}
      <button type="button" disabled>Checkout opens when the store launches.</button>
    {% endif %}
  `;
  assert.deepEqual(checkoutPrimitiveCategories(safeSource), []);
});

for (const [category, source] of [
  ["accelerated checkout payment_button", "{{ form | payment_button }}"],
  ["additional checkout buttons", "{% if additional_checkout_buttons %}{{ content_for_additional_checkout_buttons }}{% endif %}"],
  ["additional checkout buttons", "<div class=\"shopify-payment-button\"></div>"],
  ["explicit checkout URL", "<a href=\"/checkout\">Checkout</a>"],
  ["explicit checkout URL", "window.location.href = `https://shop.example/checkout?step=contact`;"],
  ["explicit checkout URL", "const destination = cart.checkoutUrl;"],
  ["cart permalink or direct-checkout primitive", "<a href=\"/cart/123456789:1\">Buy now</a>"],
  ["cart permalink or direct-checkout primitive", "const cart_permalink = buildLink();"],
]) {
  test(`rejects ${category}: ${source.slice(0, 32)}`, () => {
    assert.ok(checkoutPrimitiveCategories(source).includes(category));
  });
}

test("invalid runtime source fails closed", () => {
  assert.deepEqual(checkoutPrimitiveCategories(null), ["invalid runtime source"]);
});
