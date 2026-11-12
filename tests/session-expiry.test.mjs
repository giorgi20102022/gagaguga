import assert from 'node:assert/strict';
import {test} from 'node:test';
import {existsSync, readFileSync} from 'node:fs';
import {createServer} from 'node:http';
import {build} from 'esbuild';
import {chromium} from 'playwright-core';

// Real DealerDashboard + real re-login modal + real 401 interceptors. Every /api call is
// fulfilled locally; nothing leaves the machine.
const executablePath = process.env.TEST_BROWSER_PATH || ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
const pixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6pAAAAABJRU5ErkJggg==';
const photo = {name:'local.png',mimeType:'image/png',buffer:Buffer.from(pixel.split(',')[1],'base64')};
const dealer = {id:1,key:'iron',name:'Local dealer',email:'test@example.invalid',requireSmsVerification:true};
const identity = {name:'წიწა',surname:'ჭავჭავაძე',personalId:'01012345678',gender:'F',expiryDate:'2030-01-01'};
const MESSAGE = 'სესიას ვადა გაუვიდა. გთხოვთ, თავიდან შეხვიდეთ — შევსებული მონაცემები შენახულია.';
const RECOVERY_KEY = 'wizard_recovery:dealer_wizard_state';
const STATE_KEY = 'wizard_session_state:dealer_wizard_state';

const harness = `
import React from 'react';import {createRoot} from 'react-dom/client';import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import DealerDashboard from './client/src/pages/dealer/DealerDashboard';
import {SessionExpiredModal} from './client/src/components/SessionExpiredModal';
import {Toaster} from './client/src/components/ui/toaster';
import {installDealerSessionInterceptors} from './client/src/lib/dealerSession';
installDealerSessionInterceptors();
createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><DealerDashboard/><SessionExpiredModal/><Toaster/></QueryClientProvider>);`;

