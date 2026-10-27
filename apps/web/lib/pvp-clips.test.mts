import assert from "node:assert/strict";
import test from "node:test";
import { pvpDuration, reviewedPvpClip, selectPvpClips } from "./pvp-clips.ts";

function clip(id = "duel-01") {
  return { id, title: "Reviewed fixture duel", description: "A local test card, never a published guild clip.", durationSeconds: 92.3, width: 1920, height: 1080,
    poster: `/assets/home/pvp/${id}/poster.webp`, source: `/assets/home/pvp/${id}/clip-h264.mp4`, meaningfulSpeech: false,
    export: { container: "mp4", videoCodec: "h264", audioCodec: "aac", fps: 30, bytes: 1000000, sha256: "a".repeat(64) },
    review: { status: "approved", id: "local-fixture", reviewedAt: "2026-10-24T00:00:00.000Z", boundaries: true, identityResult: true, frames: true, color: true, audio: true, privacy: true, rights: true, captions: true, backupRestore: true } };
}
test("only fully reviewed clips enter the selection; every review gate fails closed", () => {
  assert(reviewedPvpClip(clip()));
  for (const key of Object.keys(clip().review)) {
    const value = clip();
    Reflect.set(value.review, key, key === "status" ? "pending" : key === "reviewedAt" ? "yesterday" : key === "id" ? "" : false);
    assert.equal(reviewedPvpClip(value), false, key);
  }
});
test("meaningful speech requires both reviewed captions and a transcript", () => {
  const value = { ...clip(), meaningfulSpeech: true, captions: { source: "/assets/home/pvp/duel-01/captions.vtt", language: "en", label: "English" }, transcript: "Local speech fixture." };
  assert(reviewedPvpClip(value));
  assert.equal(reviewedPvpClip({ ...value, captions: undefined }), false);
  assert.equal(reviewedPvpClip({ ...value, transcript: "" }), false);
});
test("private, unreviewed, credentialed, signed, traversing and active media URLs are rejected", () => {
  for (const source of ["https://example.invalid/assets/home/pvp/duel-01/clip-h264.mp4", "https://user:secret@media.invalid/assets/home/pvp/duel-01/clip-h264.mp4", "/storage/v1/object/sign/private/foo?token=private", "/assets/home/pvp/duel-01/clip-h264.mp4?token=private", "//media.invalid/file.mp4", "javascript:alert(1)", "data:video/mp4;base64,eA==", "/assets/home/pvp/duel-01/../duel-01/clip-h264.mp4", "/assets/home/pvp/duel-01/clip-h264.mp4#x"]) {
    assert.equal(reviewedPvpClip({ ...clip(), source }), false);
  }
  const prefix = "https://media.invalid";
  const value = { ...clip(), source: prefix + clip().source, poster: prefix + clip().poster };
  assert.equal(reviewedPvpClip(value), false);
  assert(reviewedPvpClip(value, [prefix]));
});
test("selection is bounded, unique, shuffled once on the server, and does not mutate its manifest", () => {
  const values = Array.from({ length: 103 }, (_, n) => clip(`duel-${n}`));
  const before = JSON.stringify(values);
  const selected = selectPvpClips([...values, ...values], [], () => .5);
  assert.equal(selected.length, 4);
  assert.equal(new Set(selected.map(c => c.id)).size, 4);
  assert.equal(JSON.stringify(values), before);
  assert.deepEqual(selectPvpClips([], []), []);
  assert.equal(selectPvpClips([clip(), clip(), clip("duel-02")]).length, 2);
  assert.deepEqual(selectPvpClips(values, [], () => .5), selected);
  assert.notDeepEqual(selectPvpClips(values, [], () => 0).map(value => value.id), selected.map(value => value.id), "Different visit samples can showcase a different reviewed selection");
});
test("invalid bounds, malformed metadata and invalid RNG cannot leak unreviewed data", () => {
  for (const value of [null, [], {}, { ...clip(), id: "../duel" }, { ...clip(), title: "<script>" }, { ...clip(), durationSeconds: Infinity }, { ...clip(), durationSeconds: 0 }, { ...clip(), width: 0 }, { ...clip(), height: 10000 }, { ...clip(), export: { ...clip().export, sha256: "fake" } }]) assert.equal(reviewedPvpClip(value), false);
  assert.equal(selectPvpClips([clip(), clip("duel-02")], [], () => NaN).length, 2);
  assert.equal(pvpDuration(92.3), "1:32");
});
