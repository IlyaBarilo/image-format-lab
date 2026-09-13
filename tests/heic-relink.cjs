// Run after rebuilding a deliberately modified library with the supplied source kit.
// Usage: node tests/heic-relink.cjs modified.html modified-sources.zip expected-libde265-version
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');
const artifacts = require('./support/artifacts.cjs');
const [html, sourceZip, expected] = process.argv.slice(2);
if (!expected || !html || !sourceZip) throw new Error('Supply modified HTML, its corresponding source ZIP, and expected libde265 version');
for (const file of [html, sourceZip]) if (/[\\/]local[\\/]arh(?:[\\/]|$)/i.test(path.resolve(file))) throw new Error('User archives excluded');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
(async () => {
  const isolated = path.join(os.tmpdir(), 'heic-relinked-' + crypto.randomUUID() + '.html');
  fs.copyFileSync(html, isolated);
  const report = { htmlSha256: sha(fs.readFileSync(html)), sourceSha256: sha(fs.readFileSync(sourceZip)), expected, requests: [], errors: [] };
  let browser;
  try {
    browser = await chromium.launch({ headless: true, executablePath: process.env.IMAGE_TEST_BROWSER || undefined });
    report.browser = browser.version();
    const context = await browser.newContext({ acceptDownloads: true });
    await context.setOffline(true);
    await context.addInitScript(() => {
      const Native = Worker; globalThis.decodedVersions = [];
      globalThis.Worker = class extends Native {
        constructor(...args) { super(...args); this.addEventListener('message', ({ data }) => { if (data.type === 'ready' && data.version) decodedVersions.push({ libheif: data.version, libde265: data.decoder }); }); }
      };
    });
    const page = await context.newPage(), url = pathToFileURL(isolated).href;
    page.on('pageerror', error => report.errors.push(error.message));
    context.on('request', request => { if (request.url() !== url && !/^(blob:|data:)/.test(request.url())) report.requests.push(request.url()); });
    await page.goto(url);
    await page.waitForFunction(() => document.getElementById('codecStatus').dataset.state === 'ready');
    assert.equal(await page.evaluate(() => 'app' in globalThis), false);
    await page.locator('#fileInput').setInputFiles(path.join(__dirname, 'fixtures/heic/rotate90.heic'));
    const pending = page.waitForEvent('download');
    await page.locator('.cell').nth(1).locator('button[title="Скачать вариант"]').click();
    const download = await pending, chunks = [];
    for await (const chunk of await download.createReadStream()) chunks.push(chunk);
    report.dimensions = await page.evaluate(async bytes => { const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)])); try { return [bitmap.width, bitmap.height]; } finally { bitmap.close(); } }, [...Buffer.concat(chunks)]);
    assert.deepEqual(report.dimensions, [64, 96]);
    await page.locator('.cell').nth(1).locator('.format-select').selectOption('heic');
    const encodedDownload = page.waitForEvent('download');
    await page.locator('.cell').nth(1).locator('button[title="Скачать вариант"]').click();
    const encoded = await encodedDownload, encodedChunks = [];
    for await (const chunk of await encoded.createReadStream()) encodedChunks.push(chunk);
    assert.match(encoded.suggestedFilename(), /\.heic$/);
    assert.equal(Buffer.concat(encodedChunks).toString('ascii', 8, 12), 'heic');
    report.heicExport = true;
    report.versions = await page.evaluate(() => decodedVersions);
    assert.ok(report.versions.length && report.versions.every(item => item.libde265 === expected && item.libheif === '1.23.4'));
    await page.locator('#licensesOpen').click();
    const sourceDownload = page.waitForEvent('download');
    await page.locator('#licensesHeicSources').click();
    const sourceChunks = [];
    for await (const chunk of await (await sourceDownload).createReadStream()) sourceChunks.push(chunk);
    assert.equal(sha(Buffer.concat(sourceChunks)), report.sourceSha256);
    assert.match(await page.locator('#licensesContent').textContent(), /Локально пересобранный/);
    assert.deepEqual(report.requests, []); assert.deepEqual(report.errors, []);
    report.passed = true;
    console.log(JSON.stringify(report, null, 2));
    if (process.env.IMAGE_TEST_LOGS) fs.writeFileSync(path.join(artifacts.folder(process.env.IMAGE_TEST_LOGS), artifacts.runId + '-heic-relink.json'), JSON.stringify(report, null, 2) + '\n');
  } finally { if (browser) await browser.close(); fs.unlinkSync(isolated); }
})().catch(error => { console.error(error); process.exitCode = 1; });
