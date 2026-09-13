const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');
const panoramaFixture = require('./support/panorama-fixture.cjs');

let failures = 0;
async function check(name, run) {
  try { await run(); console.log(`PASS ${name}`); }
  catch (error) { failures++; console.error(`FAIL ${name}: ${error.stack}`); }
}
async function sample(page) {
  await page.locator('#sampleImage').click();
  await page.waitForFunction(() => app.source && !app.sourceLoading && app.variants.slice(0, 2).every(isVariantReady));
}
(async () => {
  const browser = await chromium.launch({ headless: true,
    ...(process.env.IMAGE_TEST_BROWSER ? { executablePath: process.env.IMAGE_TEST_BROWSER } : {}) });
  console.log(`Chromium ${browser.version()}`);
  try {
    const pages = ['image-format-lab.html'];
    if (fs.existsSync(path.join(__dirname, '..', 'image-format-converter.html'))) pages.push('image-format-converter.html');
    else console.log('SKIP historical converter: absent from the public project; local/ is not used');
    for (const file of pages) {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: false });
      const pageErrors = [];
      page.on('pageerror', error => pageErrors.push(error.message));
      await page.goto(pathToFileURL(require('./support/viewer-path.cjs')(file)).href);
      await check(`${file}: all built-in exports`, async () => {
        await sample(page);
        const result = await page.evaluate(async () => {
          const out = [];
          for (const format of ['jpeg', 'png', 'webp', 'gif', 'bmp24', 'bmp32']) {
            if (format === 'webp' && !app.support.get('image/webp')) continue;
            const v = app.variants[1]; v.config.format = format;
            await renderVariant(v);
            out.push({ format, ready: isVariantReady(v), error: v.error, type: v.blob?.type,
              expected: FORMAT_DEFS[format].mime, width: v.imageData?.width });
          }
          return out;
        });
        for (const r of result) {
          assert.equal(r.ready, true, `${r.format}: ${r.error}`);
          assert.equal(r.type, r.expected); assert.equal(r.width, 960);
        }
      });
      await check(`${file}: dirty output cannot download`, async () => {
        await page.locator('#autoApply').uncheck();
        const result = await page.evaluate(async () => {
          const v = app.variants[1]; v.config.format = 'jpeg'; await renderVariant(v);
          v.config.format = 'png'; markDirty(v);
          let clicks = 0;
          const original = HTMLAnchorElement.prototype.click;
          HTMLAnchorElement.prototype.click = () => { clicks++; };
          try { downloadVariant(v); } finally { HTMLAnchorElement.prototype.click = original; }
          return { clicks, disabled: v.controls.download.disabled, dirty: v.dirty };
        });
        assert.deepEqual(result, { clicks: 0, disabled: true, dirty: true });
      });
      await check(`${file}: settings invalidate an in-flight encode`, async () => {
        const result = await page.evaluate(async () => {
          const v = app.variants[1]; const real = encodeFromSource;
          let release, started;
          const waiting = new Promise(resolve => { started = resolve; });
          encodeFromSource = async (...args) => {
            const encoded = await real(...args); started();
            await new Promise(resolve => { release = resolve; }); return encoded;
          };
          try {
            v.config.format = 'jpeg'; const pending = renderVariant(v); await waiting;
            v.config.format = 'png'; markDirty(v); release(); await pending;
            return { dirty: v.dirty, blob: Boolean(v.blob), ready: isVariantReady(v) };
          } finally { encodeFromSource = real; }
        });
        assert.deepEqual(result, { dirty: true, blob: false, ready: false });
      });
      await check(`${file}: corrupt files cannot use the fallback preview`, async () => {
        const rejected = await page.evaluate(async () => {
          try { await decodeVariantForPreview(new Blob(['broken'], { type: 'image/bmp' }), app.source.imageData); return false; }
          catch { return true; }
        });
        assert.equal(rejected, true);
      });
      await check(`${file}: late source completion/failure cannot replace the selected file`, async () => {
        await page.reload();
        const result = await page.evaluate(async (converter) => {
          async function make(name, width) {
            const c = document.createElement('canvas'); c.width = width; c.height = 4;
            const blob = await new Promise(resolve => c.toBlob(resolve));
            return new File([blob], name, { type: 'image/png' });
          }
          const a = await make('A.png', 8), b = await make('B.png', 16);
          const real = decodeImageBlobOrOptional;
          let release;
          decodeImageBlobOrOptional = async f => {
            if (f.name === 'A.png') await new Promise(resolve => { release = resolve; });
            return real(f);
          };
          if (converter) app.files = [a, b].map((file, index) => ({ id: String(index), file, name: file.name, status: 'ready' }));
          const first = converter ? selectFile('0') : loadFile(a);
          await (converter ? selectFile('1') : loadFile(b));
          release(); await first;
          const completedName = app.source.name;
          // Repeat with a failing old request, to ensure its error cannot clear B.
          decodeImageBlobOrOptional = async f => {
            if (f.name === 'A.png') { await new Promise(resolve => { release = resolve; }); throw new Error('old failure'); }
            return real(f);
          };
          const failing = converter ? selectFile('0') : loadFile(a);
          await (converter ? selectFile('1') : loadFile(b));
          release(); await failing;
          return { completedName, name: app.source.name, width: app.source.width,
            selected: converter ? app.selectedFileId : null,
            rowWidth: converter ? app.files[1].width : null };
        }, file.startsWith('image-format-converter'));
        assert.equal(result.completedName, 'B.png'); assert.equal(result.name, 'B.png'); assert.equal(result.width, 16);
        if (file.startsWith('image-format-converter')) { assert.equal(result.selected, '1'); assert.equal(result.rowWidth, 16); }
      });
      await check(`${file}: PSNR and alpha have explicit, separate meanings`, async () => {
        const result = await page.evaluate(() => ({
          visible: computePsnr(new Uint8ClampedArray([0,0,0,0]), new Uint8ClampedArray([255,255,255,255])) === Infinity,
          alpha: computeAlphaError(new Uint8ClampedArray([0,0,0,0]), new Uint8ClampedArray([255,255,255,255])),
          unequalSize: computePsnr(new Uint8ClampedArray(4), new Uint8ClampedArray(8)),
        }));
        assert.deepEqual(result, { visible: true, alpha: 100, unequalSize: null });
      });
      await check(`${file}: retry, timeout and corrupt render recovery`, async () => {
        await page.reload(); await sample(page);
        if (file === 'image-format-lab.html') await page.evaluate(()=>loadAdditionalCodecs());
        const result = await page.evaluate(async () => {
          let requests = 0, offline = true;
          const realUpng = app.codecs.upng, realGlobalUpng = window.UPNG;
          delete app.codecs.upng;
          const realScript = loadScript;
          loadScript = async () => { requests++; if (offline) throw new Error('offline'); window.UPNG = { test: true }; return window; };
          let retried;
          try {
            try { await loadOptionalCodec('upng'); } catch {}
            offline = false;
            retried = (await loadOptionalCodec('upng')).test;
          } finally { loadScript = realScript; if (realUpng) app.codecs.upng = realUpng; else delete app.codecs.upng; window.UPNG = realGlobalUpng; }
          let timeout = false;
          try { await withTimeout(new Promise(() => {}), 10); } catch { timeout = true; }
          const v = app.variants[1], realEncode = encodeFromSource;
          encodeFromSource = async (...args) => ({ ...await realEncode(...args), blob: new Blob(['invalid'], { type: 'image/bmp' }) });
          try { await renderVariant(v); } finally { encodeFromSource = realEncode; }
          const invalid = Boolean(v.error) && !v.blob && v.controls.download.disabled;
          await renderVariant(v);
          return { requests, retried, timeout, invalid, recovered: isVariantReady(v) };
        });
        assert.deepEqual(result, { requests: 3, retried: true, timeout: true, invalid: true, recovered: true });
      });
      await check(`${file}: JPEG GPano survives, scales and can be removed`, async () => {
        await page.reload();
        // Reload now restores saved comparison preferences from earlier cases.
        // Establish this scenario's format and metadata policy explicitly.
        await page.locator('#autoApply').check();
        await page.locator('#metadataPolicy').selectOption('panorama');
        await page.locator('.cell .format-select').nth(1).selectOption('jpeg');
        await page.locator('#fileInput').setInputFiles(await panoramaFixture(page));
        await page.waitForFunction(() => app.source && !app.sourceLoading && isVariantReady(app.variants[1]));
        const result = await page.evaluate(async (converter) => {
          const v = app.variants[1];
          const original = app.source.panorama;
          const read = async blob => parseJpegPanorama(new Uint8Array(await blob.arrayBuffer()));
          const preserved = await read(v.blob);
          v.config.format = 'jpeg';
          if (converter) v.config.resizeHeight = '160';
          await renderVariant(v);
          const scaled = await read(v.blob);
          const decoded = await decodeImageBlob(v.blob);
          const size = [decoded.width, decoded.height]; if (decoded.close) decoded.close();
          els.metadataPolicy.value = 'none';
          els.metadataPolicy.dispatchEvent(new Event('change'));
          const disabledOnPolicyChange = v.controls.download.disabled;
          await renderVariant(v);
          const removed = await read(v.blob);
          const noExif = !new TextDecoder('latin1').decode(await v.blob.arrayBuffer()).includes('Exif\0');
          return { original, preserved: Boolean(preserved), scaled, size, removed, noExif, disabledOnPolicyChange };
        }, file.startsWith('image-format-converter'));
        assert.equal(result.original.CroppedAreaImageWidthPixels, '1280');
        assert.equal(result.original.CroppedAreaImageHeightPixels, '640');
        assert.equal(result.preserved, true);
        assert.equal(Number(result.scaled.CroppedAreaImageWidthPixels), result.size[0]);
        assert.equal(Number(result.scaled.CroppedAreaImageHeightPixels), result.size[1]);
        assert.equal(Number(result.scaled.FullPanoWidthPixels), result.size[0]);
        assert.equal(Number(result.scaled.FullPanoHeightPixels), result.size[1]);
        assert.deepEqual(result.size, file.startsWith('image-format-converter') ? [320, 160] : [1280, 640]);
        assert.equal(result.removed, null); assert.equal(result.noExif, true); assert.equal(result.disabledOnPolicyChange, true);
      });
      await check(`${file}: partial panorama and malformed metadata`, async () => {
        const result = await page.evaluate(async () => {
          const properties = { ProjectionType: 'equirectangular', CroppedAreaImageWidthPixels: '2300', CroppedAreaImageHeightPixels: '1042',
            FullPanoWidthPixels: '4000', FullPanoHeightPixels: '2000', CroppedAreaLeftPixels: '90', CroppedAreaTopPixels: '128', CaptureSoftware: 'A&B <test>' };
          const scaled = scaledPanorama(properties, 2300, 1042, 1150, 521);
          const c = document.createElement('canvas'); c.width = 8; c.height = 4;
          const jpeg = await new Promise(resolve => c.toBlob(resolve, 'image/jpeg'));
          const embedded = embedJpegPanorama(jpeg, scaled);
          const roundTrip = parseJpegPanorama(new Uint8Array(await embedded.arrayBuffer()));
          let malformed = false;
          try { scaledPanorama({ ...properties, FullPanoWidthPixels: 'bad' }, 2300, 1042, 1150, 521); } catch { malformed = true; }
          const source = { ...app.source, panorama: null, panoramaError: 'invalid XMP' };
          let refused = false;
          try { await encodeFromSource({ ...app.variants[1].config, format: 'jpeg', metadataPolicy: 'panorama' }, source); } catch { refused = true; }
          const stripped = await encodeFromSource({ ...app.variants[1].config, format: 'jpeg', metadataPolicy: 'none' }, source);
          return { roundTrip, malformed, refused, stripped: stripped.blob.type };
        });
        assert.equal(result.roundTrip.CroppedAreaLeftPixels, '45');
        assert.equal(result.roundTrip.CroppedAreaTopPixels, '64');
        assert.equal(result.roundTrip.FullPanoWidthPixels, '2000');
        assert.equal(result.roundTrip.FullPanoHeightPixels, '1000');
        assert.equal(result.roundTrip.CaptureSoftware, 'A&B <test>');
        assert.equal(result.malformed, true); assert.equal(result.refused, true); assert.equal(result.stripped, 'image/jpeg');
      });
      if (file.startsWith('image-format-converter')) {
        await check(`${file}: batch verifies output and retains its settings snapshot`, async () => {
          await page.reload();
          const result = await page.evaluate(async () => {
            async function make(name, width) {
              const c = document.createElement('canvas'); c.width = width; c.height = 4;
              return new File([await new Promise(resolve => c.toBlob(resolve))], name, { type: 'image/png' });
            }
            app.files = await Promise.all([8,16,24].map(async (width,index) => {
              const file = await make('batch-' + index + '.png',width);
              return { id: String(index), file, name: file.name, size: file.size, status: 'ready', isSample: false };
            }));
            await selectFile('0');
            app.variants[1].config.format = 'png';
            const realEncode = encodeFromSource, realDownload = downloadBlob;
            const downloads = [];
            encodeFromSource = async (config, source = app.source) => {
              const encoded = await realEncode(config, source);
              if (app.isConverting && source.name === 'batch-1.png') return { ...encoded, blob: new Blob(['broken'], { type: 'image/png' }) };
              return encoded;
            };
            downloadBlob = (blob, name) => { downloads.push({ name, type: blob.type }); app.variants[1].config.format = 'jpeg'; };
            try { await convertAllFiles(); } finally { encodeFromSource = realEncode; downloadBlob = realDownload; }
            return { downloads, statuses: app.files.map(f => f.status), selected: app.selectedFileId, converting: app.isConverting };
          });
          assert.deepEqual(result.downloads, [{ name: 'batch-0.png', type: 'image/png' }, { name: 'batch-2.png', type: 'image/png' }]);
          assert.deepEqual(result.statuses, ['done', 'error', 'done']);
          assert.equal(result.selected, '0'); assert.equal(result.converting, false);
        });
      }
      await check(`${file}: no JavaScript errors`, () => assert.deepEqual(pageErrors, []));
      await page.close();
    }
  } finally { await browser.close(); }
  process.exitCode = failures ? 1 : 0;
})().catch(error => { console.error(error); process.exitCode = 1; });
