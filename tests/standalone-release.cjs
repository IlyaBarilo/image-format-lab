const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');
const artifacts = require('./support/artifacts.cjs');
const codecProbe = require('./support/codec-probe.cjs');
const root = path.resolve(__dirname, '..');
async function bytesOf(download) { const chunks = []; for await (const chunk of await download.createReadStream()) chunks.push(chunk); return Buffer.concat(chunks); }
async function downloadFrom(page, button) {
  try {
    const [download] = await Promise.all([page.waitForEvent('download'), button.click()]);
    return bytesOf(download);
  } catch (error) {
    console.error('Download failure UI:', await page.locator('#codecStatus, .cell').allTextContents());
    throw error;
  }
}
async function dimensions(page, bytes) {
  return page.evaluate(async data => { const bitmap = await createImageBitmap(new Blob([new Uint8Array(data)])); try { return [bitmap.width, bitmap.height]; } finally { bitmap.close(); } }, [...bytes]);
}
(async () => {
  const file = path.join(os.tmpdir(), 'viewer-public-release-' + crypto.randomUUID() + '.html');
  fs.copyFileSync(path.join(root, 'image-format-lab.html'), file);
  const report = { publicHtml: 'image-format-lab.html', bytes: fs.statSync(file).size, sha256: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'), checks: [], externalRequests: [], errors: [] };
  let browser;
  try {
    browser = await chromium.launch({ headless: true, executablePath: process.env.IMAGE_TEST_BROWSER || undefined });
    report.browser = browser.version();
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
    await context.setOffline(true);
    const page = await context.newPage(); page.setDefaultTimeout(20000);
    await page.addInitScript(codecProbe);
    const url = pathToFileURL(file).href;
    context.on('request', request => { if (request.url() !== url && !/^(blob:|data:)/.test(request.url())) report.externalRequests.push(request.url()); });
    page.on('pageerror', error => report.errors.push(error.message));
    await page.goto(url);
    assert.equal(await page.locator('#analysisToggle').count(), 0);
    assert.equal(await page.locator('#analysisPanel').isVisible(), true);
    assert.equal(await page.locator('#analysisBody').isVisible(), true);
    assert.equal(await page.evaluate(() => Object.values(JSON.parse(document.getElementById('embedded-codecs').textContent).scripts)
      .filter(entry => entry?.encoding === 'gzip-base64').length), 3);
    assert.equal(await page.evaluate(() => 'encodeFromSource' in globalThis || 'app' in globalThis), false);
    await page.waitForFunction(() => document.getElementById('codecStatus').dataset.state === 'ready');
    assert.equal(await page.locator('#codecNotice').isVisible(), false);
    assert.equal(await page.locator('#loadCodecs').count(), 0);
    assert.equal(await page.locator('#retryCodecs').isVisible(), false);
    assert.equal(await page.locator('.cell button[title="Скачать вариант"]:enabled').count(), 0);
    assert.equal(await page.evaluate(() => codecProbe.scripts.length), 3);
    assert.equal(await page.evaluate(() => codecProbe.scripts.every(url => codecProbe.revoked.includes(url))), true);
    report.checks.push('three gzip-packed modules and four plain scripts: all codecs start automatically once, without a load button or network');
    await page.locator('#licensesOpen').click();
    assert.equal(await page.locator('#licensesDialog').isVisible(), true);
    assert.equal(await page.locator('#licensesContent .license-component').count(), 20);
    assert.equal(await page.locator('#licensesError').textContent(), '');
    const releaseTag = await page.evaluate(() => JSON.parse(document.getElementById('embedded-codecs').textContent).releaseTag);
    assert.equal(await page.locator('#licensesContent .license-component h3').first().textContent(), 'Image Format Lab' + (releaseTag ? ' · ' + releaseTag : ''));
    if (process.env.IMAGE_TEST_SCREENSHOTS) {
      const out = artifacts.folder(process.env.IMAGE_TEST_SCREENSHOTS); fs.mkdirSync(out, { recursive: true });
      await page.screenshot({ path: path.join(out, artifacts.runId + '-licenses-desktop.png') });
    }
    const noticeBytes = await downloadFrom(page, page.locator('#licensesDownload'));
    assert.ok(noticeBytes.toString('utf8').includes('Mozilla Public License Version 2.0'));
    assert.ok(noticeBytes.toString('utf8').includes('Dirk Farin'));
    const packages = await page.evaluate(() => JSON.parse(document.getElementById('embedded-codecs').textContent).sourcePackages);
    for (const [id, selector] of [['gifenc', '#licensesSources'], ['heic', '#licensesHeicSources']]) {
      const link = page.locator(selector);
      assert.equal(await link.isVisible(), Boolean(packages[id].url));
      assert.equal(await link.getAttribute('href'), packages[id].url ? new URL(packages[id].url).href : null);
      assert.equal(await link.getAttribute('rel'), 'noopener noreferrer');
    }
    if (!packages.gifenc.url || !packages.heic.url) assert.match(await page.locator('#licensesSourceStatus').textContent(), /Локальная сборка/);
    // Offline test checks links without following them; archives are checked by source-packages.cjs.
    await page.setViewportSize({ width: 390, height: 900 });
    await page.locator('#licensesContent details').first().locator('summary').click();
    assert.equal(await page.locator('#licensesDialog').evaluate(el => el.scrollWidth > el.clientWidth + 1), false);
    if (process.env.IMAGE_TEST_SCREENSHOTS) await page.screenshot({ path: path.join(artifacts.folder(process.env.IMAGE_TEST_SCREENSHOTS), artifacts.runId + '-licenses-mobile.png') });
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#licensesDialog').isVisible(), false);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'licensesOpen');
    await page.setViewportSize({ width: 1440, height: 1000 });
    report.checks.push('license dialog, offline notices, separate source links/local status, narrow layout and Escape focus return');
    await page.locator('#sampleImage').click();
    const cell = page.locator('.cell').nth(1), save = cell.locator('button[title="Скачать вариант"]');
    await page.waitForFunction(() => document.getElementById('analysisCombined').dataset.state === 'ready' && document.getElementById('analysisCombinedChart').dataset.kind === 'histogram');
    assert.equal(await page.locator('#analysisDisplayOverlay').isChecked(), true);
    await page.locator('#analysisType').selectOption('waveform');
    assert.equal(await page.locator('#analysisDisplaySeparate').isChecked(), true);
    await page.locator('#analysisType').selectOption('histogram');
    assert.equal(await page.locator('#analysisDisplayOverlay').isChecked(), true);
    await page.locator('#analysisDisplayOverlay').focus();await page.keyboard.press('ArrowLeft');
    assert.equal(await page.locator('#analysisDisplaySeparate').isChecked(), true);
    await page.keyboard.press('ArrowRight');assert.equal(await page.locator('#analysisDisplayOverlay').isChecked(), true);
    await page.keyboard.press('ArrowRight');assert.equal(await page.locator('#analysisDisplayDelta').isChecked(), true);
    await page.waitForFunction(() => document.getElementById('analysisCombined').dataset.state === 'ready' && document.getElementById('analysisCombinedChart').dataset.mode === 'delta');
    const deltaReport = JSON.parse((await downloadFrom(page, page.locator('#analysisJSON'))).toString('utf8'));
    assert.equal(deltaReport.settings.display, 'delta');assert.deepEqual(deltaReport.delta.pair, [1, 2]);
    assert.equal(deltaReport.delta.unit, 'percentage-points');assert.equal(deltaReport.delta.operation, 'second-minus-first');
    assert.equal(deltaReport.delta.maximum, Number(await page.locator('#analysisCombinedChart').getAttribute('data-max-abs')));
    await page.locator('#analysisDisplayDelta').focus();await page.keyboard.press('ArrowLeft');assert.equal(await page.locator('#analysisDisplayOverlay').isChecked(), true);
    report.checks.push('View difference keyboard selection, signed histogram scale and numeric JSON export');
    await page.locator('#analysisDisplaySeparate').click();
    await page.waitForFunction(() => [...document.querySelectorAll('.analysis-card')].filter(c => !c.hidden).every(c => c.dataset.state === 'ready'));
    assert.equal(await page.locator('.analysis-card select').count(), 0);
    assert.equal(await page.locator('.analysis-card:not([hidden])').count(), 2);
    assert.equal(await page.locator('.analysis-chart').evaluateAll(cs => cs[0].dataset.yMax === cs[1].dataset.yMax), true);
    await page.locator('#analysisChannel').selectOption('alpha');
    assert.equal(await page.locator('#analysisMatte').isDisabled(), true);
    for (const kind of ['waveform', 'parade']) {
      await page.locator('#analysisType').selectOption(kind);
      await page.waitForFunction(kind => [...document.querySelectorAll('.analysis-card')].filter(c => !c.hidden)
        .every(c => c.dataset.state === 'ready' && c.querySelector('canvas').dataset.kind === kind), kind);
      assert.equal(await page.locator('#analysisMatte').isDisabled(), false);
      assert.equal(await page.locator('.analysis-chart:visible').evaluateAll(cs => cs.every(c => c.dataset.yMax === '255') && new Set(cs.map(c => c.dataset.densityMax)).size === 1), true);
    }
    await page.locator('button[data-analysis-size="max"][aria-pressed]').click();
    assert.equal(await page.locator('.canvas-shell:visible').count(), 0);
    assert.equal(await page.locator('#analysisSplitter').isVisible(),true);
    const maxStrip=await page.locator('#analysisSplitter').boundingBox(), maxPanel=await page.locator('#analysisPanel').boundingBox();
    assert.ok(maxStrip.height>=12&&maxStrip.y+maxStrip.height<=maxPanel.y+1,'maximum reserves a row for the strip above the plots');
    assert.equal(await page.locator('.cell-head:visible').count(), 2);
    assert.equal(await page.locator('.stage > #analysisPanel').count(), 1);
    await page.keyboard.press('Escape');
    const splitBefore = Number(await page.locator('#analysisSplitter').getAttribute('aria-valuenow'));
    await page.locator('#analysisSplitter').focus(); await page.keyboard.press('ArrowUp');
    const splitAfter = Number(await page.locator('#analysisSplitter').getAttribute('aria-valuenow'));
    assert.ok(splitAfter > splitBefore);
    await page.locator('button[data-analysis-size="max"][aria-pressed]').click();
    await page.locator('button[data-analysis-size="max"][aria-pressed]').click();
    assert.equal(Number(await page.locator('#analysisSplitter').getAttribute('aria-valuenow')),splitAfter);
    await page.locator('#analysisCollapse').click();
    report.checks.push('public offline histogram, waveform and RGB Parade Worker, shared axes/density, alpha, inline sizes and keyboard splitter without test instrumentation');
    await page.locator('button[data-analysis-size="compact"]').click();
    await page.locator('#analysisType').selectOption('difference');
    await page.waitForFunction(() => [...document.querySelectorAll('.analysis-card')].filter(c=>!c.hidden).every(c=>c.dataset.state==='ready'&&c.querySelector('canvas').dataset.kind==='difference'));
    assert.equal(await page.locator('.analysis-chart').first().getAttribute('data-mean'),'0');
    await page.locator('#analysisScope').selectOption('region');
    await page.locator('#analysisRegionX').fill('25');await page.locator('#analysisRegionWidth').fill('50');
    await page.locator('#analysisRegionApply').click();
    await page.waitForFunction(() => document.querySelector('.analysis-chart').getAttribute('aria-label').includes('480×640'));
    await page.locator('#analysisGain').selectOption('16');
    assert.equal(await page.locator('.analysis-chart').nth(1).getAttribute('data-gain'),'16');
    assert.equal(await page.locator('#analysisScope').inputValue(),'region');
    assert.equal(await page.locator('#analysisScope').evaluate(node=>node.selectedOptions[0].hidden),true);
    await page.locator('#analysisScope').selectOption('region');
    assert.equal(await page.locator('#analysisRegionEditor').isVisible(),true);
    assert.equal(await page.locator('#analysisRegionX').inputValue(),'25');
    await page.locator('#analysisRegionCancel').click();
    assert.equal(await page.evaluate(()=>document.activeElement.id),'analysisScope');
    await page.locator('#analysisScope').selectOption('region');await page.locator('#analysisRegionReset').click();
    await page.locator('#analysisCollapse').click();
    report.checks.push('public offline difference map, shared gain and region apply/reset without test instrumentation');
    await page.locator('button[data-analysis-size="compact"]').click();
    for(const kind of ['vectorscope','profile']){
      await page.locator('#analysisType').selectOption(kind);
      if(kind==='profile'){
        assert.equal(await page.locator('#analysisDisplayOverlay').isChecked(),true);
        await page.waitForFunction(()=>document.getElementById('analysisCombinedChart').dataset.kind==='profile'&&document.getElementById('analysisCombined').dataset.state==='ready');
        await page.locator('#analysisDisplaySeparate').check();
      }
      await page.waitForFunction(kind=>[...document.querySelectorAll('.analysis-card')].filter(c=>!c.hidden).every(c=>c.dataset.state==='ready'&&c.querySelector('canvas').dataset.kind===kind),kind);
      assert.equal(await page.locator('.analysis-chart:visible').evaluateAll(cs=>new Set(cs.map(c=>c.dataset.yMax)).size===1),true);
    }
    await page.locator('#analysisLineOpen').click();await page.locator('[data-line-preset="vertical"]').click();await page.locator('#analysisRegionApply').click();
    await page.waitForFunction(()=>document.querySelector('.analysis-chart').dataset.profileSamples==='640');
    await page.locator('#analysisPosition').fill('1000');await page.locator('#analysisProfileChannel').selectOption('alpha');
    assert.equal(await page.locator('#analysisMatte').isDisabled(),true);
    assert.ok((await page.locator('.analysis-values').nth(1).textContent()).includes('α 255'));
    await page.locator('#analysisLineOpen').click();await page.locator('#analysisRegionReset').click();
    await page.waitForFunction(()=>document.querySelector('.analysis-chart').dataset.profileSamples==='960');
    await page.locator('#analysisCollapse').click();
    report.checks.push('public offline vectorscope and line profile, shared axes, line apply/reset and alpha cursor without test instrumentation');
    await page.locator('button[data-analysis-size="compact"]').click();await page.locator('#analysisDisplayOverlay').click();
    await page.waitForFunction(()=>document.getElementById('analysisCombinedChart').dataset.kind==='profile'&&document.getElementById('analysisCombined').dataset.state==='ready');
    const profileAnalysis=JSON.parse((await downloadFrom(page,page.locator('#analysisJSON'))).toString('utf8'));
    assert.equal(profileAnalysis.settings.display,'overlay');assert.equal(profileAnalysis.items.length,2);assert.ok(Array.isArray(profileAnalysis.items[0].data.channels[0].mean));
    await page.locator('#analysisType').selectOption('tradeoff');await page.waitForFunction(()=>document.getElementById('analysisCombinedChart').dataset.kind==='tradeoff');
    const metricAnalysis=JSON.parse((await downloadFrom(page,page.locator('#analysisJSON'))).toString('utf8'));assert.equal(metricAnalysis.items[0].measurement.psnrRGB,'Infinity');
    const analysisPng=await downloadFrom(page,page.locator('#analysisPNG'));assert.equal((await dimensions(page,analysisPng))[0],1200);
    await page.locator('#analysisCollapse').click();
    report.checks.push('public offline overlay, size/metric scatter, JSON arrays/Infinity and PNG analysis download');
    for (const format of ['jpeg', 'png', 'gif', 'bmp24', 'bmp32', 'webp']) {
      const option = cell.locator(`.format-select option[value="${format}"]`);
      if (await option.isDisabled()) continue;
      await cell.locator('.format-select').selectOption(format);
      assert.deepEqual(await dimensions(page, await downloadFrom(page, save)), [960, 640]);
      report.checks.push('public UI export ' + format);
    }
    for (const format of ['pngUpng', 'gifenc']) {
      await cell.locator('.format-select').selectOption(format);
      assert.deepEqual(await dimensions(page, await downloadFrom(page, save)), [960, 640]);
      report.checks.push('public UI export ' + format);
    }
    for (const format of ['avif', 'webpLossless', 'jxl', 'jxlLossless', 'tiff', 'ico']) {
      await cell.locator('.format-select').selectOption(format);
      const bytes = await downloadFrom(page, save);
      if (format === 'avif') assert.equal(bytes.toString('ascii', 8, 12), 'avif');
      else if (format === 'webpLossless') assert.equal(bytes.toString('ascii', 8, 12), 'WEBP');
      else if (format.startsWith('jxl')) assert.equal(bytes.readUInt16BE(0), 0xff0a);
      else if (format === 'tiff') assert.equal(bytes.readUInt32LE(0), 0x002a4949);
      else { assert.equal(bytes.readUInt16LE(2), 1); assert.equal(bytes.readUInt16LE(4), 7); }
      report.checks.push('public UI export and file signature ' + format);
    }
    await cell.locator('.format-select').selectOption('heic');
    const exportedHeic = await downloadFrom(page, save);
    assert.equal(exportedHeic.toString('ascii', 8, 12), 'heic');
    report.checks.push('public UI HEIC export through the embedded Kvazaar encoder');
    const tiff = fs.readFileSync(path.join(root, 'tests/fixtures/tiff/shared-tables-strips.tiff'));
    await page.locator('#convertAll').click();
    await page.locator('#batchFormat').selectOption('png');
    await page.locator('#batchResizeMode').selectOption('limit');
    await page.locator('#batchDialogWidth').fill('320');
    assert.deepEqual(await dimensions(page, await downloadFrom(page, page.locator('#batchPreviewDownload'))), [320, 213]);
    await page.locator('#batchDelivery').selectOption('zip');
    const zip = await downloadFrom(page, page.locator('#batchStart')); assert.equal(zip.readUInt32LE(0), 0x04034b50);
    report.checks.push('public batch preview resize and ZIP download');
    await page.locator('#studyOpen').click();
    const json = JSON.parse((await downloadFrom(page, page.locator('#reportJSON'))).toString('utf8'));
    assert.equal(json.source.width, 960); assert.ok(json.variants[1].metrics.bytes > 0);
    await page.keyboard.press('Escape');
    report.checks.push('public comparison report download');
    if (process.env.IMAGE_TEST_SCREENSHOTS) {
      const out = artifacts.folder(process.env.IMAGE_TEST_SCREENSHOTS); fs.mkdirSync(out, { recursive: true });
      await page.screenshot({ path: path.join(out, artifacts.runId + '-modular-desktop.png') });
      await page.setViewportSize({ width: 390, height: 900 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await page.screenshot({ path: path.join(out, artifacts.runId + '-modular-mobile.png'), fullPage: true });
      report.checks.push('public mobile width 390 and desktop screenshots');
    }
    // User preferences round-trip through the real public UI and browser storage.
    // This scenario requires a separately authorized browser run on the current device.
    await page.setViewportSize({width:1440,height:1000});
    await page.locator('#layout4').click();
    await page.locator('.cell').nth(1).locator('.format-select').selectOption('jpeg');
    assert.equal(await page.locator('#autoApply, #applyAll, .cell button[title="Пересчитать этот вариант"]').count(),0);
    await page.locator('#backgroundSelect').selectOption('black');
    if(await page.locator('html').getAttribute('data-theme')!=='dark')await page.locator('#themeToggle').click();
    if(await page.locator('#toggleFiles').getAttribute('aria-expanded')==='true')await page.locator('#toggleFiles').click();
    await page.locator('button[data-analysis-size="balance"]').click();
    await page.locator('#analysisType').selectOption('histogram');await page.locator('#analysisDisplayDelta').click();
    await page.locator('#analysisType').selectOption('profile');await page.locator('#analysisDisplaySeparate').click();
    await page.locator('#analysisScope').selectOption('viewport');
    await page.locator('#analysisCollapse').click();
    await page.waitForFunction(()=>{
      const value=JSON.parse(localStorage.getItem('image-format-viewer.preferences.v1'));
      return value?.comparison.autoApply===true&&value?.comparison.layout===4&&value.filesVisible===false&&value.panels.collapsed&&value.analysis.type==='profile'&&value.analysis.displays.histogram==='delta';
    });
    await page.reload();
    assert.equal(await page.locator('#layout4').getAttribute('aria-pressed'),'true');
    assert.equal(await page.locator('#backgroundSelect').inputValue(),'black');
    assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');assert.equal(await page.locator('#toggleFiles').getAttribute('aria-expanded'),'false');
    assert.equal(await page.locator('#analysisBody').isVisible(),false);
    await page.locator('button[data-analysis-size="balance"]').click();
    assert.equal(await page.locator('#analysisType').inputValue(),'profile');assert.equal(await page.locator('#analysisDisplaySeparate').isChecked(),true);
    assert.equal(await page.locator('#analysisScope').inputValue(),'viewport');
    await page.locator('#analysisType').selectOption('histogram');assert.equal(await page.locator('#analysisDisplayDelta').isChecked(),true);
    await page.locator('#toggleFiles').click();await page.locator('#sampleImage').click();
    await page.waitForFunction(()=>document.querySelectorAll('#fileList .file-row').length===1);
    await page.locator('#studyOpen').click();await page.locator('#profileName').fill('Kept through reset');await page.locator('#profileSave').click();await page.keyboard.press('Escape');
    const profiles=await page.evaluate(()=>localStorage.getItem('image-format-viewer.comparison-profiles.v1'));
    await page.locator('#resetPreferences').click();
    assert.equal(await page.locator('#fileList .file-row').count(),1);assert.equal(await page.locator('#layout2').getAttribute('aria-pressed'),'true');
    assert.equal(await page.locator('#backgroundSelect').inputValue(),'checker');
    assert.equal(await page.locator('button[data-analysis-size="compact"]').getAttribute('aria-pressed'),'true');
    assert.equal(await page.locator('#analysisType').inputValue(),'histogram');assert.equal(await page.locator('#analysisDisplayOverlay').isChecked(),true);
    assert.equal(await page.locator('#analysisScope').inputValue(),'full');
    assert.deepEqual(await page.evaluate(()=>['image-format-viewer.preferences.v1','image-format-viewer.theme.v1','image-format-viewer.batch-settings.v1'].map(key=>localStorage.getItem(key))),[null,null,null]);
    assert.equal(await page.evaluate(()=>localStorage.getItem('image-format-viewer.comparison-profiles.v1')),profiles);
    assert.equal(await page.locator('html').getAttribute('data-theme'),await page.evaluate(()=>matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'));
    report.checks.push('public preferences restore on reload and reset preserves loaded files and named profiles');
    await page.reload(); await page.locator('#fileInput').setInputFiles({ name: 'known.tiff', mimeType: 'image/tiff', buffer: Buffer.from(tiff) });
    assert.deepEqual(await dimensions(page, await downloadFrom(page, page.locator('.cell').nth(1).locator('button[title="Скачать вариант"]'))), [37, 23]);
    report.checks.push('JPEG-in-TIFF with shared tables and multiple strips decodes through the UI with automatic Worker startup');
    await page.reload(); await page.locator('#fileInput').setInputFiles(path.join(root, 'tests/fixtures/heic/rotate90.heic'));
    assert.deepEqual(await dimensions(page, await downloadFrom(page, page.locator('.cell').nth(1).locator('button[title="Скачать вариант"]'))), [64, 96]);
    report.checks.push('synthetic HEIC rotation decodes through the public UI offline; HEIC source ZIP downloaded byte-for-byte');
    await page.reload();
    await page.locator('#fileInput').setInputFiles({ name: 'viewer-export.heic', mimeType: 'image/heic', buffer: exportedHeic });
    assert.deepEqual(await dimensions(page, await downloadFrom(page, page.locator('.cell').nth(1).locator('button[title="Скачать вариант"]'))), [960, 640]);
    report.checks.push('public HEIC export reopens offline and converts back to JPEG at the original dimensions');
    // Partial startup failure keeps basic formats usable; only failed scripts retry.
    const failureContext = await browser.newContext({ acceptDownloads: true });
    await failureContext.setOffline(true);
    await failureContext.addInitScript(codecProbe, { failFirst: true });
    failureContext.on('request', request => { if (request.url() !== url && !/^(blob:|data:)/.test(request.url())) report.externalRequests.push(request.url()); });
    const failedPage = await failureContext.newPage();
    failedPage.on('pageerror', error => report.errors.push(error.message));
    await failedPage.goto(url);
    await failedPage.waitForFunction(() => document.getElementById('codecStatus').dataset.state === 'error');
    assert.equal(await failedPage.locator('#codecNotice').isVisible(), true);
    assert.equal(await failedPage.locator('#retryCodecs').isVisible(), true);
    assert.equal(await failedPage.locator('.cell button[title="Скачать вариант"]:enabled').count(), 0);
    await failedPage.locator('#sampleImage').click();
    assert.deepEqual(await dimensions(failedPage, await downloadFrom(failedPage, failedPage.locator('.cell').nth(1).locator('button[title="Скачать вариант"]'))), [960, 640]);
    await failedPage.locator('#retryCodecs').click();
    await failedPage.waitForFunction(() => document.getElementById('codecStatus').dataset.state === 'ready');
    assert.equal(await failedPage.locator('#codecNotice').isVisible(), false);
    assert.equal(await failedPage.locator('#retryCodecs').isVisible(), false);
    assert.equal(await failedPage.evaluate(() => codecProbe.scripts.length), 4);
    assert.equal(await failedPage.evaluate(() => codecProbe.scripts.every(url => codecProbe.revoked.includes(url))), true);
    report.checks.push('startup failure leaves JPEG usable; conditional retry recovers without restarting ready codecs');
    await failureContext.close();

    // Slow startup does not block the main UI, and a saved format is never substituted.
    const slowContext = await browser.newContext({ acceptDownloads: true });
    await slowContext.setOffline(true);
    await slowContext.addInitScript(codecProbe, { hold: true });
    await slowContext.addInitScript(() => localStorage.setItem('image-format-viewer.batch-settings.v1', JSON.stringify({ version: 1, config: { format: 'pngUpng', quality: 72 } })));
    slowContext.on('request', request => { if (request.url() !== url && !/^(blob:|data:)/.test(request.url())) report.externalRequests.push(request.url()); });
    const slowPage = await slowContext.newPage();
    slowPage.on('pageerror', error => report.errors.push(error.message));
    await slowPage.goto(url);
    assert.equal(await slowPage.locator('#codecStatus').getAttribute('data-state'), 'loading');
    assert.equal(await slowPage.locator('#codecNotice').isVisible(), false);
    assert.equal(await slowPage.locator('#retryCodecs').isVisible(), false);
    await slowPage.locator('#sampleImage').click();
    await slowPage.locator('#convertAll').click();
    assert.equal(await slowPage.locator('#batchFormat').inputValue(), 'pngUpng');
    assert.equal(await slowPage.locator('#batchStart').isDisabled(), true);
    await slowPage.evaluate(() => codecProbe.release());
    await slowPage.waitForFunction(() => document.getElementById('codecStatus').dataset.state === 'ready');
    assert.equal(await slowPage.locator('#batchFormat').inputValue(), 'pngUpng');
    assert.deepEqual(await dimensions(slowPage, await downloadFrom(slowPage, slowPage.locator('#batchPreviewDownload'))), [960, 640]);
    assert.equal(await slowPage.locator('#batchStart').isDisabled(), false);
    assert.equal(await slowPage.evaluate(() => codecProbe.scripts.length), 3);
    report.checks.push('slow startup keeps UI usable and enables the unchanged saved batch format and preview when ready');
    await slowContext.close();
    assert.deepEqual(report.externalRequests, []); assert.deepEqual(report.errors, []); report.passed = true;
  } finally { if (browser) await browser.close(); fs.unlinkSync(file); }
  if (process.env.IMAGE_TEST_LOGS) {
    const out = artifacts.folder(process.env.IMAGE_TEST_LOGS); fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, artifacts.runId + '-modular-release.json'), JSON.stringify(report, null, 2) + '\n');
  }
  console.log(JSON.stringify(report, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
