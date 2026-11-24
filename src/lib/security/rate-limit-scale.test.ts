import assert from "node:assert/strict";
import { test } from "node:test";

import { resolveRateLimitScale } from "./rate-limit.ts";

test("rate limits are as written unless RATE_LIMIT_SCALE raises them", () => {
  assert.equal(resolveRateLimitScale({}), 1);
  assert.equal(resolveRateLimitScale({ RATE_LIMIT_SCALE: "" }), 1);
  assert.equal(resolveRateLimitScale({ RATE_LIMIT_SCALE: " 20 " }), 20);
  assert.equal(resolveRateLimitScale({ RATE_LIMIT_SCALE: "2.5" }), 2.5);
  // Nothing below the written limits, and nonsense is ignored.
  assert.equal(resolveRateLimitScale({ RATE_LIMIT_SCALE: "0.5" }), 1);
  assert.equal(resolveRateLimitScale({ RATE_LIMIT_SCALE: "0" }), 1);
  assert.equal(resolveRateLimitScale({ RATE_LIMIT_SCALE: "lots" }), 1);
});
