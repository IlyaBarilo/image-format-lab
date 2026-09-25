const assert = require('node:assert/strict');
const path = require('node:path');
const { Worker: Thread } = require('node:worker_threads');
const { build, buildSync } = require('../scripts/node_modules/esbuild');

(async () => {
  const metrics = await import('../src/core/metrics.mjs');
  const { createPixelBuffer, clonePixelBuffer } = await import('../src/core/pixel-buffer.mjs');
  const { computePixelMetrics: measure } = metrics;
  const wrap = (data, extra = {}) => createPixelBuffer({ width: data.length / 4, height: 1, data, colorSpace: 'srgb',
    sampleType: data instanceof Float32Array ? 'float32' : data instanceof Uint16Array ? 'uint16' : 'uint8', ...extra });
  const close = (actual, expected, tolerance = 1e-12) => assert.ok(Math.abs(actual - expected) <= tolerance,
    `Expected ${actual} to be within ${tolerance} of ${expected}`);
  let random = 739391;
  const next = () => (random = (Math.imul(random, 1664525) + 1013904223) >>> 0) >>> 24;
  for (let n = 1; n <= 80; n++) {
    const a = wrap(Uint8ClampedArray.from({ length: n * 4 }, next));
    const b = wrap(Uint8ClampedArray.from({ length: n * 4 }, next));
    assert.deepEqual(measure(a, b), { psnr: metrics.computePsnr(a.data, b.data), alpha: metrics.computeAlphaError(a.data, b.data) },
      'RGBA8 arithmetic must remain exactly equal, including fractional alpha');
  }
  const base = wrap(new Uint8Array([0, 127, 255, 128, 90, 80, 70, 0, 17, 18, 19, 255]));
  const expanded = wrap(Uint16Array.from(base.data, value => value * 257));
  assert.deepEqual(measure(base, expanded), { psnr: Infinity, alpha: 0 });
  assert.deepEqual(measure(expanded, base), { psnr: Infinity, alpha: 0 });
  for (const bitDepth of [8, 10, 12, 16]) {
    const peak = 2 ** bitDepth - 1;
    const a = wrap(new Uint16Array([100, 90, 80, peak]), { bitDepth });
    const b = clonePixelBuffer(a); b.data[0]++;
    close(measure(a, b).psnr, 10 * Math.log10(3 * peak * peak));
    assert.equal(measure(a, b).alpha, 0);
    const transparent = wrap(new Uint16Array([peak, peak, peak, 0]), { bitDepth });
    const faint = clonePixelBuffer(transparent); faint.data[3] = 1;
    close(measure(transparent, faint).alpha, 100 / peak);
    assert.equal(measure(transparent, faint).psnr, Infinity, 'White stays white on the white matte');
  }
  const sameLengthOtherShape = createPixelBuffer({ ...base, width: 1, height: 3 });
  assert.throws(() => measure(base, sameLengthOtherShape), /размеры/);
  assert.throws(() => measure(base, { ...base, colorSpace: 'display-p3' }), /пространства/);
  assert.throws(() => measure(base, { ...base, colorSpace: 'display-p3' }, { allowUnknownColorSpace: true }), /пространства/);
  const unknown = { ...base, colorSpace: 'unknown' };
  assert.throws(() => measure(unknown, unknown), /пространства/);
  assert.deepEqual(measure(unknown, unknown, { allowUnknownColorSpace: true }), { psnr: Infinity, alpha: 0 });
  assert.throws(() => measure(wrap(new Uint16Array([1024, 0, 0, 1023]), { bitDepth: 10 }),
    wrap(new Uint16Array([0, 0, 0, 1023]), { bitDepth: 10 })), /Отсчёт/);
  assert.throws(() => measure(wrap(new Uint8Array([0, 0, 0, 128]), { bitDepth: 7 }),
    wrap(new Uint8Array([0, 0, 0, 0]), { bitDepth: 7 })), /Отсчёт/);

  const floats = wrap(new Float32Array([0, 0, 0, 1]));
  const floatResult = wrap(new Float32Array([1, 0, 0, 1]));
  assert.throws(() => measure(floats, floats), /floatPeak/);
  close(measure(floats, floatResult, { floatPeak: 2 }).psnr, 10 * Math.log10(12));
  assert.deepEqual(measure(wrap(new Uint8Array([255, 0, 0, 255])), wrap(new Float32Array([2, 0, 0, 1])),
    { floatPeak: 2 }), { psnr: Infinity, alpha: 0 });
  close(measure(wrap(new Float32Array([-1, 0, 0, 1])), floatResult, { floatPeak: 1 }).psnr,
    10 * Math.log10(3 / 4));
  const floatAlpha = measure(wrap(new Float32Array([2, 2, 2, 0.25])), wrap(new Float32Array([2, 2, 2, 0.75])), { floatPeak: 2 });
  assert.deepEqual(floatAlpha, { psnr: Infinity, alpha: 50 }, 'Float alpha always uses 0..1, independently of RGB peak');
  for (const [straight, premultiplied] of [
    [wrap(new Uint8Array([255, 0, 0, 128])), wrap(new Uint8Array([128, 0, 0, 128]), { alphaMode: 'premultiplied' })],
    [wrap(new Float32Array([2, 1, 0, 0.5])), wrap(new Float32Array([1, 0.5, 0, 0.5]), { alphaMode: 'premultiplied' })]
  ]) assert.deepEqual(measure(straight, premultiplied, straight.sampleType === 'float32' ? { floatPeak: 2 } : {}), { psnr: Infinity, alpha: 0 });
  for (const floatPeak of [0, -1, NaN, Infinity, '1', 1e-300, 1e300]) assert.throws(() => measure(floats, floats, { floatPeak }));
  for (const bad of [NaN, Infinity, -Infinity]) {
    const invalid = wrap(new Float32Array([bad, 0, 0, 0]));
    assert.throws(() => measure(invalid, floats, { floatPeak: 1 }), /Отсчёт/, 'Invalid RGB is rejected even under zero alpha');
  }
  for (const alpha of [-0.1, 1.1]) assert.throws(() => measure(wrap(new Float32Array([0, 0, 0, alpha])), floats, { floatPeak: 1 }), /Альфа/);
  for (const options of [null, [], 5, { floatPeak: 1 }, { allowUnknownColorSpace: 'true' }, { typo: 1 }]) {
    assert.throws(() => measure(base, base, options));
  }
  const subnormal = 2 ** -149, largest = (2 - 2 ** -23) * 2 ** 127;
  assert.ok(Number.isFinite(measure(floats, wrap(new Float32Array([subnormal, 0, 0, 1])), { floatPeak: largest }).psnr));
  assert.ok(Number.isFinite(measure(floats, wrap(new Float32Array([largest, 0, 0, 1])), { floatPeak: subnormal }).psnr));
  console.log('PASS independent PSNR/alpha cases, all RGBA8 results, integer low bits, mixed depths, float scale and validation');

  // Exercise the actual service and bundled Worker in Node threads, not a browser.
  const root = path.resolve(__dirname, '..');
  const workerSource = buildSync({ absWorkingDir: root, entryPoints: ['src/workers/compute.worker.mjs'],
    bundle: true, write: false, format: 'iife', logLevel: 'silent' }).outputFiles[0].text;
  const serviceSource = (await build({ absWorkingDir: root, entryPoints: ['src/services/compute.mjs'], bundle: true,
    write: false, format: 'cjs', logLevel: 'silent', plugins: [{ name: 'test-worker-source', setup(builder) {
      builder.onResolve({ filter: /^viewer:compute-worker$/ }, () => ({ path: 'worker', namespace: 'test' }));
      builder.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ contents: workerSource, loader: 'text' }));
    } }] })).outputFiles[0].text;
  const serviceModule = { exports: {} };
  new Function('module', 'exports', serviceSource)(serviceModule, serviceModule.exports);
  const blobs = new Map(), threads = [], messages = [];
  const nativeCreate = URL.createObjectURL, nativeRevoke = URL.revokeObjectURL, nativeWorker = globalThis.Worker;
  let sequence = 0;
  URL.createObjectURL = blob => { const url = `blob:test-${++sequence}`; blobs.set(url, blob); return url; };
  URL.revokeObjectURL = url => blobs.delete(url);
  class WorkerAdapter {
    constructor(url) {
      assert.ok(blobs.has(url));
      this.thread = new Thread(`
        const { parentPort, workerData } = require('node:worker_threads');
        (async () => {
          const self = { postMessage: data => parentPort.postMessage(data) };
          new Function('self', await workerData.text())(self);
          parentPort.on('message', data => self.onmessage({ data }));
        })().catch(error => { throw error; });
      `, { eval: true, workerData: blobs.get(url) });
      threads.push(this.thread);
      this.thread.on('message', data => this.onmessage?.({ data }));
      this.thread.on('error', error => this.onerror?.(error));
    }
    postMessage(message, ...transfer) {
      assert.equal(transfer.length, 0, 'Do not detach the borrowed source buffer');
      messages.push(message);
      this.thread.postMessage(message);
    }
    terminate() { return this.thread.terminate(); }
  }
  const app = {};
  const deps = { ...metrics };
  const service = serviceModule.exports.createCompute({ app }, deps);
  Object.assign(deps, service);
  globalThis.Worker = WorkerAdapter;
  try {
    assert.deepEqual(await service.measurePixels(base, expanded), measure(base, expanded));
    assert.equal(threads.length, 0, 'Small arrays stay in the main thread');
    for (const sampleType of ['uint8', 'uint16', 'float32']) {
      const Type = { uint8: Uint8ClampedArray, uint16: Uint16Array, float32: Float32Array }[sampleType];
      const pixels = 1000000 / Type.BYTES_PER_ELEMENT;
      const peak = sampleType === 'uint8' ? 255 : sampleType === 'uint16' ? 65535 : 1;
      const a = wrap(new Type(pixels * 4).fill(peak));
      const b = clonePixelBuffer(a); b.data[b.data.length - 4] = 0;
      const options = sampleType === 'float32' ? { floatPeak: 1 } : {};
      const originalBytes = a.data.byteLength;
      const expected = measure(a, b, options);
      assert.deepEqual(await service.measurePixels(a, b, options), expected);
      assert.equal(messages.at(-1).payload.a.sampleType, sampleType);
      assert.equal(messages.at(-1).payload.a.bitDepth, a.bitDepth);
      assert.equal(a.data.byteLength, originalBytes);
      assert.equal(b.data.byteLength, originalBytes);
      assert.equal(a.data[a.data.length - 4], peak);
      assert.equal(b.data[b.data.length - 4], 0);
      delete globalThis.Worker;
      assert.deepEqual(await service.measurePixels(a, b, options), expected, 'No-Worker fallback uses identical metrics');
      globalThis.Worker = WorkerAdapter;
    }
    const beforeBad = messages.length;
    await assert.rejects(service.measurePixels(base, { ...base, colorSpace: 'display-p3' }), /пространства/);
    assert.equal(messages.length, beforeBad, 'Validate metadata before posting to Worker');
    const workerCases = [
      { a: base, b: expanded },
      { a: floats, b: floatResult, options: { floatPeak: 2 } },
      { a: wrap(new Uint16Array([1, 2, 3, 1023]), { bitDepth: 10 }), b: wrap(new Uint16Array([2, 2, 3, 1023]), { bitDepth: 10 }) }
    ];
    assert.deepEqual(await Promise.all(workerCases.map(payload => service.workerCompute('metrics', payload))),
      workerCases.map(payload => measure(payload.a, payload.b, payload.options)));
    await assert.rejects(service.workerCompute('metrics', { a: floats, b: floats }), /floatPeak/);
    assert.equal(app.computeWorker, null, 'Failed worker is discarded');
    await assert.rejects(service.workerCompute('metrics', {
      a: wrap(new Float32Array([NaN, 0, 0, 0])), b: floats, options: { floatPeak: 1 }
    }), /Отсчёт/);
    await assert.rejects(service.workerCompute('metrics', { a: { ...base, width: 99 }, b: base }), /Длина/);
    assert.deepEqual(await service.workerCompute('metrics', { a: base, b: expanded }), { psnr: Infinity, alpha: 0 });
    const options = { floatPeak: 2 };
    const prepared = metrics.prepareMetricInputs(floats, floatResult, options);
    const pending = service.workerCompute('metrics', prepared);
    options.floatPeak = 4;
    assert.deepEqual(await pending, measure(floats, floatResult, { floatPeak: 2 }), 'Options are a snapshot');
    assert.equal(blobs.size, 0, 'Embedded Worker Blob URLs are released');
    console.log('PASS actual Worker and service: byte thresholds, metadata/options, queue, errors, fallback and source ownership');
  } finally {
    await Promise.all(threads.map(thread => thread.terminate()));
    URL.createObjectURL = nativeCreate; URL.revokeObjectURL = nativeRevoke;
    if (nativeWorker === undefined) delete globalThis.Worker; else globalThis.Worker = nativeWorker;
  }

  const { createBatchPreview } = await import('../src/ui/batch-preview.mjs');
  const source = { name: 'sample.png' }, config = { format: 'png' };
  const state = { source, sourceGeneration: 1, variants: [{ metricsEls: { psnr: { parentElement: { title: '' } } } }],
    batchPreview: { pending: true, busy: false, source, generation: 1 } };
  const element = () => ({ classList: { add() {} } });
  const els = { batchDialog: { open: true }, batchPreviewAfterInfo: element(), batchPreviewMetrics: element(), batchPreviewStatus: element() };
  let closed = 0, actualB = floatResult;
  const batchDeps = {
    readBatchDialogConfig: () => config, validateExportConfig() {}, drawBatchPreview() {}, formatBytes: String,
    encodeFromSource: async () => ({ width: 1, height: 1, sourcePixelBuffer: floats, blob: new Blob(['output']) }),
    decodeVariantForPreview: async () => ({ imageData: { width: 1, height: 1 }, pixelBuffer: actualB, bitmap: { close() { closed++; } } }),
    measurePixels: async (a, b, options) => {
      assert.equal(a, floats); assert.equal(b, actualB);
      assert.deepEqual(options, { allowUnknownColorSpace: true });
      return measure(a, b, { ...options, floatPeak: 2 });
    }
  };
  const batch = createBatchPreview({ app: state, els }, batchDeps);
  await batch.renderBatchPreview();
  assert.deepEqual(state.batchPreview.metrics, measure(floats, floatResult, { floatPeak: 2 }));
  state.batchPreview.bitmap.close(); state.batchPreview.bitmap = null;
  actualB = { ...floatResult, colorSpace: 'display-p3' };
  state.batchPreview.pending = true;
  await batch.renderBatchPreview();
  assert.match(els.batchPreviewStatus.textContent, /пространства/);
  assert.equal(closed, 2, 'Failed batch metrics release the decoded bitmap');
  console.log('PASS batch preview passes pixel descriptors and releases a rejected measurement');
})().catch(error => { console.error(error); process.exitCode = 1; });
