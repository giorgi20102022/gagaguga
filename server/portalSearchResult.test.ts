import assert from "node:assert/strict";
import { after, test } from "node:test";
import axios, { type AxiosAdapter } from "axios";
import {
  classifyPortalSearchText,
  maskPersonalId,
  maskPersonalIdsInText,
  NEEDS_REVIEW_MESSAGE,
} from "./portalSearchResult.ts";
import { runPersonalIdLookup } from "./personalIdLookup.ts";

// Exact text from the production log that was wrongly reported as eligible.
const PRODUCTION_FOUND = "ბენეფიციარი ნაპოვნია:\nსტატუსი - მოთხოვნილი";
const APPLIED_MESSAGE =
  "ამ პირად ნომერზე განაცხადი უკვე არსებობს (სტატუსი: მოთხოვნილი). განაცხადის გაგრძელება შეუძლებელია.";

test("a found beneficiary is already_applied with the portal status extracted", () => {
  assert.deepEqual(classifyPortalSearchText(PRODUCTION_FOUND), { kind: "already_applied", portalStatus: "მოთხოვნილი" });
  assert.deepEqual(
    classifyPortalSearchText("მენიუ\nბენეფიციარი\n  ნაპოვნია:\n სტატუსი-დასრულებული\nგასვლა"),
    { kind: "already_applied", portalStatus: "დასრულებული" },
  );
  assert.deepEqual(classifyPortalSearchText("ბენეფიციარი ნაპოვნია"), { kind: "already_applied", portalStatus: undefined });
  // A found result wins even if "not found" wording appears elsewhere on the page.
  assert.equal(classifyPortalSearchText(`არ მოიძებნა\n${PRODUCTION_FOUND}`).kind, "already_applied");
});

test("only an explicit not-found is not_found; everything else needs review", () => {
  assert.equal(classifyPortalSearchText("ბენეფიციარი არ მოიძებნა").kind, "not_found");
  assert.equal(classifyPortalSearchText("ბენეფიციარი\nარ   მოიძებნა").kind, "not_found");
  assert.equal(classifyPortalSearchText("ამ მომხმარებელმა უკვე ისარგებლა").kind, "already_used");
  for (const text of ["", "სხვა ტექსტი", "ნაპოვნი ჩანაწერი", "არ მოიძებნა ნაპოვნი", "Error 500"]) {
    assert.equal(classifyPortalSearchText(text).kind, "needs_review", text);
  }
});

test("personal IDs are masked", () => {
  assert.equal(maskPersonalId("13012348105"), "130****8105");
  assert.equal(maskPersonalId("123"), "***");
  assert.equal(maskPersonalIdsInText('{"personalNumber":"13012348105"} 01012345678'), '{"personalNumber":"130****8105"} 010****5678');
});

// End-to-end through runPersonalIdLookup with a webhook backend: whatever a
// backend claims, the server-side guard decides from the portal text.
const primaryUrl = "https://primary-lookup.test/check";
const personalId = "13012348105";
const originalAdapter = axios.defaults.adapter;
const originalWebhook = process.env.PERSONAL_ID_LOOKUP_WEBHOOK;
process.env.PERSONAL_ID_LOOKUP_WEBHOOK = primaryUrl;
after(() => {
  axios.defaults.adapter = originalAdapter;
  if (originalWebhook === undefined) delete process.env.PERSONAL_ID_LOOKUP_WEBHOOK;
  else process.env.PERSONAL_ID_LOOKUP_WEBHOOK = originalWebhook;
});
function primaryReturns(data: unknown) {
  const calls: string[] = [];
  const adapter: AxiosAdapter = async (config) => {
    calls.push(config.url!);
    return { data, status: 200, statusText: "OK", headers: {}, config };
  };
  axios.defaults.adapter = adapter;
  return calls;
}

test("the production case is blocked even if a backend still reports eligible", async () => {
  const calls = primaryReturns({
    success: true, status: "eligible", personalId, portalMessage: PRODUCTION_FOUND,
    message: "მომხმარებელს სუბსიდირების პროგრამით ჯერ არ უსარგებლია შეგიძლიათ განაცხადის გაგრძელება.",
  });
  const result = await runPersonalIdLookup(personalId);
  assert.equal(result.success, false);
  assert.equal(result.status, "already_applied");
  assert.equal(result.portalStatus, "მოთხოვნილი");
  assert.equal(result.message, APPLIED_MESSAGE);
  assert.deepEqual(calls, [primaryUrl], "registry check is not reached");
});

test("eligible and unknown successes become needs_review; failures stay failures", async () => {
  for (const primary of [
    { success: true, status: "eligible", message: "ok", personalId },
    { success: true, status: "something_new", message: "ok", personalId },
    { success: true, status: "not_found", message: "ok", personalId, portalMessage: "გაურკვეველი პასუხი" },
  ]) {
    primaryReturns(primary);
    const result = await runPersonalIdLookup(personalId);
    assert.equal(result.success, false);
    assert.equal(result.status, "needs_review");
    assert.equal(result.message, NEEDS_REVIEW_MESSAGE);
  }
  primaryReturns({ success: false, status: "error", message: "lookup failed", personalId });
  assert.equal((await runPersonalIdLookup(personalId)).status, "error");
});
