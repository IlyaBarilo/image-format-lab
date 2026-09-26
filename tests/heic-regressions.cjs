const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');
const artifacts = require('./support/artifacts.cjs');
const root = path.resolve(__dirname, '..');
const fixtures = path.join(__dirname, 'fixtures/heic');
const manifest = JSON.parse(fs.readFileSync(path.join(fixtures, 'manifest.json')));
const url = pathToFileURL(require('./support/viewer-path.cjs')()).href;

function workerProbe() {
  const Native = Worker;
  globalThis.heicWorkers = [];
  globalThis.Worker = class extends Native {
    constructor(...args) {
      super(...args);
      this.record = { terminated: false, decodes: 0 };
      this.addEventListener('message', ({ data }) => {
        if (data.type === 'ready' && data.version) {
          Object.assign(this.record, { version: data.version, decoder: data.decoder });
          heicWorkers.push(this.record);
        }
      });
    }
    postMessage(...args) { if (args[0]?.type === 'decode') this.record.decodes++; return super.postMessage(...args); }
    terminate() { this.record.terminated = true; return super.terminate(); }
  };
}
(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.IMAGE_TEST_BROWSER || undefined });
  const report = { browser: browser.version(), cases: [], checks: [], externalRequests: [], errors: [] };
  try {
    const context = await browser.newContext();
    await context.setOffline(true);
    await context.addInitScript(workerProbe);
    const page = await context.newPage();
    page.setDefaultTimeout(60000);
    context.on('request', request => { if (request.url() !== url && !/^(blob:|data:)/.test(request.url())) report.externalRequests.push(request.url()); });
    page.on('pageerror', error => report.errors.push(error.message));
    await page.goto(url);
    await page.waitForFunction(() => document.getElementById('codecStatus').dataset.state === 'ready');
    for (const fixture of manifest.cases) {
      const input = fs.readFileSync(path.join(fixtures, fixture.file));
      assert.equal(crypto.createHash('sha256').update(input).digest('hex'), fixture.sha256);
      await page.evaluate(() => clearFiles());
      await page.locator('#fileInput').setInputFiles({ name: fixture.file, mimeType: 'image/heic', buffer: input });
      await page.waitForFunction(name => app.source?.name === name && !app.sourceLoading, fixture.file);
      const result = await page.evaluate(({ expected, width, height }) => {
        const reference = UPNG.toRGBA8(UPNG.decode(new Uint8Array(expected).buffer))[0];
        const bytes = new Uint8Array(reference), actual = app.source.imageData.data;
        let maximum = 0, sum = 0, alphaError = 0;
        if (bytes.length !== actual.length) throw new Error('RGBA length mismatch');
        for (let i = 0; i < bytes.length; i++) {
          const difference = Math.abs(bytes[i] - actual[i]);
          if (i % 4 === 3) alphaError = Math.max(alphaError, difference);
          else { maximum = Math.max(maximum, difference); sum += difference; }
        }
        return { width: app.source.width, height: app.source.height, maximum, mean: sum / (width * height * 3), alphaError };
      }, { expected: [...fs.readFileSync(path.join(fixtures, fixture.expected))], width: fixture.width, height: fixture.height });
      assert.equal(result.width, fixture.width); assert.equal(result.height, fixture.height);
      assert.ok(result.maximum <= 4 && result.mean <= 0.15, fixture.name + ': RGB differs from independent native reference');
      assert.equal(result.alphaError, 0);
      report.cases.push({ name: fixture.name, ...result });
    }
    report.checks.push('UI loading: RGBA, alpha, primary image, irot, imir, grid, 10-bit and 3-megapixel input');
    const valid = fs.readFileSync(path.join(fixtures, 'rgb8.heic'));
    const oversized = Buffer.from(valid), ispe = oversized.indexOf(Buffer.from('ispe'));
    assert.ok(ispe >= 0); oversized.writeUInt32BE(100000, ispe + 8); oversized.writeUInt32BE(100000, ispe + 12);
    for (const [name, bytes] of [['truncated', valid.subarray(0, 32)], ['truncated-data', valid.subarray(0, Math.floor(valid.length / 2))], ['oversized', oversized]]) {
      const outcome = await page.evaluate(async ({ bytes, good }) => {
        let message;
        try { await decodeHeicFile(new File([new Uint8Array(bytes)], 'bad.heic')); }
        catch (error) { message = error.message; }
        const recovered = await decodeHeicFile(new File([new Uint8Array(good)], 'good.heic'));
        return { message, recovered: [recovered.width, recovered.height] };
      }, { bytes: [...bytes], good: [...valid] });
      assert.ok(outcome.message, name + ' should fail');
      assert.deepEqual(outcome.recovered, [96, 64]);
      report.checks.push(name + ' rejected and next image decoded: ' + outcome.message);
    }
    const concurrent = await page.evaluate(async bytes => {
      const priorDecodes = new Map(heicWorkers.map(worker => [worker, worker.decodes]));
      const file = new File([new Uint8Array(bytes)], 'queued.heic');
      const results = await Promise.all([decodeHeicFile(file), decodeHeicFile(file), decodeHeicFile(file)]);
      let sizeError;
      try { await decodeHeicFile({ size: 256 * 1024 * 1024 + 1, arrayBuffer() { throw new Error('must not read'); } }); }
      catch (error) { sizeError = error.message; }
      const workers = heicWorkers.filter(worker => worker.decodes > (priorDecodes.get(worker) || 0));
      return { dimensions: results.map(item => [item.width, item.height]), sizeError, workers, totalWorkers: heicWorkers.length };
    }, [...valid]);
    assert.deepEqual(concurrent.dimensions, [[96,64],[96,64],[96,64]]);
    assert.match(concurrent.sizeError, /256/);
    assert.ok(concurrent.totalWorkers >= 17);
    assert.equal(concurrent.workers.length, 3, JSON.stringify(concurrent.workers));
    assert.ok(concurrent.workers.every(worker => worker.version === '1.23.4' && worker.decoder === '1.1.2' && worker.terminated), JSON.stringify(concurrent.workers));
    report.checks.push('three queued HEIC decodes succeed and their WASM Workers terminate; 256 MiB cap checked before reading');
    await page.evaluate(async bytes => {
      const decoded = await decodeHeicFile(new File([new Uint8Array(bytes)], 'unretained.heic'));
      globalThis.heicBufferWeak = new WeakRef(decoded.imageData.data.buffer);
    }, [...valid]);
    const devtools = await context.newCDPSession(page);
    await devtools.send('HeapProfiler.collectGarbage');
    await devtools.send('HeapProfiler.collectGarbage');
    assert.equal(await page.evaluate(() => heicBufferWeak.deref() === undefined), true, 'the settled decode queue must release the last RGBA buffer');
    await devtools.detach();
    report.checks.push('an unreferenced decoded pixel buffer is collected; the queue does not retain it');
    await context.close();

    const failure = await browser.newContext();
    await failure.setOffline(true);
    await failure.addInitScript(() => { globalThis.originalWorker = Worker; globalThis.Worker = undefined; });
    const failed = await failure.newPage();
    await failed.goto(url);
    await failed.waitForFunction(() => document.getElementById('codecStatus').dataset.state === 'error');
    assert.match(await failed.locator('#codecStatus').getAttribute('title'), /Worker/);
    assert.equal(await failed.locator('.cell').nth(1).locator('.format-select option[value="heic"]').isDisabled(), true);
    await failed.evaluate(() => { globalThis.Worker = originalWorker; });
    await failed.locator('#retryCodecs').click();
    await failed.waitForFunction(() => document.getElementById('codecStatus').dataset.state === 'ready');
    assert.equal(await failed.locator('.cell').nth(1).locator('.format-select option[value="heic"]').isDisabled(), false);
    await failed.locator('#fileInput').setInputFiles(path.join(fixtures, 'rotate90.heic'));
    await failed.waitForFunction(() => app.source?.width === 64 && app.source?.height === 96);
    report.checks.push('Worker startup failure is visible and retry restores HEIC');
    await failure.close();
    assert.deepEqual(report.externalRequests, []); assert.deepEqual(report.errors, []);
    report.checks.push('no external requests or uncaught page errors');
    console.log(JSON.stringify(report, null, 2));
    if (process.env.IMAGE_TEST_LOGS) fs.writeFileSync(path.join(artifacts.folder(process.env.IMAGE_TEST_LOGS), artifacts.runId + '-heic.json'), JSON.stringify(report, null, 2) + '\n');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
