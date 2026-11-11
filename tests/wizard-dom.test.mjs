import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync, existsSync, mkdirSync, writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createServer} from 'node:http';
import {build} from 'esbuild';
import {chromium} from 'playwright-core';

const executablePath = process.env.TEST_BROWSER_PATH || ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
const evidence = [];
const pixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6pAAAAABJRU5ErkJggg==';
const photo = {name:'local.png',mimeType:'image/png',buffer:Buffer.from(pixel.split(',')[1],'base64')};
const dealer = {id:1,key:'iron',name:'Local dealer',email:'test@example.invalid',requireSmsVerification:true};
const product = {id:1,name:'Local stove',price:20000,deliveryFee:1000,discountPercentage:75};
const identity = {name:'წიწა',surname:'ჭავჭავაძე',personalId:'01012345678',gender:'F',expiryDate:'2030-01-01'};
const button = (page,name) => page.getByRole('button',{name,exact:true});
const settle = page => page.evaluate(() => new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));

// Simulate the structural mutation made by translators: replace React's Text node
// with a font element. This is fault injection, not a claim about the reported device.
async function translate(locator) {
  return locator.evaluate(root => {
    const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
    const nodes=[];while(walker.nextNode()) if(walker.currentNode.textContent.trim()) nodes.push(walker.currentNode);
    for(const node of nodes){const font=document.createElement('font');font.textContent=node.textContent;node.replaceWith(font);}
    return nodes.length;
  });
}

