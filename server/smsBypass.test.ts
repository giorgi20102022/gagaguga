import assert from "node:assert/strict";
import { test } from "node:test";
import { isSmsBypassActive, smsBypassUpdate, SMS_BYPASS_DURATION_MS } from "../shared/smsBypass";
import { hasSmsProof, issueSmsProof } from "./smsVerification";

const now = Date.parse("2026-10-22T12:00:00Z");
const disabled = { requireSmsVerification: true, smsBypassExpiresAt: null };

test("enabling grants exactly 30 minutes, with a strict deadline", () => {
  const enabled = smsBypassUpdate(disabled, false, now);
  assert.equal(enabled.smsBypassExpiresAt?.toISOString(), "2026-10-22T12:30:00.000Z");
  assert.equal(isSmsBypassActive(enabled, now + SMS_BYPASS_DURATION_MS - 1), true);
  assert.equal(isSmsBypassActive(enabled, now + SMS_BYPASS_DURATION_MS), false);
  assert.equal(isSmsBypassActive(enabled, now + SMS_BYPASS_DURATION_MS + 1), false);
});

test("manual OFF clears deadline immediately; a saved OFF to ON starts a fresh window", () => {
  const enabled = smsBypassUpdate(disabled, false, now);
  const off = { ...enabled, ...smsBypassUpdate(enabled, true, now + 1000) };
  assert.deepEqual(off, disabled);
  assert.equal(isSmsBypassActive(off, now + 1000), false);
  const renewed = smsBypassUpdate(off, false, now + 2000);
  assert.equal(renewed.smsBypassExpiresAt?.getTime(), now + 2000 + SMS_BYPASS_DURATION_MS);
});

test("unrelated saves and repeated ON do not extend an active or expired deadline", () => {
  const enabled = smsBypassUpdate(disabled, false, now);
  for (const time of [now + 1000, now + SMS_BYPASS_DURATION_MS]) {
    assert.deepEqual(smsBypassUpdate(enabled, undefined, time), {});
    assert.deepEqual(smsBypassUpdate(enabled, false, time), {});
  }
});

test("missing, malformed, nonfinite and expired timestamps fail closed", () => {
  for (const value of [undefined, null, "", "invalid", "infinity", new Date(NaN), new Date(now)]) {
    assert.equal(isSmsBypassActive({ requireSmsVerification: false, smsBypassExpiresAt: value }, now), false);
  }
  assert.equal(isSmsBypassActive({ ...disabled, smsBypassExpiresAt: new Date(now + 1000) }, now), false);
});

test("dealer settings are isolated and serialized deadlines survive process/page lifetimes", () => {
  const first = smsBypassUpdate(disabled, false, now);
  const second = smsBypassUpdate(disabled, false, now + 60_000);
  const restored = JSON.parse(JSON.stringify(first));
  assert.equal(isSmsBypassActive(restored, now + SMS_BYPASS_DURATION_MS), false);
  assert.equal(isSmsBypassActive(second, now + SMS_BYPASS_DURATION_MS), true);
  smsBypassUpdate(first, true, now + 1000);
  assert.equal(isSmsBypassActive(second, now + 1000), true);
});

test("actual SMS proof is signed and bound to dealer and phone", () => {
  const proof = issueSmsProof(1, "599123456", "test-secret");
  assert.equal(hasSmsProof(proof, 1, "+995 599 12 34 56", "test-secret"), true);
  assert.equal(hasSmsProof(proof, 2, "599123456", "test-secret"), false);
  assert.equal(hasSmsProof(proof, 1, "599123457", "test-secret"), false);
  assert.equal(hasSmsProof(proof, 1, "599123456", "wrong-secret"), false);
  assert.equal(hasSmsProof(true, 1, "599123456", "test-secret"), false);
});
