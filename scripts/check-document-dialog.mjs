import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';

const message = 'ატვირთული სურათი არის ბუნდოვანი და დაბალი გარჩევადობის. გთხოვთ ატვირთოთ ხარისხიანი სურათი';
const fixture = `
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { DocumentValidationDialog } from '/src/components/wizard/DocumentValidationDialog';
import '/src/index.css';
function Fixture() {
  const [error, setError] = useState(null);
  return <><input aria-label="Unrelated data" defaultValue="preserved" />
    <button onClick={() => setError(${JSON.stringify(message)}.repeat(12))}>Validate</button>
    <DocumentValidationDialog message={error} onDismiss={() => setError(null)} /></>;
}
createRoot(document.getElementById('root')).render(<Fixture />);`;
const server = await createServer({
  server: { host: '127.0.0.1', port: 5179, strictPort: true },
  plugins: [{
    name: 'document-dialog-fixture',
    resolveId(id) { if (id === '/dialog-fixture.jsx') return id; },
    load(id) { if (id === '/dialog-fixture.jsx') return fixture; },
    configureServer(server) {
      server.middlewares.use('/dialog-check', async (_req, res) => {
        res.setHeader('Content-Type', 'text/html');
        res.end(await server.transformIndexHtml('/dialog-check', '<html><body><div id="root"></div><script type="module" src="/dialog-fixture.jsx"></script></body></html>'));
      });
    },
  }],
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  for (const viewport of [{ width: 1280, height: 900 }, { width: 375, height: 667 }]) {
    await page.setViewportSize(viewport);
    await page.goto('http://127.0.0.1:5179/dialog-check');
    await page.getByRole('button', { name: 'Validate' }).click();
    const dialog = page.getByRole('alertdialog');
    await dialog.waitFor();
    assert.equal(await dialog.getByRole('heading').textContent(), message.repeat(12));
    const acknowledge = dialog.getByRole('button', { name: 'გასაგებია' });
    assert.equal(await acknowledge.evaluate(el => el === document.activeElement), true);
    await page.keyboard.press('Tab');
    assert.equal(await acknowledge.evaluate(el => el === document.activeElement), true);
    await page.keyboard.press('Escape');
    assert.equal(await dialog.isVisible(), true);
    const bounds = await dialog.boundingBox();
    assert.ok(bounds.x >= 0 && bounds.y >= 0 && bounds.width <= viewport.width && bounds.height <= viewport.height);
    assert.equal(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth), true);
    assert.equal(await page.locator('body').evaluate(el => getComputedStyle(el).pointerEvents), 'none');
    assert.ok(await page.locator('[data-state="open"]').evaluateAll(elements => elements.some(el => getComputedStyle(el).backdropFilter.includes('blur'))));
    await acknowledge.click();
    await dialog.waitFor({ state: 'hidden' });
    assert.equal(await page.getByRole('textbox').inputValue(), 'preserved');
    assert.equal(await page.getByRole('button', { name: 'Validate' }).evaluate(el => el === document.activeElement), true);
    console.log(`Dialog accessibility and long-message layout passed: ${viewport.width}x${viewport.height}`);
  }
  assert.deepEqual(errors, []);
} finally {
  await browser?.close();
  await server.close();
}
