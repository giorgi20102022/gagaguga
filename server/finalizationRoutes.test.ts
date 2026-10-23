import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import express from "express";
import cookieParser from "cookie-parser";
import jwt from "jsonwebtoken";
import axios from "axios";
import { issueSmsProof } from "./smsVerification";

test("real endpoints: simultaneous verified-SMS and bypass submissions share one delivery and enforce ownership", async () => {
  process.env.DATABASE_URL = "postgresql://test:test@localhost:1/test";
  process.env.JWT_SECRET = "route-test-secret";
  const { pool } = await import("./db");
  const rows = new Map<string, any>();
  const originalQuery = pool.query;
  pool.query = (async (sql: string, values: any[]) => {
    const [id] = values;
    if (sql.startsWith("INSERT INTO final_submissions")) {
      if (rows.has(id)) return { rows: [] };
      rows.set(id, { dealer_id: values[1], state: "processing", updated_at: new Date() });
      return { rows: [{ submission_id: id }] };
    }
    if (sql.startsWith("SELECT * FROM final_submissions")) return { rows: rows.has(id) ? [rows.get(id)] : [] };
    if (sql.startsWith("UPDATE final_submissions")) {
      Object.assign(rows.get(id), { state: values[1], result: JSON.parse(values[2] || "null") });
      return { rows: [] };
    }
    throw new Error("Unexpected SQL in isolated test");
  }) as any;
  const { getStorage } = await import("./storage");
  const storage = getStorage();
  let bypass = true;
  storage.getDealerById = async id => ({ id, name: "Test", key: "iron", requireSmsVerification: !bypass,
    smsBypassExpiresAt: new Date(Date.now() + 60_000) }) as any;
  storage.getProducts = async () => [];
  storage.getUserByUsername = async () => ({ id: 1, username: "test", password: "unused" });
  const originalPost = axios.post;
  let calls = 0, release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  axios.post = (async (_url: string, body: any, options: any) => {
    calls++;
    assert.equal(body.submission_id, id);
    assert.equal(options.headers["Idempotency-Key"], id);
    assert.equal(options.maxRedirects, 0);
    await gate;
    return { status: 200, data: { success: true } };
  }) as any;
  const { registerRoutes } = await import("./routes");
  const app = express(); app.use(express.json()); app.use(cookieParser());
  const server = createServer(app); await registerRoutes(server, app);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const id = randomUUID();
  const payload = { submissionId: id, firstName: "Test", lastName: "Test", idNumber: "same", phone: "599123456",
    addressVillage: "Test", supplierName: "Test", supplierId: "Test", model: "Test", price: 100,
    subsidyRate: .5, finalPayable: 50, receiptPhoto: "test", receiptVerified: true, dealerEmail: "test@example.com" };
  const cookie = (dealerId = 1) => `auth_token=${jwt.sign({ role: "dealer", dealerId, dealerKey: "iron" }, process.env.JWT_SECRET!)}; sms_verification=${issueSmsProof(dealerId, payload.phone, process.env.JWT_SECRET!)}`;
  const post = (path: string, dealerId = 1) => fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie(dealerId) }, body: JSON.stringify(payload) });
  try {
    const first = post("/api/workspace/submit");
    while (calls === 0) await new Promise(resolve => setTimeout(resolve, 5));
    bypass = false;
    const duplicates = await Promise.all(Array.from({ length: 8 }, (_, i) => post(i % 2 ? "/api/workspace/submit" : "/api/submission/submit")));
    assert.ok(duplicates.every(r => r.status === 202));
    release();
    const result = await first;
    assert.equal(result.status, 200);
    const body = await result.json();
    assert.deepEqual(await (await post("/api/submission/submit")).json(), body);
    assert.equal(calls, 1);
    assert.equal((await post("/api/submission/submit", 2)).status, 409);
    assert.equal((await fetch(`${base}/api/submission-status/${id}`)).status, 401);
    assert.equal((await fetch(`${base}/api/submission-status/${id}`, { headers: { Cookie: cookie(2) } })).status, 404);
    assert.equal((await (await fetch(`${base}/api/submission-status/${id}`, { headers: { Cookie: cookie() } })).json()).status, "success");
  } finally {
    release(); axios.post = originalPost; pool.query = originalQuery;
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
