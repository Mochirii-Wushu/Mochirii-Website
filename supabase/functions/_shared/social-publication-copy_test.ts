import {
  socialPublicationCopyContainsUrlLikeReference,
  validateSocialPublicationCopy,
} from "./social-publication-copy.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("both Meta destinations reject URL-like publication copy", () => {
  const blocked = [
    "https://example.com/path",
    "http://example.com",
    "ftp://files.example.net/x",
    "www.example.com",
    "example.com",
    "support@example.com",
    "bit.ly/abc",
    "t.co/abc",
    "//example.com/path",
    "127.0.0.1:8080/path",
    "localhost:3000/path",
    "mochirii [dot] com",
    "example d o t org",
    "h t t p s : / / example.com",
    "https%3A%2F%2Fexample.com",
    "www\u200b.example.com",
    "例え.テスト",
  ];
  for (const value of blocked) {
    assert(
      socialPublicationCopyContainsUrlLikeReference(value),
      `URL-like copy was accepted: ${value}`,
    );
    assert(
      !validateSocialPublicationCopy([value]).ok,
      `URL-like copy passed validation: ${value}`,
    );
  }
});

Deno.test("ordinary guild copy remains allowed", () => {
  const allowed = [
    "A member portrait from Wushu land.",
    "Pretty armor beneath the pavilion lanterns.",
    "Cupcake won the duel 3 to 0.",
    "Graph API v26.0 compatibility was checked.",
  ];
  for (const value of allowed) {
    assert(
      validateSocialPublicationCopy([value]).ok,
      `ordinary copy was rejected: ${value}`,
    );
  }
});
