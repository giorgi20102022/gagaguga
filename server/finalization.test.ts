import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { FinalizationService, type Context, type Entry, type FinalizationStore } from "./finalization";

class Store implements FinalizationStore {
  rows = new Map<string, Entry>();
  async claim(c: Context) {
    if (this.rows.has(c.submissionId)) return false;
    this.rows.set(c.submissionId, { dealer_id: c.dealerId, state: "processing", result: null, updated_at: new Date() });
    return true;
  }
  async get(id: string) { return this.rows.get(id); }
  async settle(id: string, state: "completed" | "uncertain", result?: any) {
    Object.assign(this.rows.get(id)!, { state, result: result ?? null });
  }
}
const context = (): Context => ({ submissionId: randomUUID(), dealerId: 1, requestId: randomUUID(), endpoint: "/api/workspace/submit" });
const success = { status: 200, data: { success: true } };

test("concurrent requests across service instances share one claim; completed retry returns stored result", async () => {
  const store = new Store();
  let calls = 0;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const dispatch = async (payload: any) => { calls++; assert.equal(payload.submission_id, c.submissionId); await gate; return success; };
  const a = new FinalizationService(store, dispatch), b = new FinalizationService(store, dispatch);
  const c = context();
  const first = a.submit(c, {});
  const duplicates = await Promise.all(Array.from({ length: 20 }, () => b.submit({ ...c, requestId: randomUUID(), endpoint: "/api/submission/submit" }, {})));
  assert.ok(duplicates.every(r => r.httpStatus === 202));
  assert.equal(calls, 1);
  assert.equal((await store.get(c.submissionId))?.state, "processing");
  release();
  const completed = await first;
  assert.deepEqual(await b.submit(c, {}), completed);
  assert.equal(calls, 1);
  assert.equal((await b.submit({ ...c, dealerId: 2 }, {})).httpStatus, 409);
  assert.equal(await b.status(c.submissionId, 2), undefined);
});

test("timeout after possible delivery and ambiguous responses never resend or cancel", async () => {
  for (const response of ["timeout", "rejected", "empty"]) {
    const store = new Store(); let calls = 0;
    const service = new FinalizationService(store, async () => {
      calls++;
      if (response === "timeout") throw new Error("timeout after receiver wrote row");
      return { status: 200, data: response === "empty" ? {} : { success: false } };
    });
    const c = context();
    assert.equal((await service.submit(c, {})).httpStatus, 409);
    assert.equal((await service.submit(c, {})).httpStatus, 409);
    assert.equal((await service.status(c.submissionId, 1))?.status, "uncertain");
    assert.equal(calls, 1);
  }
});

test("distinct IDs for same beneficiary work; oven failure cannot replay final delivery", async () => {
  const store = new Store(); let calls = 0;
  const service = new FinalizationService(store, async () => { calls++; return success; });
  const c = context();
  const result = await service.submit(c, { personalId: "same-person" }, async () => { throw new Error("oven failed"); });
  assert.equal(result.httpStatus, 200);
  assert.deepEqual(await service.submit(c, {}), result);
  assert.equal((await service.submit(context(), { personalId: "same-person" })).httpStatus, 200);
  assert.equal(calls, 2);
});

test("crash or completion-write failure leaves a non-retryable claim", async () => {
  const store = new Store(); const c = context();
  await store.claim(c);
  store.rows.get(c.submissionId)!.updated_at = new Date(0);
  let calls = 0;
  const service = new FinalizationService(store, async () => { calls++; return success; });
  assert.equal((await service.submit(c, {})).httpStatus, 409);
  const fresh = context();
  store.settle = async () => { throw new Error("database unavailable"); };
  await assert.rejects(service.submit(fresh, {}));
  assert.equal((await service.submit(fresh, {})).httpStatus, 202);
  assert.equal(calls, 1);
});
