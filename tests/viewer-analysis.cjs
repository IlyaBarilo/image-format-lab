// Begin collapsed so worker-count fixtures explicitly control when analysis starts.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');
const artifacts = require('./support/artifacts.cjs');
const fixture = { width: 6, height: 1, data: new Uint8ClampedArray([
  255,0,0,255, 0,255,0,255, 0,0,255,255, 17,40,90,0, 255,0,0,128, 0,0,0,255
]) };
let failures = 0;
const checks = [];
const folder = process.env.IMAGE_TEST_LOGS ? artifacts.folder(process.env.IMAGE_TEST_LOGS) : null;
async function ready(page) {
  await page.waitForFunction(() => app.source && !app.sourceLoading && app.variants.slice(0, app.layout).every(isVariantReady));
}
async function plots(page) {
  await page.waitForFunction(() => [...document.querySelectorAll('.analysis-card')].filter(e => !e.hidden).every(e => e.dataset.state === 'ready'));
}
(async () => {
  const { computeHistogram } = await import('../src/core/histogram.mjs');
  const original = fixture.data.slice(), white = computeHistogram(fixture), black = computeHistogram(fixture, 'black');
  assert.equal(white.pixelCount, 6);
  for (const result of [white, black]) for (const bins of result.channels) assert.equal(bins.reduce((a,b) => a+b), 6);
  assert.equal(white.channels[0][255], 3); assert.equal(white.channels[0][0], 3);
  for (const index of [1,2]) {
    assert.equal(white.channels[index][0], 3); assert.equal(white.channels[index][127], 1); assert.equal(white.channels[index][255], 2);
  }
  assert.equal(black.channels[0][0], 4); assert.equal(black.channels[0][128], 1); assert.equal(black.channels[0][255], 1);
  assert.equal(white.channels[3][0], 1); assert.equal(white.channels[3][128], 1); assert.equal(white.channels[3][255], 4);
  assert.deepEqual(white.channels[3], black.channels[3]); assert.deepEqual(fixture.data, original);
  const large = { width: 400, height: 300, data: new Uint8ClampedArray(400*300*4).fill(255) };
  assert.equal(computeHistogram(large).channels[0][255], 120000, 'counts must not overflow 16 bits');
  assert.throws(() => computeHistogram({ ...fixture, width: 7 }));
  assert.throws(() => computeHistogram({ ...fixture, width: 40000001 }));
  assert.throws(() => computeHistogram(fixture, 'checker'));
  console.log('PASS exact independent counts, alpha/matte, input ownership and validation');
  const url = pathToFileURL(require('./support/viewer-path.cjs')()).href;
  const browser = await chromium.launch({ headless: true, executablePath: process.env.IMAGE_TEST_BROWSER || undefined });
  async function check(name, fn, options = {}) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, ...options });
    const page = await context.newPage(), errors = [], requests = [];
    page.setDefaultTimeout(20000);
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (/^https?:/.test(request.url())) requests.push(request.url()); });
    try {
      await context.setOffline(true); await page.goto(url); await page.locator('#analysisDisplaySeparate').click(); await page.locator('#analysisCollapse').click();
      await fn(page, context);
      assert.deepEqual(errors, []); assert.deepEqual(requests, []);
      checks.push({ name, passed: true }); console.log('PASS ' + name);
    } catch (error) {
      failures++; checks.push({ name, passed: false, error: error.message }); console.error('FAIL ' + name + ': ' + error.stack);
    } finally { await context.close(); }
  }
  try {
    await check('worker exact counts retain the input buffer', async page => {
      const result = await page.evaluate(async pixels => {
        const imageData = new ImageData(new Uint8ClampedArray(pixels), 6, 1);
        const h = await workerCompute('histogram', { imageData, matte: 'white' });
        return { channels: h.channels.map(b => [...b]), data: [...imageData.data] };
      }, [...fixture.data]);
      assert.deepEqual(result.channels, white.channels.map(b => [...b])); assert.deepEqual(result.data, [...fixture.data]);
    });
    await check('offline UI: whole-image cache, exact ready images, shared axes, independent settings and DPR 2', async page => {
      // Configure the collapsed fixture: zoom must not invalidate a whole-image histogram.
      await page.locator('#analysisScope').selectOption('full', { force: true });
      await page.locator('#sampleImage').click(); await ready(page);
      const before = await page.evaluate(() => {
        window.analysisCalls = []; window.analysisEncodeCalls = 0;
        const compute = workerCompute, encode = encodeOne;
        workerCompute = (kind, payload) => { if (kind === 'histogram') analysisCalls.push(payload.matte); return compute(kind, payload); };
        encodeOne = (...args) => { analysisEncodeCalls++; return encode(...args); };
        return { comparison: captureComparison(), batch: JSON.stringify(app.exportConfig), storage: JSON.stringify(Object.fromEntries(Object.entries(localStorage).filter(([key])=>key!=='image-format-viewer.preferences.v1'))), bytes: app.source.imageData.data.byteLength };
      });
      await page.locator('button[data-analysis-size="compact"]').click(); await plots(page);
      assert.equal(await page.locator('.analysis-card select').count(), 0);
      assert.equal(await page.locator('.analysis-card:not([hidden])').count(), 2);
      assert.deepEqual(await page.locator('.analysis-chart').evaluateAll(cs => cs.map(c => c.dataset.yMax)).then(v => v[0] === v[1]), true);
      const calls = await page.evaluate(() => analysisCalls.length);
      assert.equal(calls, 2);
      await page.locator('#analysisChannel').selectOption('r');
      await page.locator('#analysisLevel').fill('255');
      await page.locator('#analysisLevel').dispatchEvent('input');
      assert.ok((await page.locator('.analysis-chart').first().getAttribute('aria-label')).includes('Уровень 255: R'));
      await page.locator('#analysisChannel').selectOption('alpha');
      assert.equal(await page.locator('#analysisMatte').isDisabled(), true);
      await page.locator('#analysisChannel').selectOption('rgb');
      await page.locator('#backgroundSelect').selectOption('red');
      await page.locator('#zoom100').click();
      assert.equal(await page.evaluate(() => analysisCalls.length), calls);
      await page.locator('#analysisMatte').selectOption('black'); await plots(page);
      assert.equal(await page.evaluate(() => analysisCalls.length), 4);
      await page.locator('#analysisMatte').selectOption('white'); await plots(page);
      assert.equal(await page.evaluate(() => analysisCalls.length), 4);
      const after = await page.evaluate(() => ({ batch: JSON.stringify(app.exportConfig), storage: JSON.stringify(Object.fromEntries(Object.entries(localStorage).filter(([key])=>key!=='image-format-viewer.preferences.v1'))), bytes: app.source.imageData.data.byteLength, encoded: analysisEncodeCalls }));
      assert.equal(after.batch, before.batch); assert.equal(after.storage, before.storage); assert.equal(after.bytes, before.bytes); assert.equal(after.encoded, 0);
      assert.deepEqual(await page.evaluate(() => captureComparison().variants), before.comparison.variants);
      assert.equal(await page.locator('.analysis-chart').first().evaluate(c => Math.abs(c.width / c.getBoundingClientRect().width - 2) < 0.01), true);
      await page.locator('#analysisCollapse').click();
      assert.equal(await page.locator('#analysisBody').isVisible(), false);
      assert.equal(await page.locator('#analysisCollapse').getAttribute('aria-expanded'), 'false');
      await page.locator('button[data-analysis-size="compact"]').click(); await plots(page);
      assert.equal(await page.evaluate(() => analysisCalls.length), 4);
    }, { deviceScaleFactor: 2 });
    await check('size segments, manual recall, collapsed focus and narrow wrapping', async page => {
      const sizes=page.locator('.analysis-sizes'),manual=page.locator('button[data-analysis-size="manual"]'),splitter=page.locator('#analysisSplitter');
      assert.deepEqual(await sizes.locator('button').allTextContents(),['Свернуть','Компактно','Баланс','Максимум','Вручную']);
      assert.equal(await manual.isDisabled(),true);
      await page.locator('#sampleImage').click();await ready(page);
      await page.locator('button[data-analysis-size="compact"]').click();await plots(page);
      const box=await splitter.boundingBox();
      await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();
      await page.mouse.move(box.x+box.width/2,box.y+box.height/2-80,{steps:5});await page.mouse.up();
      const saved=await splitter.getAttribute('aria-valuenow');
      assert.equal(await manual.getAttribute('aria-pressed'),'true');assert.equal(await sizes.locator('button.active').count(),1);
      await page.locator('button[data-analysis-size="balance"]').click();await manual.click();
      assert.equal(await splitter.getAttribute('aria-valuenow'),saved);
      await page.locator('#analysisCollapse').click();
      assert.equal(await page.locator('#analysisBody').isVisible(),false);assert.equal(await page.locator('#analysisCollapse').getAttribute('aria-pressed'),'true');
      assert.equal(await page.locator('#analysisCollapse').evaluate(button=>button===document.activeElement),true);
      await manual.click();await plots(page);assert.equal(await splitter.getAttribute('aria-valuenow'),saved);
      for(const width of [390,320]){
        await page.setViewportSize({width,height:1000});
        assert.equal(await page.locator('#analysisPanel').evaluate(panel=>panel.scrollWidth>panel.clientWidth),false);
        assert.equal(await sizes.locator('button:visible').count(),5);
      }
    });
    await check('graphs follow each cell, including the first; errors, quality, palette and layouts update automatically', async page => {
      await page.locator('#sampleImage').click(); await ready(page);
      await page.locator('button[data-analysis-size="compact"]').click(); await plots(page);
      await page.evaluate(() => holdComparisonRendering());
      await page.locator('.cell .format-select').nth(1).selectOption('png');
      assert.equal(await page.locator('.analysis-chart').nth(1).isVisible(), false);
      assert.ok((await page.locator('.analysis-info').nth(1).textContent()).includes('Ожидание пересчёта'));
      await page.evaluate(() => resumeComparisonRendering()); await ready(page); await plots(page);
      // The first graph must stop showing the source once cell 1 becomes JPEG.
      await page.locator('#analysisChannel').selectOption('alpha');
      const sourceAlpha = await page.locator('.analysis-chart').first().getAttribute('aria-label');
      
      await page.locator('.cell .format-select').nth(0).selectOption('jpeg');
      await ready(page); await plots(page);
      assert.notEqual(await page.locator('.analysis-chart').first().getAttribute('aria-label'), sourceAlpha);
      assert.ok((await page.locator('.analysis-chart').first().getAttribute('aria-label')).includes('Средние: α 255'));
      await page.locator('#analysisChannel').selectOption('rgb');
      const highQuality = await page.locator('.analysis-chart').first().getAttribute('aria-label');
      await page.locator('.cell .quality').nth(0).fill('1');
      await ready(page); await plots(page);
      assert.notEqual(await page.locator('.analysis-chart').first().getAttribute('aria-label'), highQuality);
      assert.ok((await page.locator('.analysis-chart').first().getAttribute('aria-label')).includes('качество 1.'));
      await page.locator('.cell .format-select').nth(1).selectOption('jpeg'); await ready(page); await plots(page);
      await page.locator('.cell .quality').nth(1).fill('1');
      await ready(page); await plots(page);
      assert.equal(await page.locator('.analysis-values').nth(0).textContent(), await page.locator('.analysis-values').nth(1).textContent());
      assert.equal(await page.locator('.analysis-values').nth(0).getAttribute('title'), await page.locator('.analysis-values').nth(1).getAttribute('title'));
      await page.evaluate(() => { const v=app.variants[1]; v.error='Проверочная ошибка'; updateMetrics(v); });
      assert.equal(await page.locator('.analysis-chart').nth(1).isVisible(), false);
      await page.evaluate(() => markDirty(app.variants[1])); await ready(page); await plots(page);
      await page.locator('.cell .format-select').nth(1).selectOption('ico');
      await ready(page); await plots(page);
      assert.ok((await page.locator('#analysisStatus').textContent()).includes('Размеры различаются'));
      assert.equal(await page.locator('.analysis-chart').evaluateAll(cs => cs[0].dataset.yMax === cs[1].dataset.yMax), true);
      await page.locator('#layout4').click(); await ready(page);
      await plots(page);
      assert.equal(await page.locator('.analysis-card:not([hidden])').count(), 4);
      assert.equal(await page.locator('.analysis-chart').evaluateAll(cs => new Set(cs.map(c => c.dataset.yMax)).size), 1);
      for (let index=0;index<4;index++) assert.ok((await page.locator('.analysis-chart').nth(index).getAttribute('aria-label')).startsWith(`${index+1} ·`));
      await page.locator('.cell .format-select').nth(3).selectOption('gif'); await ready(page);
      await page.locator('.cell .gif-wrap input').nth(3).fill('2');
      await page.locator('.cell .gif-wrap input').nth(3).dispatchEvent('change');
      await page.locator('.cell').nth(3).getByRole('checkbox', { name: 'Dither', exact: true }).uncheck();
      await ready(page); await plots(page);
      assert.ok((await page.locator('.analysis-chart').nth(3).getAttribute('aria-label')).includes('2 цветов'));
      if (folder) {
        fs.mkdirSync(folder,{recursive:true});
        await page.waitForFunction(() => getComputedStyle(document.getElementById('status')).opacity === '0');
        await page.screenshot({path:path.join(folder,artifacts.runId+'-analysis-four.png')});
      }
      await page.locator('#layout2').click(); await ready(page);
      await plots(page);
      assert.equal(await page.locator('.analysis-card:not([hidden])').count(), 2);
      assert.equal(await page.locator('.analysis-chart').nth(3).isVisible(), false);
      assert.equal(await page.locator('.analysis-values').nth(3).textContent(), '');
      await page.locator('#layout4').click(); await ready(page); await plots(page);
      assert.equal(await page.locator('.analysis-card:not([hidden])').count(), 4);
    });
    await check('slow old work yields to the latest request, one histogram job at a time; clear and close invalidate output', async page => {
      await page.locator('#sampleImage').click(); await ready(page);
      await page.evaluate(() => {
        const real = workerCompute; window.histogramActive=0; window.histogramMax=0; window.histogramStarted=0;
        workerCompute = async (kind, payload) => {
          if (kind !== 'histogram') return real(kind,payload);
          histogramStarted++; histogramActive++; histogramMax=Math.max(histogramMax,histogramActive);
          try { await new Promise(r=>setTimeout(r,250)); return await real(kind,payload); } finally { histogramActive--; }
        };
      });
      await page.locator('button[data-analysis-size="compact"]').click();
      await page.waitForFunction(() => histogramStarted > 0);
      await page.locator('#analysisMatte').selectOption('black');
      await plots(page);
      assert.ok((await page.locator('.analysis-index').first().getAttribute('title')).includes('чёрном'));
      assert.equal(await page.evaluate(() => histogramMax), 1);
      await page.locator('#clearFiles').click();
      assert.equal(await page.locator('.analysis-chart').first().isVisible(), false);
      await page.locator('#sampleImage').click(); await ready(page);
      await page.waitForFunction(() => histogramActive > 0);
      await page.locator('#fileInput').setInputFiles({name:'new.svg',mimeType:'image/svg+xml',buffer:Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="7" height="3"><path fill="red" d="M0 0h7v3H0z"/></svg>')});
      await page.locator('.file-select').last().click(); await ready(page); await plots(page);
      assert.ok((await page.locator('.analysis-index').first().getAttribute('title')).includes('7×3'));
      await page.locator('#analysisMatte').selectOption('white');
      await page.waitForFunction(() => histogramActive > 0);
      await page.locator('#analysisCollapse').click();
      await page.waitForFunction(() => histogramActive === 0);
      assert.equal(await page.locator('#analysisBody').isVisible(), false);
      assert.equal(await page.locator('.analysis-values').first().textContent(), '');
    });
    await check('histogram failure can be retried without breaking comparison', async page => {
      await page.locator('#sampleImage').click(); await ready(page);
      await page.evaluate(() => {
        const real = workerCompute; let once = true;
        workerCompute = (kind,payload) => { if(kind==='histogram' && once) { once=false; return Promise.reject(new Error('Расчёт прерван')); } return real(kind,payload); };
      });
      await page.locator('button[data-analysis-size="compact"]').click();
      await page.waitForFunction(() => document.querySelector('.analysis-info').textContent.includes('Расчёт прерван'));
      await page.locator('#analysisCollapse').click(); await page.locator('button[data-analysis-size="compact"]').click(); await plots(page);
      assert.equal(await page.evaluate(() => app.variants.slice(0,2).every(isVariantReady)), true);
    });
    await check('whole-image splitter drag, keyboard, cancellation, maximum and session restoration without recomputing or encoding', async page => {
      // A viewport histogram follows resized previews; this fixture checks whole-image reuse.
      await page.locator('#analysisScope').selectOption('full', { force: true });
      await page.locator('#sampleImage').click(); await ready(page);
      await page.locator('button[data-analysis-size="compact"]').click(); await plots(page);
      await page.locator('#zoom100').click();
      const before = await page.evaluate(() => {
        window.splitEncodes = 0; window.splitComputes = 0;
        const encode = encodeOne, compute = workerCompute;
        encodeOne = (...args) => { splitEncodes++; return encode(...args); };
        workerCompute = (...args) => { splitComputes++; return compute(...args); };
        window.splitBlobs = app.variants.map(v => v.blob);
        return {view:{...app.view},comparison:captureComparison(),batch:JSON.stringify(app.exportConfig)};
      });
      const splitter = page.locator('#analysisSplitter'), panel = page.locator('#analysisPanel');
      const height = (await panel.boundingBox()).height, box = await splitter.boundingBox();
      await page.mouse.move(box.x+box.width/2, box.y+box.height/2);
      await page.mouse.down(); await page.mouse.move(box.x+box.width/2,box.y+box.height/2-80,{steps:5}); await page.mouse.up();
      await page.waitForFunction(h=>document.getElementById('analysisPanel').getBoundingClientRect().height>h,height);
      const ratio = Number(await splitter.getAttribute('aria-valuenow'));
      await splitter.focus(); await page.keyboard.press('ArrowUp');
      assert.ok(Number(await splitter.getAttribute('aria-valuenow')) > ratio);
      const adjusted = await splitter.getAttribute('aria-valuenow');
      await page.locator('button[data-analysis-size="max"][aria-pressed]').click();
      assert.equal(await splitter.isVisible(),true);
      await page.keyboard.press('Escape');
      assert.equal(await splitter.getAttribute('aria-valuenow'),adjusted);
      assert.equal(await splitter.evaluate(s=>s===document.activeElement),true);
      await page.locator('button[data-analysis-size="max"][aria-pressed]').click();
      const maximumStrip=await splitter.boundingBox();
      await page.mouse.move(maximumStrip.x+maximumStrip.width/2,maximumStrip.y+maximumStrip.height/2);
      await page.mouse.down();await page.mouse.move(maximumStrip.x+maximumStrip.width/2,maximumStrip.y+maximumStrip.height/2+100,{steps:5});await page.mouse.up();
      await plots(page);
      assert.notEqual(await page.locator('.stage').getAttribute('data-analysis-size'),'max');
      assert.equal(await page.locator('.canvas-shell:visible').count(),2);
      assert.equal(await splitter.isVisible(),true);
      await page.locator('#analysisCollapse').click();
      assert.equal(await page.locator('.canvas-shell:visible').count(),2);
      await page.locator('button[data-analysis-size="compact"]').click(); await plots(page);
      const reopened = await splitter.getAttribute('aria-valuenow');
      assert.equal(await page.locator('button[data-analysis-size="compact"]').getAttribute('aria-pressed'),'true');
      const current = await splitter.boundingBox();
      await page.mouse.move(current.x+current.width/2,current.y+current.height/2); await page.mouse.down();
      await page.mouse.move(current.x+current.width/2,current.y+current.height/2+40);
      await page.keyboard.press('Escape'); await page.mouse.up();
      await page.waitForFunction(v=>document.getElementById('analysisSplitter').getAttribute('aria-valuenow')===v,reopened);
      assert.deepEqual(await page.evaluate(()=>({view:{...app.view},comparison:captureComparison(),batch:JSON.stringify(app.exportConfig)})),before);
      assert.deepEqual(await page.evaluate(()=>({encode:splitEncodes,compute:splitComputes,same:app.variants.every((v,i)=>v.blob===splitBlobs[i])})),{encode:0,compute:0,same:true});
      assert.equal(await page.locator('#zoomReadout').textContent(),'100%');
      await splitter.dblclick();
      assert.equal(await page.locator('button[data-analysis-size="compact"][aria-pressed]').getAttribute('aria-pressed'),'true');
      await page.locator('#layout4').click(); await ready(page); await plots(page);
      for (const width of [1440,768,390,320]) {
        await page.setViewportSize({width,height:1000});
        await splitter.focus(); await page.keyboard.press('End');
        assert.equal(await page.locator('.canvas-shell:visible').evaluateAll(ss=>ss.every(s=>s.getBoundingClientRect().height>=47.5)),true);
        assert.equal(await page.locator('.cell-head:visible').count(),4);
        assert.equal(await page.locator('.cell-foot:visible').count(),4);
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
        await page.keyboard.press('Home'); await page.keyboard.press('Enter');
      }
    }, { deviceScaleFactor: 2 });
    await check('empty, inline sizes, desktop/narrow layouts, keyboard and focus; screenshots', async page => {
      await page.locator('button[data-analysis-size="compact"]').click();
      assert.ok((await page.locator('.analysis-info').first().textContent()).includes('Добавьте'));
      await page.locator('#sampleImage').click(); await ready(page); await plots(page);
      assert.equal(await page.locator('.analysis-info').first().isVisible(), false);
      assert.equal(await page.locator('#analysisStatus').isVisible(), false);
      await page.locator('#analysisHelp').click();
      assert.equal(await page.locator('#analysisHelpContent').isVisible(), true);
      assert.ok((await page.locator('#analysisDetails').textContent()).includes('Средние:'));
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('#analysisHelpContent').isVisible(), false);
      assert.equal(await page.locator('#analysisHelp').evaluate(b => b === document.activeElement), true);
      await page.waitForFunction(() => getComputedStyle(document.getElementById('status')).opacity === '0');
      const compact = await page.locator('.analysis-chart').first().boundingBox();
      const before = await page.evaluate(() => {
        window.layoutBlobs = app.variants.map(v => v.blob);
        return {revision:getAnalysisSnapshot().revision, view:{...app.view}};
      });
      await page.locator('button[data-analysis-size="balance"][aria-pressed]').click();
      await page.waitForFunction(h => document.querySelector('.analysis-chart').getBoundingClientRect().height > h, compact.height);
      const balance = await page.locator('.analysis-chart').first().boundingBox();
      await page.locator('button[data-analysis-size="max"][aria-pressed]').click();
      await page.waitForFunction(h => document.querySelector('.analysis-chart').getBoundingClientRect().height > h, balance.height);
      assert.equal(await page.locator('.canvas-shell:visible').count(), 0);
      assert.equal(await page.locator('.cell-head:visible').count(), 2);
      assert.equal(await page.locator('.cell-foot:visible').count(), 2);
      assert.equal(await page.locator('.stage > #analysisPanel').count(), 1);
      assert.equal(await page.locator('dialog[open]').count(), 0);
      assert.equal(await page.evaluate(() => app.variants.every((v,i) => v.blob === layoutBlobs[i])), true);
      assert.deepEqual(await page.evaluate(() => ({revision:getAnalysisSnapshot().revision,view:{...app.view}})), before);
      await page.locator('button[data-analysis-size="compact"][aria-pressed]').click();
      if (folder) { fs.mkdirSync(folder,{recursive:true}); await page.screenshot({path:path.join(folder,artifacts.runId+'-analysis-desktop.png')}); }
      for (const width of [1440,1080,768,390,320]) {
        await page.setViewportSize({width,height:900});
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        await page.locator('button[data-analysis-size="max"][aria-pressed]').click();
        assert.equal(await page.locator('.canvas-shell:visible').count(), 0);
        assert.equal(await page.locator('#analysisPanel').evaluate(d => d.scrollWidth > d.clientWidth), false);
        await page.locator('#analysisHelp').click();
        assert.equal(await page.locator('#analysisHelpContent').isVisible(), true);
        await page.keyboard.press('Escape');
        assert.equal(await page.locator('#analysisHelpContent').isVisible(), false);
        assert.equal(await page.locator('.stage').getAttribute('data-analysis-size'), 'max');
        await page.locator('.cell .format-select').first().focus();
        assert.equal(await page.locator('.cell .format-select').first().evaluate(b => b === document.activeElement), true);
        await page.locator('button[data-analysis-size="max"][aria-pressed]').focus();
        if (width===390 && folder) await page.screenshot({path:path.join(folder,artifacts.runId+'-analysis-mobile.png')});
        await page.keyboard.press('Escape');
        assert.equal(await page.locator('.stage').getAttribute('data-analysis-size'), 'compact');
        assert.equal(await page.locator('button[data-analysis-size="compact"][aria-pressed]').evaluate(b => b === document.activeElement), true);
      }
      await page.locator('#layout4').click(); await ready(page); await plots(page);
      await page.locator('button[data-analysis-size="max"][aria-pressed]').click();
      assert.equal(await page.locator('.analysis-card:not([hidden])').count(), 4);
      assert.equal(await page.locator('#analysisPanel').evaluate(d => d.scrollWidth > d.clientWidth), false);
      await page.keyboard.press('Escape');
      await page.locator('button[data-analysis-size="max"][aria-pressed]').click(); await page.locator('#analysisCollapse').click();
      assert.equal(await page.locator('#analysisBody').isVisible(), false);
      assert.equal(await page.locator('#analysisCollapse').evaluate(b => b===document.activeElement), true);
      assert.equal(await page.locator('.canvas-shell:visible').count(), 4);
      await page.locator('button[data-analysis-size="max"]').click(); await plots(page);
      assert.equal(await page.locator('button[data-analysis-size="max"][aria-pressed]').getAttribute('aria-pressed'), 'true');
      assert.equal(await page.locator('.canvas-shell:visible').count(), 0);
    });
  } finally {
    await browser.close();
    if (folder) { fs.mkdirSync(folder,{recursive:true}); fs.writeFileSync(path.join(folder,artifacts.runId+'-analysis.json'),JSON.stringify({checks,failures},null,2)); }
  }
  process.exitCode = failures ? 1 : 0;
})().catch(error => { console.error(error); process.exitCode=1; });
