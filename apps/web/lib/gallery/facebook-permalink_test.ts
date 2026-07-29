import assert from "node:assert/strict";
import test from "node:test";
import { normalizeFacebookPermalink } from "./facebook-permalink.ts";

test("normalizes known Facebook permalink hosts to canonical HTTPS www", () => {
  assert.equal(
    normalizeFacebookPermalink(
      " https://m.facebook.com/story.php?story_fbid=12345&id=67890&utm_source=test ",
    ),
    "https://www.facebook.com/story.php?story_fbid=12345&id=67890",
  );
  assert.equal(
    normalizeFacebookPermalink("https://facebook.com/photo/?fbid=34"),
    "https://www.facebook.com/photo.php?fbid=34",
  );
});

test("rejects executable, off-domain, credentialed, fragmented, and ported URLs", () => {
  for (const value of [
    "javascript:alert(1)",
    "https://facebook.com.example.test/post/1",
    "https://evil.facebook.com/post/1",
    "https://user:pass@www.facebook.com/post/1",
    "https://www.facebook.com/post/1#fragment",
    "https://www.facebook.com:8443/post/1",
    "https://www.facebook.com/post 1",
    "https://www.facebook.com/",
    "https://www.facebook.com/profile.php?id=61592841711452",
    "https://www.facebook.com/about",
    "https://www.facebook.com/?story_fbid=12345&id=67890",
  ]) {
    assert.equal(normalizeFacebookPermalink(value), null, value);
  }
});
