import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import express from "express";
import cookieParser from "cookie-parser";
import jwt from "jsonwebtoken";
import axios from "axios";
import { build } from "esbuild";
import { chromium } from "playwright-core";
import { issueSmsProof } from "../server/smsVerification";

// This test deliberately does NOT claim to verify PostgreSQL. Only that boundary
// is simulated. Dashboards, hooks, FormData, routes, queue and Axios HTTP are real.
test("full dashboards -> real routes -> local recording webhook", { timeout: 600_000 }, async () => {
  process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:1/unavailable";
  process.env.JWT_SECRET = "local-recording-test-only";
  const pixel = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6pAAAAABJRU5ErkJggg==";
  const fixture = { firstName: "Synthetic", lastName: "Applicant", idNumber: "01012345678", phone: "599123456",
    supplierName: "Test Dealer", supplierId: "TEST-OVEN", model: "Test model", price: 100, subsidyRate: .5,
    finalPayable: 50, receiptPhoto: pixel, receiptVerified: true, signature: pixel,
    cityDistrict: "Test", addressVillage: "Test", smsVerified: true, dealerEmail: "test@example.invalid" };
  const records: Array<{ id: string; action: string; response: any }> = [];
  const recorder = createServer(async (req, res) => {
    let raw = ""; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    assert.equal(req.headers["idempotency-key"], body.submissionId);
    records.push({ id: body.submissionId, action: body.action || "application", response: res });
    console.log("RECORDED", JSON.stringify({ id: body.submissionId, action: body.action || "application" }));
    // Hold every reply until the scenario explicitly releases it.
  });
  await new Promise<void>(r => recorder.listen(0, "127.0.0.1", r));
  const webhook = `http://127.0.0.1:${(recorder.address() as any).port}/final`;
  process.env.SUBMIT_ALL_DATA_WEBHOOK = webhook;
  const outboundBlocker = axios.interceptors.request.use(config => {
    assert.equal(config.url, webhook, "Test must never contact any non-recorder backend service");
    return config;
  });
  const { pool } = await import("../server/db");
  const originalQuery = pool.query;
  const rows = new Map<string, any>();
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
    throw new Error("Unexpected database call in isolated recording test");
  }) as any;
  const { getStorage } = await import("../server/storage");
  const storage = getStorage();
  storage.getDealerById = async id => ({ id, key: "iron", name: "Test Dealer", email: fixture.dealerEmail,
    requireSmsVerification: true, identificationCode: "TEST" }) as any;
  storage.getProducts = async () => [];
  storage.getBranches = async () => [];
  storage.getUserByUsername = async () => ({ id: 1, username: "test", password: "unused" });

  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import {QueryClientProvider} from '@tanstack/react-query';
    import {queryClient} from './client/src/lib/queryClient';
    import Dashboard from './client/src/pages/Dashboard';
    import DealerDashboard from './client/src/pages/dealer/DealerDashboard';
    const Component=location.search.includes('workspace')?DealerDashboard:Dashboard;
    createRoot(document.getElementById('root')).render(<QueryClientProvider client={queryClient}><Component/></QueryClientProvider>);
  ` }, bundle: true, write: false, format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"test"' },
    plugins: [{ name: "test-only-state-access", setup(build) {
      build.onLoad({ filter: /(?:DealerDashboard|Dashboard)\.tsx$/ }, async args => {
        const source = await readFile(args.path, "utf8");
        if (!source.includes("const handleSubmit =")) return;
        // Only expose existing handler/state setters. No handler, guard, ID, timeout,
        // payload, submission hook or button logic is replaced or extracted.
        return { loader: "tsx", contents: source.replace("  const cancelSale =", `
          (window as any).__test = {submit:handleSubmit,ready:!!dealer&&!isRehydrating,step,
            seed:()=>{setFormData(${JSON.stringify(fixture)});setStep(5);},
            busy:submitInFlight.current};
          const cancelSale =`) };
      });
    } }],
  });
  const app = express(); app.use(express.json()); app.use(cookieParser());
  // Unrelated navigation/session probes need no real user data.
  app.get("/api/me", (_req,res) => res.status(401).json({ message: "No user session" }));
  app.get("/api/admin/me", (_req,res) => res.status(401).json({ message: "No admin session" }));
  const inbound: Array<{ path: string; status: number }> = [];
  app.use((req,res,next) => {
    if (["/api/submission/submit","/api/workspace/submit"].includes(req.path)) {
      res.on("finish", () => inbound.push({path:req.path,status:res.statusCode}));
    }
    next();
  });
  const server = createServer(app);
  const { registerRoutes } = await import("../server/routes"); await registerRoutes(server, app);
  app.get("/bundle.js", (_req,res) => res.type("js").send(bundle.outputFiles[0].text));
  app.get("/", (_req,res) => res.type("html").send('<div id="root"></div><script src="/bundle.js"></script>'));
  await new Promise<void>(r => server.listen(0,"127.0.0.1",r));
  const origin = `http://127.0.0.1:${(server.address() as any).port}`;
  const browser = await chromium.launch({ headless: true, executablePath: process.env.TEST_BROWSER_PATH || [
    "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  ].find(existsSync) });
  const report: any[] = [];
  const waitUntil = async (check: () => boolean, timeout = 75_000) => {
    const start = Date.now();
    while (!check()) { assert.ok(Date.now()-start < timeout, "Timed out waiting for recorded event"); await new Promise(r=>setTimeout(r,50)); }
  };
  const release = (record: typeof records[number]) => {
    record.response.writeHead(200, {"Content-Type":"application/json"}); record.response.end(JSON.stringify({success:true}));
  };
  try {
    for (const dashboard of (process.env.RECORDING_DASHBOARD ? [process.env.RECORDING_DASHBOARD] : ["dashboard", "workspace"])) {
      const context = await browser.newContext();
      await context.addCookies([
        { name: "auth_token", value: jwt.sign({ role:"dealer", dealerId:1, dealerKey:"iron" },process.env.JWT_SECRET!), url:origin },
        { name: "sms_verification", value: issueSmsProof(1,fixture.phone,process.env.JWT_SECRET!), url:origin },
      ]);
      const page = await context.newPage();
      await page.clock.install();
      // No browser request can contact production, including fonts or embedded assets.
      await page.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
      await page.goto(`${origin}/?${dashboard}`);
      await page.waitForFunction(()=> (window as any).__test?.ready);
      await page.evaluate(()=> (window as any).__test.seed());
      const finish=page.getByRole("button",{name:"განაცხადის გაგზავნა",exact:true});
      await finish.waitFor();
      await page.waitForFunction(()=>Array.from(document.querySelectorAll('button')).some(b=>b.textContent?.trim()==='განაცხადის გაგზავნა'&&!b.disabled));
      const offset=records.length;
      await page.evaluate(()=>{ (window as any).__capturedSubmit=(window as any).__test.submit; });
      await finish.evaluate(el=>{el.click();el.click();});
      await waitUntil(()=>records.length===offset+1);
      const first=records[offset];
      assert.equal(first.action,"application");
      report.push({dashboard,scenario:"rapid double-click",application:1,cancel:0,id:first.id});
      // Invoke real parent closure concurrently while the recorded HTTP reply is held.
      await page.evaluate(()=>Promise.all(Array.from({length:20},()=> (window as any).__capturedSubmit())));
      assert.equal(records.length,offset+1);
      report.push({dashboard,scenario:"20 concurrent handler calls while pending",application:1,cancel:0,id:first.id});
      const concurrent = await Promise.all(Array.from({length:8},(_,i)=>context.request.post(
        `${origin}${i%2?'/api/workspace/submit':'/api/submission/submit'}`,{data:{...fixture,submissionId:first.id}})));
      assert.ok(concurrent.every(r=>r.status()===202));
      assert.equal(records.length,offset+1);
      report.push({dashboard,scenario:"8 concurrent HTTP requests across both endpoints",application:1,cancel:0,id:first.id});

      // Advance only the browser clock to fire the REAL client abort timer (40s/120s).
      // Server, Axios, queue pacing and recording webhook use real wall time.
      await page.clock.fastForward(dashboard==="dashboard"?40_001:120_001);
      await page.waitForFunction(()=>!(window as any).__test.busy);
      const before=inbound.length;
      await page.evaluate(()=> (window as any).__capturedSubmit());
      await waitUntil(()=>inbound.length>before);
      assert.equal(inbound.at(-1)!.status,202);
      assert.equal(records.length,offset+1);
      report.push({dashboard,scenario:"client timeout then retry before webhook reply",application:1,cancel:0,id:first.id});
      release(first);
      await waitUntil(()=>rows.get(first.id)?.state==="completed");
      // Retry the saved multipart body against both endpoints after success too.
      const terminal = await context.request.post(`${origin}${dashboard==='dashboard'?'/api/workspace/submit':'/api/submission/submit'}`, {data:{...fixture,submissionId:first.id}});
      assert.equal(terminal.status(),200);
      assert.equal(records.length,offset+1);
      report.push({dashboard,scenario:"completed retry via other endpoint",application:1,cancel:0,id:first.id});
      // Let each real frontend observe success, resetting its own application ID.
      if (dashboard==="workspace") await page.clock.fastForward(60_001);
      else await page.evaluate(()=> (window as any).__capturedSubmit());
      await page.waitForFunction(()=> (window as any).__test.step===1);
      await page.clock.resume();

      // A late callback still belongs to the completed application, not the next one.
      const claimsBeforeLateCallback=rows.size;
      await page.evaluate(()=> (window as any).__capturedSubmit());
      if (rows.size > claimsBeforeLateCallback) {
        await waitUntil(()=>records.length>offset+1);
      }
      assert.equal(records.length,offset+1,"A late completed-application callback must not dispatch a second application");
      report.push({dashboard,scenario:"late original handler after frontend success",application:1,cancel:0,id:first.id});

      await page.evaluate(()=> (window as any).__test.seed());
      const next=page.evaluate(()=>Promise.all(Array.from({length:20},()=> (window as any).__test.submit())));
      await waitUntil(()=>records.length===offset+2);
      assert.notEqual(records[offset+1].id,first.id);
      release(records[offset+1]); await next;
      await waitUntil(()=>rows.get(records[offset+1].id)?.state==="completed");
      if (dashboard==="dashboard") await page.evaluate(()=> (window as any).__test.submit());
      report.push({dashboard,scenario:"genuinely new application after success",application:2,cancel:0,id:records[offset+1].id});
      assert.equal(records.slice(offset).filter(r=>r.action==="cancel").length,0);
      console.log("SCENARIOS",JSON.stringify(report.filter(r=>r.dashboard===dashboard)));
      await context.close();
    }
    await writeFile("docs/finalization-recording-results.json",JSON.stringify({database:"SIMULATED; PostgreSQL verification BLOCKED",report},null,2)+"\n");
  } finally {
    for (const record of records) record.response.destroy();
    await browser.close(); axios.interceptors.request.eject(outboundBlocker); pool.query=originalQuery;
    server.closeAllConnections(); recorder.closeAllConnections();
    await Promise.all([new Promise<void>(r=>server.close(()=>r())),new Promise<void>(r=>recorder.close(()=>r()))]);
  }
});
