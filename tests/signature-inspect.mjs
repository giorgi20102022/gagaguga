import {readFile,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright-core';
const source=await readFile('client/src/components/wizard/geoElgujaBase64.ts','utf8');
const base64=source.match(/=\s*["'`]([^"'`]+)["'`]/)[1].replace(/\s/g,'');
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
try {
 const page=await browser.newPage({viewport:{width:1000,height:700}});
 await page.setContent(`<style>@font-face{font-family:Legacy;src:url(data:font/ttf;base64,${base64})}body{font:20px Arial}table{width:100%}td{padding:15px} .glyph{font-size:100px}</style><h1>Legacy glyph mapping compared with Unicode Sylfaen</h1><table><tr><td>U+10EC: წ</td><td>U+10ED: ჭ</td></tr><tr class=glyph style="font-family:Sylfaen"><td>წ</td><td>ჭ</td></tr><tr><td>Legacy ASCII w</td><td>Legacy ASCII W</td></tr><tr class=glyph style="font-family:Legacy"><td>w</td><td>W</td></tr></table>`);
 await page.evaluate(()=>document.fonts.ready);
 await page.screenshot({path:'output/pdf/legacy-glyph-comparison.png'});
 await writeFile('output/pdf/legacy-font.ttf',Buffer.from(base64,'base64'));
} finally {await browser.close();}
