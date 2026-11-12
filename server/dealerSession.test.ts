import assert from "node:assert/strict";
import { test } from "node:test";
import express from "express";
import cookieParser from "cookie-parser";
import { createServer } from "node:http";
import jwt from "jsonwebtoken";
import axios from "axios";

const WIZARD_ENDPOINTS: Array<[method: "GET" | "POST", path: string]> = [
  ["GET", "/api/dealer/me"],
  ["GET", "/api/products"],
  ["GET", "/api/branches"],
  ["POST", "/api/vision/extract-id"],
  ["POST", "/api/vision/extract-passport"],
  ["POST", "/api/vision/extract-passport-file"],
  ["POST", "/api/vision/verify-receipt"],
  ["POST", "/api/vision/verify-pensioner"],
  ["POST", "/api/vision/verify-social-card"],
  ["POST", "/api/vision/verify-oven"],
  ["POST", "/api/verification/dealer-personal-id"],
  ["POST", "/api/check-stove-code"],
  ["POST", "/api/verification/send-sms"],
  ["POST", "/api/verification/verify-sms"],
];

test("dealer wizard endpoints require a dealer session; the session is rolling and server-scoped", async () => {
  // No database, n8n, Gemini or portal is contacted: storage and axios are stubbed.
  process.env.DATABASE_URL = "postgresql://test:test@localhost:1/test";
  process.env.JWT_SECRET = "dealer-session-test-secret";
  const secret = process.env.JWT_SECRET;
  const { getStorage } = await import("./storage");
  const storage = getStorage();
  const existingDealers = new Set([1, 7]);
  storage.getDealerById = async (id) =>
    existingDealers.has(id) ? ({ id, key: id === 7 ? "seven" : "iron", name: `Dealer ${id}`, email: `d${id}@example.invalid` } as any) : undefined;
  const productQueries: number[] = [];
  storage.getProducts = async (dealerId) => { productQueries.push(dealerId); return []; };
  storage.getUserByUsername = async () => ({ id: 1, username: "test", password: "unused" });
  storage.getDealerIdByKey = async () => { throw new Error("?dealer= must not be used to pick the dealer"); };

  const outbound: any[] = [];
  const originalPost = axios.post;
  (axios as any).post = async (url: string, body: any) => {
    outbound.push({ url, body });
    return { data: { status: "success" } };
  };

  const { registerRoutes } = await import("./routes");
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  const server = createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

  const dealerToken = (dealerId: number, ageSeconds = 0, extra: object = {}) =>
    jwt.sign({ role: "dealer", dealerId, dealerKey: "iron", email: "d@example.invalid", iat: Math.floor(Date.now() / 1000) - ageSeconds, ...extra }, secret);
  const call = (method: string, path: string, cookie = "", body: object = {}) =>
    fetch(base + path, {
      method,
      headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
      body: method === "GET" ? undefined : JSON.stringify(body),
    });

  try {
    // 1. No session, expired session, or an admin token: rejected before any handler runs.
    const expired = jwt.sign({ role: "dealer", dealerId: 1, dealerKey: "iron", exp: Math.floor(Date.now() / 1000) - 1 }, secret);
    const admin = jwt.sign({ role: "admin", email: "admin@example.invalid" }, secret);
    for (const [method, path] of WIZARD_ENDPOINTS) {
      const anonymous = await call(method, path);
      assert.equal(anonymous.status, 401, `${path} without session`);
      assert.equal((await anonymous.json()).code, "DEALER_SESSION_EXPIRED");
      assert.equal((await call(method, path, `dealer_token=${expired}`)).status, 401, `${path} expired`);
      assert.equal((await call(method, path, `auth_token=${admin}`)).status, 403, `${path} admin token`);
    }
    assert.equal(outbound.length, 0, "no paid/external API may be called without a session");

    // 2. Products come from the session's dealer, never from ?dealer=.
    const products = await call("GET", "/api/products?dealer=someone-else", `dealer_token=${dealerToken(7)}`);
    assert.equal(products.status, 200);
    assert.deepEqual(productQueries, [7]);

    // 3. A fresh session is not re-issued on every request…
    const fresh = await call("GET", "/api/dealer/me", `dealer_token=${dealerToken(1)}`);
    assert.equal(fresh.status, 200);
    assert.equal(fresh.headers.getSetCookie().length, 0);

    // …but an older one rolls forward with a new 12-hour lifetime.
    const rolled = await call("GET", "/api/dealer/me", `dealer_token=${dealerToken(1, 10 * 60)}`);
    assert.equal(rolled.status, 200);
    const cookies = rolled.headers.getSetCookie();
    const dealerCookie = cookies.find((c) => c.startsWith("dealer_token="));
    assert.ok(dealerCookie, "dealer_token must be re-issued");
    assert.match(dealerCookie!, /Max-Age=43200/);
    assert.match(dealerCookie!, /HttpOnly/);
    const renewed = jwt.verify(dealerCookie!.split(";")[0].split("=")[1], secret) as jwt.JwtPayload;
    assert.equal(renewed.dealerId, 1);
    assert.equal(renewed.role, "dealer");
    assert.ok(renewed.exp! - renewed.iat! === 12 * 60 * 60);
    assert.ok(cookies.some((c) => c.startsWith("auth_token=")), "auth_token holding the same session rolls too");

    // auth_token held by a different (admin) login is left alone.
    const mixed = await call("GET", "/api/dealer/me", `dealer_token=${dealerToken(1, 10 * 60)}; auth_token=${admin}`);
    assert.equal(mixed.status, 200);
    assert.ok(!mixed.headers.getSetCookie().some((c) => c.startsWith("auth_token=")));

    // 4. A deleted dealer cannot keep a rolling session alive.
    existingDealers.delete(1);
    assert.equal((await call("POST", "/api/vision/verify-receipt", `dealer_token=${dealerToken(1, 10 * 60)}`, { image: "x" })).status, 401);
    existingDealers.add(1);

    // 5. Stove-code dealer identity comes from the session, not the request body.
    const stove = await call("POST", "/api/check-stove-code", `dealer_token=${dealerToken(7)}`, {
      code: "ABC123", dealer_name: "Forged dealer", branch_name: "Forged branch",
    });
    assert.equal(stove.status, 200);
    assert.equal(outbound.length, 1);
    assert.equal(outbound[0].body.dealer_name, "Dealer 7");
    assert.equal(outbound[0].body.branch_name, "Dealer 7");
  } finally {
    (axios as any).post = originalPost;
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});
