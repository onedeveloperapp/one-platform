import assert from "node:assert/strict";
import { test } from "node:test";

import { eventIdOf, isEventId } from "./event-id.ts";

test("a hearing's id gives the same event id every time, in the alphabet Google takes", () => {
  const id = eventIdOf("4f3c2a10-9b8e-4d7c-a6b5-1234567890ab");
  assert.equal(id, eventIdOf("4F3C2A10-9B8E-4D7C-A6B5-1234567890AB"));
  assert.equal(id.length, 26);
  assert.ok(isEventId(id));
  // Two hearings, two events.
  assert.notEqual(id, eventIdOf("4f3c2a10-9b8e-4d7c-a6b5-1234567890ac"));
  // The bytes of the RFC 4648 extended hex alphabet: sixteen zero bytes are twenty-six zeros.
  assert.equal(eventIdOf("00000000-0000-0000-0000-000000000000"), "0".repeat(26));
  // And sixteen 0xff bytes: 128 bits are twenty-five groups of five (v) and three bits left, 111 padded to 11100 (s).
  assert.equal(eventIdOf("ffffffff-ffff-ffff-ffff-ffffffffffff"), `${"v".repeat(25)}s`);
});

test("anything that is not a uuid has no event", () => {
  assert.throws(() => eventIdOf("caso-123"));
  assert.throws(() => eventIdOf(""));
  assert.equal(isEventId("abc"), false);
  assert.equal(isEventId("ABCDE"), false);
  assert.equal(isEventId("wxyz0"), false);
});
