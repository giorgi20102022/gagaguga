import assert from "node:assert/strict";
import { test } from "node:test";
import express from "express";
import cookieParser from "cookie-parser";
import { createServer } from "node:http";
import jwt from "jsonwebtoken";
import { issueSmsProof } from "./smsVerification";

test("both real submission routes reject expired bypasses and ignore forged client flags", async () => {
  // No database or external webhook is contacted. Exercise registered HTTP routes
  // with a controlled storage boundary and their normal authentication middleware.
  process.env.DATABASE_URL = "postgresql://test:test@localhost:1/test";
  process.env.JWT_SECRET = "sms-route-test-secret";
  const { getStorage } = await import("./storage");
  const storage = getStorage();
  let deadline: Date | null = new Date(Date.now() - 1);
  let reads = 0;
  storage.getDealerById = async (id) => {
    reads++;
    return { id, requireSmsVerification: false, smsBypassExpiresAt: deadline } as any;
  };
  storage.getUserByUsername = async () => ({ id: 1, username: "test", password: "unused" });
  const { registerRoutes } = await import("./routes");
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  const server = createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number };
  const auth = jwt.sign({ role: "dealer", dealerId: 1, dealerKey: "iron" }, process.env.JWT_SECRET);
  const post = (path: string, proof = "", authenticated = true) => fetch(`http://127.0.0.1:${address.port}${path}`, {
    method: "POST", headers: { "Content-Type": "application/json", Cookie: authenticated ? `auth_token=${auth}; sms_verification=${proof}` : "" },
    body: JSON.stringify({ phone: "599123456", smsVerified: true, requireSmsVerification: false }),
  });
  try {
    for (const path of ["/api/submission/submit", "/api/workspace/submit"]) {
      assert.equal((await post(path, "", false)).status, 401);
      for (const invalid of [new Date(Date.now() - 1), null, new Date(NaN)]) {
        deadline = invalid;
        const response = await post(path);
        assert.equal(response.status, 403);
        assert.equal((await response.json()).code, "SMS_VERIFICATION_REQUIRED");
      }
      // An active bypass reaches the existing payload validation (our payload is intentionally incomplete).
      deadline = new Date(Date.now() + 60_000);
      assert.equal((await post(path)).status, 400);
      // The next request must re-read settings, even after an allowed request.
      deadline = new Date(Date.now() - 1);
      assert.equal((await post(path)).status, 403);
      assert.equal((await post(path, issueSmsProof(2, "599123456", process.env.JWT_SECRET))).status, 403);
      assert.equal((await post(path, issueSmsProof(1, "599123456", process.env.JWT_SECRET))).status, 400);
    }
    assert.ok(reads >= 14);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
