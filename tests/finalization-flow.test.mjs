import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync, existsSync } from "node:fs";
import { createServer } from "node:http";
import { build } from "esbuild";
import { chromium } from "playwright-core";

const executablePath = process.env.TEST_BROWSER_PATH || [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
].find(existsSync);

test("real final component: rapid clicks, repeated SMS callbacks, bypass, and remounts", async () => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
    import React, {useState,useCallback} from 'react';
    import {createRoot} from 'react-dom/client';
    import {Step4Finalize} from './client/src/components/wizard/Step4Finalize';
    import {applicationId,completeApplication} from './client/src/lib/finalization';
    window.calls=0;
    window.id=()=>applicationId(1);
    window.complete=()=>completeApplication(1,applicationId(1));
    function Harness(){
      const [version,setVersion]=useState(0);
      const [data,setData]=useState({firstName:'Test',lastName:'User',model:'Test',price:100,finalPayable:50,
        cityDistrict:'Test',addressVillage:'Test',phone:'599123456',receiptPhoto:'data:image/png;base64,AA==',receiptVerified:true});
      const updateData=useCallback(p=>setData(d=>({...d,...p})),[]);
      window.remount=()=>setVersion(v=>v+1);
      return <Step4Finalize key={version} data={data} updateData={updateData} active={true} isSubmitting={false}
        onSubmit={async()=>{window.calls++;await new Promise(r=>window.release=r);}} onBack={()=>{}}/>;
    }
    createRoot(document.getElementById('root')).render(<Harness/>);
  ` }, bundle: true, write: false, format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"test"' } });
  const server = createServer((req,res) => {
    res.setHeader("Content-Type",req.url === "/bundle.js" ? "application/javascript" : "text/html; charset=utf-8");
    res.end(req.url === "/bundle.js" ? bundle.outputFiles[0].text : '<div id="root"></div><script src="/bundle.js"></script>');
  });
  await new Promise(r=>server.listen(0,"127.0.0.1",r));
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    for (const bypass of [false,true]) {
      const page=await browser.newPage();
      await page.route('**/api/dealer/me',r=>r.fulfill({json:{id:1,requireSmsVerification:!bypass,
        smsBypassExpiresAt:new Date(Date.now()+60_000).toISOString(),serverNow:new Date().toISOString()}}));
      await page.route('**/api/verification/send-sms',r=>r.fulfill({json:{success:true}}));
      await page.route('**/api/verification/verify-sms',async r=>{
        await new Promise(resolve=>setTimeout(resolve,100));
        await r.fulfill({json:{success:true,bypassed:false}});
      });
      await page.goto(`http://127.0.0.1:${server.address().port}`);
      if (!bypass) {
        await page.getByRole('button',{name:'კოდი',exact:true}).click();
        await page.getByPlaceholder('4-ნიშნა კოდი').fill('1234');
        await page.getByRole('button',{name:'OK',exact:true}).evaluate(el=>{el.click();el.click();});
        await page.getByText('ნომერი დადასტურებულია',{exact:true}).waitFor();
        assert.equal(await page.evaluate(()=>window.calls),0,'SMS success must not finalize');
      } else await page.getByText('SMS ვერიფიკაცია გათიშულია დილერისთვის',{exact:true}).waitFor();
      const finish=page.getByRole('button',{name:'განაცხადის გაგზავნა',exact:true});
      await finish.waitFor();
      await page.waitForFunction(()=>Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()==='განაცხადის გაგზავნა'&&!b.disabled));
      await finish.evaluate(el=>{for(let i=0;i<10;i++)el.click();});
      assert.equal(await page.evaluate(()=>window.calls),1);
      const id=await page.evaluate(()=>window.id());
      await page.evaluate(()=>{window.release();window.remount();});
      assert.equal(await page.evaluate(()=>window.id()),id);
      await page.reload();
      assert.equal(await page.evaluate(()=>window.id()),id,'reload preserves application ID');
      await page.evaluate(()=>window.complete());
      assert.notEqual(await page.evaluate(()=>window.id()),id,'new application gets a distinct ID');
      await page.close();
    }
  } finally { await browser.close(); await new Promise(r=>server.close(r)); }
});

// Execute each dashboard's actual handler with delayed preparation. This exercises
// its own guard, even if a callback bypasses the shared final component.
for (const file of ['client/src/pages/Dashboard.tsx','client/src/pages/dealer/DealerDashboard.tsx']) {
  test(`${file}: parent guard starts preparation once`,async()=>{
    const source=readFileSync(file,'utf8');
    const handler=source.slice(source.indexOf('  const handleSubmit ='),source.indexOf('  const cancelSale ='));
    let calls=0,release;
    const gate=new Promise(r=>release=r);
    const failAfterGate=async()=>{calls++;await gate;throw new Error('stop at controlled preparation boundary');};
    const state={submitInFlight:{current:false},dealer:{id:1,email:'test@example.com',key:'iron'},pendingSubmission:null,
      toast:()=>{},setErrorMessage:()=>{},setIsSubmitting:()=>{},applicationId:()=> 'stable',formData:{},
      submitApplication:failAfterGate,registerDealerPersonalIdOnPortal:failAfterGate,finishSubmissionError:()=>{},
      axios:{isAxiosError:()=>false}};
    state.activeDraftRef={current:state.formData};
    state.completedDraftRef={current:null};
    const compiled=await build({stdin:{contents:'function make(){'+handler+'\nreturn handleSubmit;}\nreturn make();',loader:'ts'},write:false});
    const submit=new Function(...Object.keys(state),compiled.outputFiles[0].text)(...Object.values(state));
    const promises=Array.from({length:20},()=>submit());
    assert.equal(calls,1);
    release();await Promise.all(promises);
    assert.equal(state.submitInFlight.current,false);
  });
}
