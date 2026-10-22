import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync, existsSync } from "node:fs";
import { createServer } from "node:http";
import { build } from "esbuild";
import { chromium } from "playwright-core";

// Render the real identity component and execute each dashboard's actual validation
// and navigation handlers, without login, a database, or live OCR calls.
const pixel = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6pAAAAABJRU5ErkJggg==";
const successful = { name: "Test", surname: "Customer", personalId: "01012345678", gender: "F", expiryDate: "2030-01-01" };
const executablePath = process.env.TEST_BROWSER_PATH || [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
].find(existsSync);

for (const dashboard of ["client/src/pages/dealer/DealerDashboard.tsx", "client/src/pages/Dashboard.tsx"]) {
  test(`${dashboard}: identity verification and navigation`, async t => {
    const source = readFileSync(dashboard, "utf8");
    const navigation = source.slice(source.indexOf("  const validateStep ="), source.indexOf("  const prevStep ="));
    assert.ok(navigation.includes("const nextStep"));
    const bundle = await build({
      stdin: { contents: `
        import React, {useState, useCallback} from 'react';
        import {createRoot} from 'react-dom/client';
        import {AnimatePresence} from 'framer-motion';
        import {Step1Identity} from './client/src/components/wizard/Step1Identity';
        import {Step2Profile} from './client/src/components/wizard/Step2Profile';
        import {Step4Finalize} from './client/src/components/wizard/Step4Finalize';
        function Harness() {
          const mode = new URLSearchParams(location.search).get('mode') || 'identity';
          const [formData, setFormData] = useState({documentType: mode === 'passport' ? 'passport' : 'id_card', idFront:${JSON.stringify(pixel)}, idBack:${JSON.stringify(pixel)},
            ...(mode === 'passport' ? {passportPhoto:${JSON.stringify(pixel)}} : {}),
            ...(mode === 'profile' || mode === 'receipt' ? {firstName:'Test',lastName:'Customer',idNumber:'01012345678',
              sociallyVulnerable:true,pensioner:true,socialExtract:${JSON.stringify(pixel)},pensionerCertificate:${JSON.stringify(pixel)},socialVerified:true,pensionerVerified:true,
              receiptPhoto:${JSON.stringify(pixel)},model:'Test',price:100,finalPayable:100,phone:'599123456'} : {})});
          const [step,setStep] = useState(mode === 'profile' ? 3 : mode === 'receipt' ? 5 : 1);
          const updateData = useCallback(patch => setFormData(current => ({...current,...patch})), []);
          ${navigation}
          window.replacePhoto = () => updateData({idFront: ${JSON.stringify(pixel)} + '#replacement', firstName:'', lastName:'', idNumber:''});
          return <><output id="step">{step}</output><pre id="state">{JSON.stringify(formData)}</pre>
            <button id="back" onClick={()=>setStep(1)}>Back</button>
            <button id="leave" onClick={()=>setStep(3)}>Leave</button>
            <AnimatePresence mode="wait">{step === 1 ? <Step1Identity key="identity" data={formData} updateData={updateData} onNext={nextStep}/>
              : mode === 'profile' ? <Step2Profile key="profile" data={formData} updateData={updateData} onNext={nextStep} onBack={()=>setStep(1)}/>
              : mode === 'receipt' ? <Step4Finalize key="receipt" data={formData} updateData={updateData} onSubmit={()=>{}} onBack={()=>{}} isSubmitting={false} active={true}/>
              : <div key="next" id="next">{formData.firstName} {formData.idNumber}</div>}</AnimatePresence>
          </>;
        }
        createRoot(document.getElementById('root')).render(<Harness/>);
      `, resolveDir: process.cwd(), loader: "tsx" },
      bundle: true, write: false, format: "iife", jsx: "automatic",
      define: { "process.env.NODE_ENV": '"test"' },
    });
    const server = createServer((req, res) => {
      res.setHeader("Content-Type", req.url === "/bundle.js" ? "application/javascript" : "text/html; charset=utf-8");
      res.end(req.url === "/bundle.js" ? bundle.outputFiles[0].text : '<div id="root"></div><script src="/bundle.js"></script>');
    });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    const browser = await chromium.launch({ executablePath, headless: true });
    const base = `http://127.0.0.1:${server.address().port}`;
    const open = async (mode = 'identity') => {
      const page = await browser.newPage();
      page.ocrRequests = 0;
      page.on("request", request => { if (request.url().includes("/api/vision/extract-")) page.ocrRequests++; });
      await page.route('**/api/dealer/me', route => route.fulfill({contentType:'application/json', body:JSON.stringify({id:1,requireSmsVerification:true})}));
      await page.goto(`${base}?mode=${mode}`);
      await page.getByRole("button", { name: mode === 'receipt' ? "შეამოწმე ქვითარი" : "გაგრძელება", exact: true }).waitFor();
      return page;
    };
    const begin = async page => {
      let resolve;
      const request = new Promise(r => { resolve = r; });
      let count = 0;
      await page.route("**/api/vision/extract-*", route => { count++; resolve(route); });
      await page.getByRole("button", { name: "გაგრძელება", exact: true }).evaluate(button => { button.click(); button.click(); });
      return { route: await request, count: () => count };
    };
    const respond = (route, body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    try {
      await t.test("upload alone does not advance; success advances once with current data; Back stays put", async () => {
        const page = await open();
        assert.equal(await page.locator("#step").textContent(), "1");
        assert.equal(page.ocrRequests, 0);
        const request = await begin(page);
        assert.equal(await page.getByRole("button", { name: "მონაცემები მუშავდება...", exact: true }).isDisabled(), true);
        await respond(request.route, successful);
        await page.waitForFunction(() => document.querySelector("#step").textContent === "2");
        const data = JSON.parse(await page.locator("#state").textContent());
        assert.equal(data.idNumber, successful.personalId);
        assert.equal(data.firstName, successful.name);
        assert.equal(request.count(), 1);
        await page.locator("#back").click();
        await page.getByRole("button", { name: "გაგრძელება", exact: true }).waitFor();
        assert.equal(await page.locator("#step").textContent(), "1");
        assert.equal(request.count(), 1);
        await page.close();
      });
      await t.test("backend failure clears both ID photos, keeps exact message, and allows same-file retry", async () => {
        const page = await open();
        const request = await begin(page);
        const message = "დოკუმენტი ვერ დადასტურდა — n8n-ის ზუსტი პასუხი";
        await respond(request.route, { success: false, message }, 400);
        await page.getByRole("alertdialog").waitFor();
        assert.equal(await page.getByRole("heading", { name: message }).textContent(), message);
        assert.equal(await page.locator("#step").textContent(), "1");
        const cleared = JSON.parse(await page.locator("#state").textContent());
        assert.equal(cleared.idFront, undefined);
        assert.equal(cleared.idBack, undefined);
        await page.getByRole("button", { name: "გასაგებია", exact: true }).click();
        assert.equal(request.count(), 1);
        assert.equal(await page.getByRole("button", { name: "გაგრძელება", exact: true }).isDisabled(), true);
        assert.deepEqual(await page.locator('input[type="file"]').evaluateAll(inputs => inputs.map(input => input.value)), ["", "", "", ""]);
        const sameFile = { name: "identity.png", mimeType: "image/png", buffer: Buffer.from(pixel.split(",")[1], "base64") };
        await page.locator('input[type="file"]').nth(0).setInputFiles(sameFile);
        await page.locator('input[type="file"]').nth(2).setInputFiles(sameFile);
        await page.waitForFunction(() => { const data = JSON.parse(document.querySelector('#state').textContent); return data.idFront && data.idBack; });
        const retry = await begin(page);
        await respond(retry.route, successful);
        await page.waitForFunction(() => document.querySelector('#step').textContent === '2');
        assert.equal(retry.count(), 1);
        await page.close();
      });
      await t.test("incomplete success cannot skip the required personal number", async () => {
        const page = await open();
        const request = await begin(page);
        await respond(request.route, { name: "Test", surname: "Customer" });
        await page.getByRole("alertdialog").waitFor();
        assert.equal(await page.locator("#step").textContent(), "1");
        await page.close();
      });
      await t.test("network failures, malformed responses and timeouts clear both photos", async () => {
        for (const failure of ['network', 'malformed', 'timeout']) {
          const timeout = failure === 'timeout';
          const page = await open();
          if (timeout) await page.clock.install();
          const request = await begin(page);
          if (timeout) await page.clock.fastForward(120_001);
          else if (failure === 'network') await request.route.abort('failed');
          else await request.route.fulfill({ status: 200, contentType: "text/plain", body: "not JSON" });
          await page.getByRole("alertdialog").waitFor();
          assert.equal(await page.locator("#step").textContent(), "1");
          const cleared = JSON.parse(await page.locator("#state").textContent());
          assert.equal(cleared.idFront, undefined);
          assert.equal(cleared.idBack, undefined);
          if (timeout) await respond(request.route, successful);
          assert.equal(await page.locator("#step").textContent(), "1");
          await page.close();
        }
      });
      await t.test("replaced-photo and abandoned-request responses cannot navigate", async () => {
        for (const rejected of [false, true]) {
        for (const abandon of [false, true]) {
          const page = await open();
          const request = await begin(page);
          if (abandon) await page.locator("#leave").click();
          else await page.evaluate(() => window.replacePhoto());
          if (rejected) await request.route.abort('failed');
          else await respond(request.route, successful);
          // Let the request's microtasks and React rendering settle.
          await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
          assert.equal(await page.locator("#step").textContent(), abandon ? "3" : "1");
          assert.equal(JSON.parse(await page.locator("#state").textContent()).firstName || "", "");
          if (!abandon) assert.equal(JSON.parse(await page.locator("#state").textContent()).idFront, pixel + '#replacement');
          await page.close();
        }
        }
      });
      await t.test("passport upload does not dispatch OCR; Continue verifies and advances once", async () => {
        const page = await open();
        await page.getByRole("button", { name: "პასპორტი", exact: true }).click();
        await page.locator('input[type="file"]').first().setInputFiles({ name: "passport.png", mimeType: "image/png", buffer: Buffer.from(pixel.split(",")[1], "base64") });
        await page.waitForFunction(() => Boolean(JSON.parse(document.querySelector("#state").textContent).passportPhoto));
        assert.equal(await page.locator("#step").textContent(), "1");
        assert.equal(page.ocrRequests, 0);
        const request = await begin(page);
        await respond(request.route, successful);
        await page.waitForFunction(() => document.querySelector("#step").textContent === "2");
        assert.equal(JSON.parse(await page.locator("#state").textContent()).idNumber, successful.personalId);
        assert.equal(request.count(), 1);
        await page.close();
      });
      await t.test("passport failure clears only its photo and allows the same file again", async () => {
        const page = await open('passport');
        const request = await begin(page);
        await respond(request.route, { success:false, message:'Passport rejected' }, 400);
        await page.getByRole('alertdialog').waitFor();
        const data = JSON.parse(await page.locator('#state').textContent());
        assert.equal(data.passportPhoto, undefined);
        assert.equal(data.idFront, pixel);
        assert.equal(data.documentType, 'passport');
        await page.getByRole('button', {name:'გასაგებია',exact:true}).click();
        assert.equal(await page.getByRole('button', {name:'გაგრძელება',exact:true}).isDisabled(), true);
        await page.locator('input[type="file"]').first().setInputFiles({name:'passport.png',mimeType:'image/png',buffer:Buffer.from(pixel.split(',')[1],'base64')});
        await page.waitForFunction(() => Boolean(JSON.parse(document.querySelector('#state').textContent).passportPhoto));
        const retry = await begin(page);
        await respond(retry.route, successful);
        await page.waitForFunction(() => document.querySelector('#step').textContent === '2');
        await page.close();
      });
      for (const kind of ['social', 'pensioner']) {
        await t.test(`${kind}: rejection resets only the failed supporting document and its input`, async () => {
          const page = await open('profile');
          const field = kind === 'social' ? 'socialExtract' : 'pensionerCertificate';
          const other = kind === 'social' ? 'pensionerCertificate' : 'socialExtract';
          const index = kind === 'social' ? 0 : 2;
          const file = {name:'support.png',mimeType:'image/png',buffer:Buffer.from(pixel.split(',')[1],'base64')};
          await page.locator('input[type="file"]').nth(index).setInputFiles(file);
          let resolve;
          const received = new Promise(r => { resolve = r; });
          await page.route('**/api/vision/verify-*', route => resolve(route));
          await page.getByRole('button', {name:'გაგზავნა და შემოწმება',exact:true}).click();
          await respond(await received, {success:false,message:'Exact supporting document rejection'}, 400);
          await page.getByRole('alertdialog').waitFor();
          assert.equal(await page.getByRole('heading',{name:'Exact supporting document rejection'}).textContent(), 'Exact supporting document rejection');
          const data = JSON.parse(await page.locator('#state').textContent());
          assert.equal(data[field], undefined);
          assert.equal(data[kind + 'Verified'], false);
          assert.equal(data[other], pixel);
          assert.equal(data.idFront, pixel);
          assert.equal(data.firstName, 'Test');
          await page.getByRole('button', {name:'გასაგებია',exact:true}).click();
          assert.equal(await page.getByRole('button', {name:'გაგრძელება',exact:true}).isDisabled(), true);
          assert.equal(await page.locator('input[type="file"]').nth(index).inputValue(), '');
          await page.locator('input[type="file"]').nth(index).setInputFiles(file);
          await page.waitForFunction(field => Boolean(JSON.parse(document.querySelector('#state').textContent)[field]), field);
          assert.equal(await page.getByRole('button', {name:'გაგზავნა და შემოწმება',exact:true}).isEnabled(), true);
          await page.close();
        });
      }
      await t.test('receipt rejection clears only receipt and derived verification, supports same-file retry', async () => {
        const page = await open('receipt');
        let resolve;
        const received = new Promise(r => { resolve = r; });
        await page.route('**/api/vision/verify-receipt', route => resolve(route));
        await page.getByRole('button',{name:'შეამოწმე ქვითარი',exact:true}).click();
        await respond(await received, {success:false,message:'Exact receipt rejection'},400);
        await page.getByRole('alertdialog').waitFor();
        const data = JSON.parse(await page.locator('#state').textContent());
        assert.equal(data.receiptPhoto, undefined);
        assert.equal(data.receiptVerified, false);
        assert.equal(data.receiptVerificationMessage, undefined);
        assert.equal(data.idFront, pixel);
        assert.equal(data.socialExtract, pixel);
        assert.equal(data.finalPayable, 100);
        assert.equal(await page.getByRole('heading',{name:'Exact receipt rejection'}).textContent(),'Exact receipt rejection');
        await page.getByRole('button',{name:'გასაგებია',exact:true}).click();
        assert.equal(await page.locator('input[type="file"]').first().inputValue(), '');
        await page.locator('input[type="file"]').first().setInputFiles({name:'receipt.png',mimeType:'image/png',buffer:Buffer.from(pixel.split(',')[1],'base64')});
        await page.waitForFunction(() => Boolean(JSON.parse(document.querySelector('#state').textContent).receiptPhoto));
        await page.route('**/api/vision/verify-receipt', route => respond(route,{total_amount:100}));
        await page.getByRole('button',{name:'შეამოწმე ქვითარი',exact:true}).click();
        await page.waitForFunction(() => JSON.parse(document.querySelector('#state').textContent).receiptVerified === true);
        await page.close();
      });
      await t.test('receipt timeout ignores a late success; SMS errors do not clear receipt', async () => {
        const page = await open('receipt');
        await page.route('**/api/verification/send-sms', route => respond(route,{message:'SMS unavailable'},500));
        await page.getByRole('button',{name:'კოდი',exact:true}).click();
        await page.getByText('SMS unavailable',{exact:true}).waitFor();
        assert.equal(JSON.parse(await page.locator('#state').textContent()).receiptPhoto, pixel);
        await page.clock.install();
        let resolve;
        const received = new Promise(r => { resolve = r; });
        await page.route('**/api/vision/verify-receipt', route => resolve(route));
        await page.getByRole('button',{name:'შეამოწმე ქვითარი',exact:true}).click();
        const route = await received;
        await page.clock.fastForward(120_001);
        await page.getByRole('alertdialog').waitFor();
        await respond(route,{total_amount:100});
        await page.clock.runFor(100);
        const data = JSON.parse(await page.locator('#state').textContent());
        assert.equal(data.receiptPhoto, undefined);
        assert.equal(data.receiptVerified, false);
        assert.equal(data.socialExtract, pixel);
        await page.close();
      });
      await t.test('supporting-document timeouts ignore late success and retain the other attachment', async () => {
        for (const kind of ['social','pensioner']) {
          const page = await open('profile');
          const field = kind === 'social' ? 'socialExtract' : 'pensionerCertificate';
          await page.locator('input[type="file"]').nth(kind === 'social' ? 0 : 2).setInputFiles({name:'support.png',mimeType:'image/png',buffer:Buffer.from(pixel.split(',')[1],'base64')});
          await page.waitForFunction(field => JSON.parse(document.querySelector('#state').textContent)[field] !== undefined, field);
          await page.clock.install();
          let resolve;
          const received = new Promise(r => { resolve = r; });
          await page.route('**/api/vision/verify-*', route => resolve(route));
          await page.getByRole('button',{name:'გაგზავნა და შემოწმება',exact:true}).click();
          const route = await received;
          await page.clock.fastForward(120_001);
          await page.getByRole('alertdialog').waitFor();
          await respond(route,{success:true,personalId:'01012345678'});
          await page.clock.runFor(100);
          const data = JSON.parse(await page.locator('#state').textContent());
          assert.equal(data[field], undefined);
          assert.equal(data[kind+'Verified'], false);
          assert.equal(data[kind === 'social' ? 'pensionerCertificate' : 'socialExtract'], pixel);
          await page.close();
        }
      });
    } finally {
      await browser.close();
      await new Promise(resolve => server.close(resolve));
    }
  });
}
