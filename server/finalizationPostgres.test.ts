import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";
import { FinalizationService, PostgresFinalizationStore } from "./finalization";

// Explicit disposable test database only; never fall back to the application's DATABASE_URL.
test("PostgreSQL: independent pools atomically claim one ID and retain results after reconnect", {
  skip: !process.env.TEST_FINALIZATION_DATABASE_URL,
}, async () => {
  const connectionString = process.env.TEST_FINALIZATION_DATABASE_URL;
  const schema = `finalization_test_${randomUUID().replaceAll("-", "")}`;
  const admin = new pg.Pool({ connectionString });
  await admin.query(`CREATE SCHEMA ${schema}`);
  const options = `-c search_path=${schema}`;
  const a = new pg.Pool({ connectionString, options }), b = new pg.Pool({ connectionString, options });
  try {
    await a.query("CREATE TABLE dealers (id INTEGER PRIMARY KEY)");
    await a.query("INSERT INTO dealers VALUES (1)");
    await a.query(await readFile("migrations/20261023_final_submission_idempotency.sql", "utf8"));
    let calls = 0;
    const dispatch = async () => { calls++; await new Promise(r => setTimeout(r, 100)); return { status: 200, data: { success: true } }; };
    const services = [a, b].map(p => new FinalizationService(new PostgresFinalizationStore(p), dispatch));
    const c = { submissionId: randomUUID(), dealerId: 1, requestId: randomUUID(), endpoint: "/api/workspace/submit" };
    const results = await Promise.all(Array.from({ length: 20 }, (_, i) => services[i % 2].submit({ ...c, requestId: randomUUID() }, {})));
    assert.equal(calls, 1);
    assert.ok(results.some(r => r.httpStatus === 200));
    const fresh = new pg.Pool({ connectionString, options });
    try {
      const restarted = new FinalizationService(new PostgresFinalizationStore(fresh), dispatch);
      assert.equal((await restarted.submit(c, {})).httpStatus, 200);
      assert.equal(calls, 1);
    } finally { await fresh.end(); }
  } finally {
    await a.end(); await b.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  }
});
