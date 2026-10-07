// Node-only controller integration; codec startup and pixel conversion are controlled.
const assert = require('node:assert/strict');

(async () => {
  const [{ createState }, { createComparison }, { createSource }, { createFiles },
    { createControls }, { createBatchSettings }] = await Promise.all([
    import('../src/state.mjs'), import('../src/ui/comparison.mjs'), import('../src/ui/source.mjs'),
    import('../src/ui/files.mjs'), import('../src/ui/controls.mjs'), import('../src/ui/batch-settings.mjs')
  ]);
  const tick = () => new Promise(resolve => setImmediate(resolve));
  function fixture() {
    const app = createState(), errors = [], encoded = [];
    const variant = { index: 0, generation: 0, config: { format: 'jpeg', quality: 85 },
      cell: { classList: { contains: () => false } }, controls: { download: { disabled: true } } };
    app.variants = [variant];
    app.files = ['first.png', 'second.png'].map((name, i) => ({
      id: String(i + 1), name, file: new File(['input'], name, { type: 'image/png' }), status: 'idle'
    }));
    const pixels = { width: 1, height: 1, data: new Uint8ClampedArray([20, 40, 60, 255]), bitDepth: 8 };
    const els = { metadataPolicy: { value: 'none' }, emptyState: { style: {} } };
    const deps = {
      decodeSourceFile: async file => ({ file, name: file.name, size: file.size, width: 1, height: 1 }),
      encodeFromSource: async (config, source) => {
        encoded.push({ name: source.name, quality: config.quality });
        return { blob: new Blob(['result']), width: 1, height: 1, sourcePixelBuffer: pixels };
      },
      decodeVariantForPreview: async () => ({ imageData: pixels, pixelBuffer: pixels, bitmap: { close() {} } }),
      measurePixels: async () => ({ psnr: Infinity, alpha: 0 }),
      alphaLabel: () => 'alpha нет', formatBytes: String,
      updateMetrics: value => { value.controls.download.disabled = !deps.isVariantReady(value); },
      updateAnalysis() {}, updateFileList() {}, updateBatchUI() {}, clearBatchPreview() {},
      syncDisplayControls() {}, resetView() {}, drawAll() {},
      setEmptyState: () => { els.emptyState.style.display = 'grid'; },
      showStatus: (message, error) => { if (error) errors.push(message); }
    };
    const context = { app, els };
    Object.assign(deps, createComparison(context, deps), createSource(context, deps), createFiles(context, deps));
    deps.updateFileList = () => {};
    deps.isVariantReady = createControls(context, deps).isVariantReady;
    deps.formatUnavailableReason = createBatchSettings(context, deps).formatUnavailableReason;
    let resolve, reject;
    app.codecPromises.utif = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { app, variant, deps, errors, encoded,
      start: () => deps.selectFile('1'),
      complete: () => { app.codecs.utif = {}; delete app.codecPromises.utif; resolve(); },
      fail: () => { delete app.codecPromises.utif; reject(new Error('codec startup failed')); }
    };
  }
  async function check(name, run) {
    const f = fixture();
    try { await run(f); console.log('PASS ' + name); }
    finally { f.complete(); f.deps.disposeSource(); }
  }

  await check('early import waits for startup and publishes a downloadable result automatically', async f => {
    const pending = f.start(); await tick();
    assert.equal(f.app.files[0].status, 'loading');
    assert.equal(f.app.sourceLoading, true);
    assert.equal(f.variant.processing, true);
    assert.equal(f.variant.error, null);
    assert.equal(f.variant.controls.download.disabled, true);
    assert.deepEqual(f.encoded, []);
    f.complete(); await pending;
    assert.equal(f.app.files[0].status, 'ready');
    assert.equal(f.app.sourceLoading, false);
    assert.equal(f.deps.isVariantReady(f.variant), true);
    assert.equal(f.variant.controls.download.disabled, false);
    assert.equal(f.variant.resultSource, f.app.source);
    assert.deepEqual(f.encoded, [{ name: 'first.png', quality: 85 }]);
    assert.deepEqual(f.errors, []);
  });

  await check('switching away and back during startup encodes only the latest selection of the same row', async f => {
    const first = f.start(); await tick();
    const second = f.deps.selectFile('2'); await tick();
    const fresh = f.deps.selectFile('1'); await tick();
    const source = f.app.source;
    f.complete(); await Promise.all([first, second, fresh]);
    assert.equal(f.app.source, source);
    assert.equal(f.app.selectedFileId, '1');
    assert.equal(f.app.files[0].status, 'ready');
    assert.equal(f.variant.resultSource, source);
    assert.equal(f.deps.isVariantReady(f.variant), true);
    assert.deepEqual(f.encoded, [{ name: 'first.png', quality: 85 }]);
    assert.deepEqual(f.errors, []);
  });

  await check('clearing while startup is pending prevents late output and errors', async f => {
    const pending = f.start(); await tick();
    f.deps.clearFiles(); f.fail(); await pending;
    assert.equal(f.app.source, null);
    assert.equal(f.app.sourceLoading, false);
    assert.equal(f.app.files.length, 0);
    assert.equal(f.variant.processing, false);
    assert.equal(f.variant.blob, null);
    assert.equal(f.variant.url, null);
    assert.equal(f.variant.controls.download.disabled, true);
    assert.equal(f.variant.error, null);
    assert.deepEqual(f.encoded, []);
    assert.deepEqual(f.errors, []);
  });

  await check('changed parameters supersede a result waiting for its codec', async f => {
    const pending = f.start(); await tick();
    f.variant.config.quality = 37;
    const fresh = f.deps.renderVariant(f.variant);
    f.complete(); await Promise.all([pending, fresh]);
    assert.deepEqual(f.encoded, [{ name: 'first.png', quality: 37 }]);
    assert.equal(f.variant.resultConfig.quality, 37);
    assert.equal(f.deps.isVariantReady(f.variant), true);
    assert.deepEqual(f.errors, []);
  });

  await check('startup failure stays visible and a successful retry can produce a result', async f => {
    const pending = f.start(); await tick(); f.fail(); await pending;
    assert.match(f.variant.error, /codec startup failed/);
    assert.equal(f.app.source.name, 'first.png');
    assert.equal(f.app.sourceLoading, false);
    assert.equal(f.variant.processing, false);
    assert.equal(f.variant.blob, null);
    assert.equal(f.variant.controls.download.disabled, true);
    assert.deepEqual(f.encoded, []);
    assert.equal(f.errors.length, 1);
    f.complete(); await f.deps.renderVariant(f.variant);
    assert.equal(f.variant.error, null);
    assert.equal(f.deps.isVariantReady(f.variant), true);
    assert.deepEqual(f.encoded, [{ name: 'first.png', quality: 85 }]);
  });

  await check('an unavailable codec with no running attempt remains an explicit error', async f => {
    delete f.app.codecPromises.utif;
    await f.start();
    assert.match(f.variant.error, /кодек пока не готов/);
    assert.equal(f.variant.processing, false);
    assert.equal(f.variant.controls.download.disabled, true);
    assert.deepEqual(f.encoded, []);
  });

  await check('a native format does not wait for an unrelated codec', async f => {
    f.variant.config.format = 'png';
    await f.start();
    assert.equal(f.deps.isVariantReady(f.variant), true);
    assert.ok(f.app.codecPromises.utif);
    assert.deepEqual(f.encoded, [{ name: 'first.png', quality: 85 }]);
    assert.deepEqual(f.errors, []);
  });
})().catch(error => { console.error(error); process.exitCode = 1; });
