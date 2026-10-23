import assert from 'node:assert/strict';
import {test} from 'node:test';
import {build} from 'esbuild';
import {chromium} from 'playwright-core';
import {mkdir,writeFile} from 'node:fs/promises';

test('confirmed Unicode names produce distinct correct legacy glyphs and a PDF image proof',async()=>{
 const bundle=await build({stdin:{contents:`
   import {signatureText,encodeSignatureGlyphs,generateSignatureBase64} from './client/src/components/wizard/signatureUtils';
   window.signature={signatureText,encodeSignatureGlyphs,generateSignatureBase64};
 `,resolveDir:process.cwd()},bundle:true,write:false,format:'iife'});
 const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 try {
  const page=await browser.newPage({viewport:{width:1200,height:1000}});
  await page.route('**/*',r=>r.abort());
  await page.setContent('<style>body{font:18px Arial;margin:28px}.ref{font:32px Sylfaen}img{max-width:100%;height:auto}section{break-inside:avoid;border-bottom:1px solid #aaa;padding:12px 0}h1{font-size:24px}</style><h1>LOCAL signature / PDF verification — not the n8n final document</h1>');
  await page.addScriptTag({content:bundle.outputFiles[0].text});
  const names=[['წიწა','წერეთელი'],['ჭიჭა','ჭავჭავაძე'],['გიორგი','წიჭინაძე'],['ნინო','ჭია  ']];
  const expected=['წ. წერეთელი','ჭ. ჭავჭავაძე','გ. წიჭინაძე','ნ. ჭია  '];
  const results=await page.evaluate(async names=>{
    const api=window.signature;
    const rows=[];
    for(const [first,last] of names){
      const text=api.signatureText(first,last);
      const data=await api.generateSignatureBase64(first,last);
      const section=document.createElement('section');
      const ref=document.createElement('div');ref.className='ref';ref.textContent=text;
      const img=document.createElement('img');img.src=data;img.alt=text;
      section.append(ref,img);document.body.append(section);await img.decode();
      rows.push({first,last,text,encoded:api.encodeSignatureGlyphs(text),data});
    }
    return {rows,pair:api.encodeSignatureGlyphs('წჭწჭ')};
  },names);
  assert.equal(results.pair,'wWwW');
  for(const [i,row] of results.rows.entries()){
    assert.equal(row.text,expected[i]);
    assert.equal(row.first,names[i][0]);
    assert.equal(row.last,names[i][1]);
  }
  assert.notEqual(results.rows[0].data,results.rows[1].data);
  await mkdir('output/pdf',{recursive:true});
  for(const [i,row] of results.rows.entries())await writeFile(`output/pdf/signature-${i+1}.jpg`,Buffer.from(row.data.split(',')[1],'base64'));
  await page.screenshot({path:'output/pdf/signature-proof-browser.png',fullPage:true});
  await page.pdf({path:'output/pdf/signature-proof.pdf',format:'A4',printBackground:true,margin:{top:'12mm',bottom:'12mm',left:'12mm',right:'12mm'}});
  await writeFile('output/pdf/signature-proof-data.json',JSON.stringify(results.rows.map(({data,...row})=>row),null,2));
 }finally{await browser.close();}
});