async function host() {
  const bundle = await build({stdin:{contents:harness,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,format:'iife',jsx:'automatic',define:{'process.env.NODE_ENV':'"test"'}});
  const css = existsSync('output/wizard-dom/style.css') ? readFileSync('output/wizard-dom/style.css','utf8') : '';
  const server = createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/bundle.js'?'application/javascript':'text/html; charset=utf-8');res.end(req.url==='/bundle.js'?bundle.outputFiles[0].text:`<meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script src="/bundle.js"></script>`);});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  return {url:`http://127.0.0.1:${server.address().port}`,close:()=>new Promise(r=>server.close(r))};
}

test('first 401 saves the draft, blocks the wizard with a Georgian re-login modal, and re-login resumes at the same step', async () => {
  const server = await host();
  const browser = await chromium.launch({executablePath,headless:true});
  try {
    const page = await (await browser.newContext()).newPage();
    page.setDefaultTimeout(8000);
    let alive = true;
    let meRequests = 0;
    const logins = [];
    await page.route('**/*', async r => {
      const u = new URL(r.request().url());
      if (u.origin !== server.url) return r.abort();
      if (!u.pathname.startsWith('/api/')) return r.continue();
      if (u.pathname === '/api/dealer/login') {
        const body = r.request().postDataJSON();logins.push(body);
        if (body.password !== 'right') return r.fulfill({status:401,json:{message:'Invalid credentials'}});
        alive = true;
        return r.fulfill({json:{role:'dealer',dealer}});
      }
      if (u.pathname === '/api/dealer/me') meRequests++;
      if (!alive) return r.fulfill({status:401,json:{code:'DEALER_SESSION_EXPIRED',message:'Authentication required'}});
      if (u.pathname === '/api/dealer/me') return r.fulfill({json:dealer});
      if (u.pathname.startsWith('/api/vision/extract-')) return r.fulfill({json:identity});
      if (u.pathname === '/api/verification/dealer-personal-id') return r.fulfill({json:{success:true,personalId:identity.personalId}});
      return r.fulfill({status:404,json:{}});
    });
    const state = () => page.evaluate(k => JSON.parse(sessionStorage.getItem(k)), STATE_KEY);
    const button = name => page.getByRole('button',{name,exact:true});

    await page.goto(server.url);
    await button('ID ბარათი').click();
    const inputs = page.locator('input[type=file]');await inputs.first().waitFor({state:'attached'});
    await inputs.nth(0).setInputFiles(photo);await inputs.nth(2).setInputFiles(photo);
    await button('გაგრძელება').click();
    await page.waitForFunction(k => JSON.parse(sessionStorage.getItem(k))?.formData.dealerPersonalIdVerified === true, STATE_KEY);
    const before = await state();
    assert.equal(before.step, 2);

    // Single poller: DealerDashboard and the modal both read the dealer, yet one focus
    // triggers exactly one /api/dealer/me request.
    const meBefore = meRequests;
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.waitForTimeout(300);
    assert.equal(meRequests - meBefore, 1, 'exactly one /api/dealer/me per poll');

    // Session dies; the very next poll is the first 401.
    alive = false;
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    const modal = page.getByRole('alertdialog');
    await modal.getByText(MESSAGE, {exact:true}).waitFor();
    const recovery = await page.evaluate(k => JSON.parse(localStorage.getItem(k)), RECOVERY_KEY);
    assert.equal(recovery.step, 2);
    assert.equal(recovery.dealerId, 1);
    assert.equal(recovery.formData.idNumber, before.formData.idNumber);
    assert.ok(recovery.formData.idFront, 'photos are part of the saved draft');
    // The wizard behind the modal is not reachable.
    assert.equal(await button('გაგრძელება').count(), 0, 'wizard controls are hidden behind the modal');
    assert.equal(await page.evaluate(() => getComputedStyle(document.body).pointerEvents), 'none');
    // Polling stops while expired.
    const meAtExpiry = meRequests;
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));await page.waitForTimeout(300);
    assert.equal(meRequests, meAtExpiry);
    // The modal cannot be dismissed.
    await page.keyboard.press('Escape');await modal.waitFor();

    // Wrong password keeps the modal up.
    assert.equal(await modal.getByLabel('ელ-ფოსტა').inputValue(), dealer.email);
    await modal.getByLabel('პაროლი').fill('wrong');await modal.getByRole('button',{name:'შესვლა'}).click();
    await modal.getByText('ელ-ფოსტა ან პაროლი არასწორია').waitFor();

    // Correct password resumes at the same step with the same data.
    await modal.getByLabel('პაროლი').fill('right');await modal.getByRole('button',{name:'შესვლა'}).click();
    await modal.waitFor({state:'detached'});
    assert.deepEqual(logins.map(l => l.email), [dealer.email, dealer.email]);
    const after = await state();
    assert.equal(after.step, 2);
    for (const field of ['firstName','lastName','idNumber','idFront','dealerPersonalIdVerified']) assert.deepEqual(after.formData[field], before.formData[field]);
    assert.equal(await page.evaluate(k => localStorage.getItem(k), RECOVERY_KEY), null, 'snapshot is consumed after re-login');
    await button('გაგრძელება').waitFor();

    // Closed-tab path: expire, then load the page fresh after logging in elsewhere.
    alive = false;
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await modal.getByText(MESSAGE, {exact:true}).waitFor();
    alive = true;
    // A closed tab loses sessionStorage; only the localStorage snapshot can bring it back.
    await page.evaluate(k => sessionStorage.removeItem(k), STATE_KEY);
    await page.reload();
    await page.waitForFunction(k => JSON.parse(sessionStorage.getItem(k))?.step === 2, STATE_KEY);
    const restored = await state();
    assert.equal(restored.formData.idNumber, before.formData.idNumber);
    assert.equal(await page.evaluate(k => localStorage.getItem(k), RECOVERY_KEY), null);
  } finally {
    await browser.close();await server.close();
  }
});