async function host(contents, baseline=false) {
  const bundle=await build({stdin:{contents,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,format:'iife',jsx:'automatic',sourcemap:'inline',define:{'process.env.NODE_ENV':'"test"'},
    plugins:baseline?[{name:'baseline-product',setup(b){b.onLoad({filter:/Step3Product\.tsx$/},()=>({contents:execFileSync('git',['show','6fc8301:client/src/components/wizard/Step3Product.tsx'],{encoding:'utf8'}),loader:'tsx'}));}}]:[{name:'recovery-fault-seam',setup(b){b.onLoad({filter:/Step4Finalize\.tsx$/},args=>({contents:readFileSync(args.path,'utf8').replace('  const { toast } = useToast();','  if ((window as any).__crashStep) throw new Error("Injected step render failure");\n  const { toast } = useToast();'),loader:'tsx'}));}}]});
  // npm run test:wizard-dom compiles the real responsive styles before these tests.
  const css=readFileSync('output/wizard-dom/style.css','utf8');
  const server=createServer((req,res)=>{if(req.url.startsWith('/fonts/')){res.statusCode=404;return res.end();}res.setHeader('Content-Type',req.url==='/bundle.js'?'application/javascript':'text/html; charset=utf-8');res.end(req.url==='/bundle.js'?bundle.outputFiles[0].text:`<meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script src="/bundle.js"></script>`);});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  return {url:`http://127.0.0.1:${server.address().port}`,close:()=>new Promise(r=>server.close(r))};
}

const productHarness=`
import React,{useState,useCallback} from 'react';import {createRoot} from 'react-dom/client';
import {Step3Product} from './client/src/components/wizard/Step3Product';
import {ErrorBoundary} from './client/src/components/ErrorBoundary';
function Harness(){const [data,setData]=useState({supplierId:'OLD',supplierName:'Local dealer',firstName:'Keep me',phone:'599123456'});const [show,setShow]=useState(true);
 const updateData=useCallback(p=>setData(d=>({...d,...p})),[]);window.leave=()=>setShow(false);
 return <><pre id="state">{JSON.stringify(data)}</pre><ErrorBoundary>{show&&<Step3Product data={data} updateData={updateData} onNext={()=>{}} onBack={()=>{}}/>}</ErrorBoundary></>;}
createRoot(document.getElementById('root')).render(<Harness/>);`;

test('translation fault injection: baseline reproduces exact insertBefore; patched product survives',async()=>{
 const browser=await chromium.launch({executablePath,headless:true});
 try{for(const baseline of [true,false]){
  const server=await host(productHarness,baseline);const page=await browser.newPage();const errors=[];
  page.on('pageerror',e=>errors.push(e.stack));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.route('**/api/products?*',r=>r.fulfill({json:[product]}));
  let pending;const received=new Promise(r=>pending=r);
  await page.route('**/api/check-stove-code',r=>pending(r));
  await page.goto(server.url);await button(page,'შემოწმება').waitFor();
  assert.ok(await translate(button(page,'შემოწმება')));
  await button(page,'შემოწმება').click();const request=await received;
  await request.fulfill({json:{status:'success',message:'Verified',product_name:product.name}});
  if(baseline){await button(page,'თავიდან სცადეთ').waitFor();assert.ok(errors.some(x=>x.includes("insertBefore")));assert.ok(errors.some(x=>x.includes('Step3Product')));}
  else {await page.getByText('Verified',{exact:true}).waitFor();assert.deepEqual(errors,[]);}
  evidence.push({scenario:baseline?'baseline translated product':'patched translated product',errors});
  await page.close();await server.close();
 }}finally{await browser.close();mkdirSync('output/wizard-dom',{recursive:true});writeFileSync('output/wizard-dom/translation-evidence.json',JSON.stringify(evidence,null,2));}
});

test('product verification ignores replaced codes, blocks rapid duplicates and ignores unmounted completions',async()=>{
 const server=await host(productHarness);const browser=await chromium.launch({executablePath,headless:true});
 try{const page=await browser.newPage();const requests=[];await page.route('**/api/products?*',r=>r.fulfill({json:[product]}));
 await page.route('**/api/check-stove-code',r=>requests.push(r));await page.goto(server.url);
 await button(page,'შემოწმება').evaluate(b=>{b.click();b.click();});
 await page.waitForRequest(()=>false,{timeout:150}).catch(()=>{});assert.equal(requests.length,1);
 await page.locator('#supplierId').fill('NEW');
 await requests[0].fulfill({json:{status:'success',message:'Stale result',product_name:product.name}});await settle(page);
 assert.equal(JSON.parse(await page.locator('#state').textContent()).ovenVerified,false);
 await button(page,'შემოწმება').click();await page.waitForRequest(()=>false,{timeout:150}).catch(()=>{});
 assert.equal(requests.length,2);await page.evaluate(()=>window.leave());
 await requests[1].fulfill({json:{status:'success',message:'Late result',product_name:product.name}});await settle(page);
 const data=JSON.parse(await page.locator('#state').textContent());assert.equal(data.ovenVerified,false);assert.equal(data.firstName,'Keep me');
 }finally{await browser.close();await server.close();}
});

const dashboardHarness=`
import React from 'react';import {createRoot} from 'react-dom/client';import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import Dashboard from './client/src/pages/Dashboard';import DealerDashboard from './client/src/pages/dealer/DealerDashboard';
import {Toaster} from './client/src/components/ui/toaster';
createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}>{location.search.includes('dealer')?<DealerDashboard/>:<Dashboard/>}<Toaster/></QueryClientProvider>);`;

const finalHarness=`
import React,{useState,useCallback} from 'react';import {createRoot} from 'react-dom/client';
import {Step4Finalize} from './client/src/components/wizard/Step4Finalize';
function Harness(){const [data,setData]=useState({firstName:'Test',lastName:'User',phone:'599123456',addressVillage:'Keep address',receiptPhoto:${JSON.stringify(pixel)}});const updateData=useCallback(p=>setData(d=>({...d,...p})),[]);
return <><pre id="state">{JSON.stringify(data)}</pre><Step4Finalize data={data} updateData={updateData} onSubmit={()=>{throw Error('Unexpected submit')}} onBack={()=>{}} isSubmitting={false}/></>;}
createRoot(document.getElementById('root')).render(<Harness/>);`;

test('SMS: stale phone replies ignored, synchronous duplicate guards, 30-minute bypass expiration',async()=>{
 const server=await host(finalHarness);const browser=await chromium.launch({executablePath,headless:true});
 try{
  const page=await browser.newPage();page.setDefaultTimeout(8000);
  await page.route('**/api/dealer/me',r=>r.fulfill({json:dealer}));
  const sends=[];const verifies=[];
  await page.route('**/api/verification/send-sms',r=>sends.push(r));await page.route('**/api/verification/verify-sms',r=>verifies.push(r));
  await page.goto(server.url);
  let arrived=page.waitForRequest('**/api/verification/send-sms');await button(page,'კოდი').evaluate(b=>{b.click();b.click();});await arrived;await settle(page);assert.equal(sends.length,1);
  await page.getByPlaceholder('5-- -- -- --').fill('599000001');await sends[0].fulfill({json:{success:true}});await settle(page);
  assert.equal(await page.getByPlaceholder('4-ნიშნა კოდი').count(),0);
  arrived=page.waitForRequest('**/api/verification/send-sms');await button(page,'კოდი').click();await arrived;await settle(page);await sends[1].fulfill({json:{success:true}});
  await page.getByPlaceholder('4-ნიშნა კოდი').fill('1234');arrived=page.waitForRequest('**/api/verification/verify-sms');await button(page,'OK').evaluate(b=>{b.click();b.click();});await arrived;await settle(page);assert.equal(verifies.length,1);
  await page.getByPlaceholder('5-- -- -- --').fill('599000002');await verifies[0].fulfill({json:{success:true,bypassed:false}});await settle(page);
  const data=JSON.parse(await page.locator('#state').textContent());assert.equal(data.smsVerified,false);assert.equal(data.addressVillage,'Keep address');assert.equal(data.receiptPhoto,pixel);await page.close();
  const expiry=await browser.newPage();await expiry.clock.install();const start=await expiry.evaluate(()=>Date.now());
  await expiry.route('**/api/dealer/me',async r=>r.fulfill({json:{...dealer,requireSmsVerification:false,smsBypassExpiresAt:new Date(start+30*60_000).toISOString(),serverNow:new Date(await expiry.evaluate(()=>Date.now())).toISOString()}}));
  await expiry.goto(server.url);await expiry.getByText('SMS ვერიფიკაცია გათიშულია დილერისთვის',{exact:true}).waitFor();
  await expiry.clock.fastForward(29*60_000);await settle(expiry);assert.equal(await expiry.getByText('SMS ვერიფიკაცია გათიშულია დილერისთვის',{exact:true}).count(),1);
  await expiry.clock.fastForward(60_001);await button(expiry,'კოდი').waitFor();assert.equal(await expiry.getByText('SMS ვერიფიკაცია გათიშულია დილერისთვის',{exact:true}).count(),0);
 }finally{await browser.close();await server.close();}
});

test('profile font completion after Back cannot update data or advance',async()=>{
 const server=await host(`import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {Step2Profile} from './client/src/components/wizard/Step2Profile';
 window.advances=0;window.updates=0;function Harness(){const [show,setShow]=useState(true);return show?<Step2Profile data={{firstName:'Test',lastName:'User',idNumber:'01012345678'}} updateData={()=>window.updates++} onNext={()=>window.advances++} onBack={()=>setShow(false)}/>:<p>Left</p>;}createRoot(document.getElementById('root')).render(<Harness/>);`);
 const browser=await chromium.launch({executablePath,headless:true});
 try{const page=await browser.newPage();await page.addInitScript(()=>{const original=FontFace.prototype.load;FontFace.prototype.load=function(){return new Promise(resolve=>{window.releaseFont=()=>original.call(this).then(resolve);});};});await page.goto(server.url);
 await button(page,'გაგრძელება').evaluate(b=>{b.click();b.click();});await page.waitForFunction(()=>!!window.releaseFont);const before=await page.evaluate(()=>window.updates);
 await button(page,'უკან').click();await page.evaluate(()=>window.releaseFont());await settle(page);assert.equal(await page.evaluate(()=>window.advances),0);assert.equal(await page.evaluate(()=>window.updates),before);
 }finally{await browser.close();await server.close();}
});

test('camera export after close is discarded and does not restore an upload',async()=>{
 const server=await host(`import React from 'react';import {createRoot} from 'react-dom/client';import {MediaUploadZone} from './client/src/components/ui/MediaUploadZone';window.persisted=[];createRoot(document.getElementById('root')).render(<MediaUploadZone label="Photo" pickerTitle="Photo" onPersist={v=>window.persisted.push(v)}/>);`);
 const browser=await chromium.launch({executablePath,headless:true});
 try{const page=await browser.newPage();await page.addInitScript(()=>{navigator.mediaDevices.getUserMedia=async()=>{const c=document.createElement('canvas');c.width=320;c.height=240;return c.captureStream();};HTMLCanvasElement.prototype.toBlob=function(cb){window.releaseBlob=()=>cb(new Blob(['local'],{type:'image/jpeg'}));};});await page.goto(server.url);
 await button(page,'გადაღება').click();await page.waitForFunction(()=>!!document.querySelector('video')?.srcObject);const controls=page.locator('video').locator('..').getByRole('button');await controls.nth(0).click();await page.waitForFunction(()=>!!window.releaseBlob);await controls.nth(1).click();await page.evaluate(()=>window.releaseBlob());await settle(page);assert.deepEqual(await page.evaluate(()=>window.persisted),[]);assert.equal(await page.locator('video').count(),0);
 }finally{await browser.close();await server.close();}
});

test('both real dashboards: desktop/mobile wizard navigation, translated loading, receipt retry and draft recovery',async t=>{
 const server=await host(dashboardHarness);const browser=await chromium.launch({executablePath,headless:true});
 try{for(const dashboard of ['general','dealer'])for(const mobile of [false,true])await t.test(`${dashboard} ${mobile?'mobile':'desktop'}`,async sub=>{
  const context=await browser.newContext({viewport:mobile?{width:393,height:851}:{width:1440,height:1000},isMobile:mobile,hasTouch:mobile});
  const page=await context.newPage();page.setDefaultTimeout(8000);const errors=[];let receiptFails=true;let checks=0;let lookups=0;let submissions=0;let submissionRoute;
  sub.after(async()=>{if(!page.isClosed()){await page.screenshot({path:`output/wizard-dom/${dashboard}-${mobile?'mobile':'desktop'}.png`,fullPage:true});await context.close();}});
  page.on('pageerror',e=>errors.push(e.stack));page.on('console',m=>{if(m.type()==='error'&&/insertBefore|removeChild|same key/.test(m.text()))errors.push(m.text());});
  // Deny every nonlocal request; all service endpoints are fulfilled here.
  await page.route('**/*',async r=>{
    const u=new URL(r.request().url());if(u.origin!==server.url)return r.abort();
    if(!u.pathname.startsWith('/api/'))return r.continue();
    let body={};let status=200;
    if(u.pathname==='/api/dealer/me')body=dealer;
    else if(u.pathname==='/api/products')body=[product];
    else if(u.pathname.startsWith('/api/vision/extract-'))body=identity;
    else if(u.pathname==='/api/verification/dealer-personal-id'){lookups++;body=lookups===1?{success:false,message:'Local ID retry required'}:{success:true,personalId:identity.personalId};}
    else if(u.pathname==='/api/check-stove-code'){checks++;body=checks===1?{status:'error',message:'Local code rejected'}:{status:'success',message:'Local code accepted',product_name:product.name};}
    else if(u.pathname==='/api/vision/verify-receipt'){body=receiptFails?{success:false,message:'Local receipt rejection'}:{total_amount:100};status=receiptFails?400:200;}
    else if(u.pathname==='/api/verification/send-sms')body={success:true};
    else if(u.pathname==='/api/verification/verify-sms')body={success:true,bypassed:false};
    else if(u.pathname.includes('submit')){submissions++;submissionRoute=r;return;}
    else status=401;
    await r.fulfill({status,json:body});
  });
  await page.goto(`${server.url}?${dashboard}`);
  const storageKey=`wizard_session_state:${dashboard==='dealer'?'dealer_':''}dashboard_wizard_state`;
  const key=dashboard==='dealer'?'wizard_session_state:dealer_wizard_state':storageKey;
  const state=()=>page.evaluate(k=>JSON.parse(sessionStorage.getItem(k)),key);
  // Identity upload, remove, same-file re-upload, then automatic advancement.
  await button(page,'ID ბარათი').click();
  const inputs=page.locator('input[type=file]');await inputs.first().waitFor({state:'attached'});
  await inputs.nth(0).setInputFiles(photo);await page.waitForFunction(k=>!!JSON.parse(sessionStorage.getItem(k))?.formData.idFront,key);
  await page.getByRole('img',{name:'წინა მხარე',exact:true}).click();
  await page.waitForFunction(k=>!JSON.parse(sessionStorage.getItem(k))?.formData.idFront,key);
  await inputs.nth(0).setInputFiles(photo);await inputs.nth(2).setInputFiles(photo);
  await button(page,'გაგრძელება').click();
  await page.getByRole('main').getByText('Local ID retry required',{exact:true}).waitFor();await button(page,'ხელახლა შემოწმება').click();
  await page.waitForFunction(k=>JSON.parse(sessionStorage.getItem(k))?.formData.dealerPersonalIdVerified===true,key);
  await button(page,'გაგრძელება').click();await page.locator('#firstName').waitFor();
  await button(page,'უკან').click();await button(page,'ხელახლა შემოწმება').waitFor();
  await translate(button(page,'ხელახლა შემოწმება'));await button(page,'ხელახლა შემოწმება').click();
  await page.waitForFunction(k=>JSON.parse(sessionStorage.getItem(k))?.formData.dealerPersonalIdVerified===true,key);
  await button(page,'გაგრძელება').click();await page.locator('#firstName').waitFor();
  await button(page,'გაგრძელება').click();await page.locator('#supplierId').waitFor();
  // General dashboard needs the persisted supplier name (normally supplied upstream).
  if(dashboard==='general'){
    const saved=await state();saved.formData.supplierName=dealer.name;
    await page.evaluate(({key,saved})=>sessionStorage.setItem(key,JSON.stringify(saved)),{key,saved});await page.reload();await page.locator('#supplierId').waitFor();
  }
  await page.locator('#supplierId').fill('LOCAL-123');await translate(button(page,'შემოწმება'));
  await button(page,'შემოწმება').click();await page.getByRole('main').getByText('Local code rejected',{exact:true}).waitFor();
  await translate(page.getByRole('main').getByText('Local code rejected',{exact:true}));
  await button(page,'შემოწმება').click();await page.getByRole('main').getByText('Local code accepted',{exact:true}).waitFor();assert.equal(checks,2);
  await button(page,'გაგრძელება').click();await page.getByPlaceholder('მიუთითეთ მისამართი').fill('Preserved address');
  await page.getByRole('combobox').click();await page.getByRole('option',{name:'თბილისი',exact:true}).click();
  await page.getByPlaceholder('5-- -- -- --').fill('599123456');
  await button(page,'უკან').click();await page.locator('#supplierId').waitFor();await button(page,'გაგრძელება').click();
  assert.equal(await page.getByPlaceholder('მიუთითეთ მისამართი').inputValue(),'Preserved address');
  await inputs.first().setInputFiles(photo);await button(page,'შეამოწმე ქვითარი').waitFor();
  await translate(button(page,'შეამოწმე ქვითარი'));await button(page,'შეამოწმე ქვითარი').click();
  await page.getByRole('alertdialog').waitFor();const failed=await state();assert.equal(failed.formData.receiptPhoto,undefined);assert.ok(failed.formData.idFront);assert.equal(failed.formData.addressVillage,'Preserved address');
  await button(page,'გასაგებია').click();receiptFails=false;await inputs.first().setInputFiles(photo);await button(page,'შეამოწმე ქვითარი').click();
  await page.waitForFunction(k=>JSON.parse(sessionStorage.getItem(k))?.formData.receiptVerified===true,key);
  await button(page,'კოდი').click();await page.getByPlaceholder('4-ნიშნა კოდი').fill('1234');await button(page,'OK').click();await page.getByText('ნომერი დადასტურებულია',{exact:true}).waitFor();
  // Trigger a test-only render fault inside the real step to exercise each
  // dashboard's boundary wiring without changing production error handling.
  assert.deepEqual(errors,[],'no DOM exceptions before deliberate recovery fault');
  const before=await state();await page.evaluate(()=>window.__crashStep=true);await page.getByRole('combobox').click();
  await button(page,'თავიდან სცადეთ').waitFor();await page.evaluate(()=>window.__crashStep=false);await button(page,'თავიდან სცადეთ').click();
  await page.getByPlaceholder('მიუთითეთ მისამართი').waitFor();const recovered=await state();
  for(const field of ['firstName','lastName','idNumber','idFront','idBack','model','addressVillage','phone'])assert.deepEqual(recovered.formData[field],before.formData[field]);
  assert.equal(recovered.step,5);assert.equal(submissions,0,'recovery must never submit');
  evidence.push({scenario:`${dashboard}/${mobile?'mobile':'desktop'} recovery fault injection`,errors});
  await page.waitForFunction(()=>getComputedStyle(document.querySelector('main h2').parentElement.parentElement).opacity==='1');
  await page.screenshot({path:`output/wizard-dom/${dashboard}-${mobile?'mobile':'desktop'}-recovered.png`,fullPage:true});
  // The actual parent submission guard must survive a child-boundary remount.
  const sent=page.waitForRequest(r=>r.url().includes('/submit'));
  await page.evaluate(()=>window.__crashStep=true);await button(page,'განაცხადის გაგზავნა').evaluate(b=>{b.click();b.click();});await sent;await settle(page);
  await button(page,'თავიდან სცადეთ').waitFor();await page.evaluate(()=>window.__crashStep=false);await button(page,'თავიდან სცადეთ').evaluate(b=>b.click());
  const pending=page.getByRole('button').filter({hasText:'მონაცემები მოწმდება'});await pending.waitFor();assert.equal(await pending.isDisabled(),true);await pending.evaluate(b=>{b.click();b.click();});assert.equal(submissions,1);
  await submissionRoute.fulfill({status:400,json:{success:false,message:'Local submission rejection'}});
  if(dashboard==='dealer'){await button(page,'დახურვა').click();await button(page,'დახურვა').waitFor({state:'detached'});}
  await button(page,'განაცხადის გაგზავნა').waitFor();assert.equal(submissions,1);assert.equal((await state()).formData.addressVillage,'Preserved address');
  await context.close();
 });}finally{await browser.close();await server.close();mkdirSync('output/wizard-dom',{recursive:true});writeFileSync('output/wizard-dom/translation-evidence.json',JSON.stringify(evidence,null,2));}
});
