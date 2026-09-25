const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');
const artifacts = require('./support/artifacts.cjs');

(async () => {
  const { createPixelBuffer } = await import('../src/core/pixel-buffer.mjs');
  const { encodePng } = await import('../src/core/png.mjs');
  const bytes = encodePng(createPixelBuffer({ width: 2, height: 2, sampleType: 'uint16', colorSpace: 'srgb',
    data: new Uint16Array([256,257,65535,0, 123,456,789,65535, 17,18,19,32768, 30000,30001,30002,65535]) }), 16, require('../vendor/pako-2.1.0.min.js'));
  const url = pathToFileURL(require('./support/viewer-path.cjs')()).href;
  const browser = await chromium.launch({ headless: true, executablePath: process.env.IMAGE_TEST_BROWSER || undefined });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 });
    await context.setOffline(true);
    const page = await context.newPage(), errors = [], requests = [];
    page.setDefaultTimeout(20000);
    page.on('pageerror', e => errors.push(e.message));
    page.on('request', r => { if (/^https?:/.test(r.url())) requests.push(r.url()); });
    await page.goto(url);
    await page.locator('.format-select').nth(1).selectOption('png');
    await page.locator('#fileInput').setInputFiles({ name: 'pixel16.png', mimeType: 'image/png', buffer: Buffer.from(bytes) });
    const ready = () => page.waitForFunction(() => app.source && !app.sourceLoading && app.variants.slice(0, app.layout).every(isVariantReady));
    await ready();
    assert.equal(await page.locator('#pixelInspector').evaluate(e => e.open), false);
    await page.locator('#pixelInspector summary').click();
    await page.locator('#pixelX').fill('1'); await page.locator('#pixelY').fill('1'); await page.locator('#pixelY').press('Enter');
    assert.equal(await page.locator('#pixelRows tr').count(), 3);
    assert.equal(await page.locator('#pixelRows tr').first().locator('td').nth(1).textContent(), '30000');
    await page.evaluate(() => { window.pixelEncodes = 0; window.pixelBlobs = app.variants.map(v => v.blob); const original = encodeFromSource; encodeFromSource = (...args) => { pixelEncodes++; return original(...args); }; });
    const canvas = page.locator('.cell canvas.view').first();
    await canvas.scrollIntoViewIfNeeded();
    const point = await canvas.evaluate(c => {
      const rect = c.getBoundingClientRect(), scale = getDrawScale(c);
      return { x: rect.left + (c.width / 2 + (0.5 - app.view.centerX) * scale) * rect.width / c.width,
        y: rect.top + (c.height / 2 + (0.5 - app.view.centerY) * scale) * rect.height / c.height };
    });
    await page.mouse.click(point.x, point.y);
    assert.equal(await page.locator('#pixelX').inputValue(), '0');
    assert.equal(await page.locator('#pixelY').inputValue(), '0');
    assert.equal(await page.locator('#pixelRows tr').first().locator('td').nth(1).textContent(), '256');
    assert.equal(await page.locator('#pixelRows tr').first().locator('td').nth(4).textContent(), '0');
    await page.mouse.move(point.x, point.y); await page.mouse.down(); await page.mouse.move(point.x + 20, point.y); await page.mouse.up();
    assert.equal(await page.locator('#pixelX').inputValue(), '0', 'drag retains the pinned pixel');
    assert.equal(await page.evaluate(() => pixelEncodes), 0);
    assert.equal(await page.evaluate(() => app.variants.every((v, i) => v.blob === pixelBlobs[i])), true);
    await page.locator('.cell').nth(1).locator('.png-depth').selectOption('8'); await ready();
    assert.match(await page.locator('#pixelRows tr').nth(2).textContent(), /8 бит.*Δ: % диапазона.*1Δ \+0,001526%/);
    await page.evaluate(() => markDirty(app.variants[1], { schedule: false }));
    assert.match(await page.locator('#pixelRows tr').nth(2).textContent(), /Ожидание/);
    await page.evaluate(() => renderVariant(app.variants[1])); await ready();
    await page.locator('#pixelX').fill('2'); await page.locator('#pixelY').press('Enter');
    assert.equal(await page.locator('#pixelTable').isVisible(), false);
    assert.equal(await page.locator('#pixelX').getAttribute('aria-invalid'), 'true');
    await page.locator('#pixelX').fill('0'); await page.locator('#pixelY').press('Enter');
    await page.locator('#pixelInspector summary').click();
    assert.equal(await page.locator('#pixelTable').isVisible(), false);
    await page.locator('#pixelInspector summary').click();
    await page.setViewportSize({ width: 320, height: 900 });
    await page.locator('[data-analysis-size="max"][aria-pressed]').click();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.equal(await page.locator('#analysisPanel').evaluate(e => e.scrollWidth > e.clientWidth), false);
    await page.locator('#pixelX').fill('1'); await page.locator('#pixelY').press('Enter');
    assert.equal(await page.locator('#pixelRows tr').first().locator('td').nth(1).textContent(), '123');
    if (process.env.IMAGE_TEST_LOGS) {
      const folder = artifacts.folder(process.env.IMAGE_TEST_LOGS); fs.mkdirSync(folder, { recursive: true });
      await page.screenshot({ path: path.join(folder, artifacts.runId + '-pixel-inspector-narrow.png') });
    }
    await page.evaluate(() => { disposeSource(); drawAll(); });
    assert.equal(await page.locator('#pixelX').inputValue(), ''); assert.equal(await page.locator('#pixelShow').isDisabled(), true);
    assert.equal(await page.locator('#pixelTable').isVisible(), false);
    assert.deepEqual(errors, []); assert.deepEqual(requests, []);
    await context.close();
    console.log('PASS offline PNG16 inspector, DPR2 click/pan, keyboard, native deltas, invalidation and narrow layout');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
