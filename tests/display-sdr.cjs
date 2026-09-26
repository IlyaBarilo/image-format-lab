const assert = require('node:assert/strict');

(async () => {
  const { createPixelBuffer } = await import('../src/core/pixel-buffer.mjs');
  const { createSdrMapper, createFloat16SdrMapper, normalizeDisplay, DEFAULT_DISPLAY } = await import('../src/core/display-sdr.mjs');
  const source = new Uint16Array([
    0, 16384, 32768, 65535,
    32768, 32769, 65535, 0,
    32769, 32768, 16384, 32768,
    65535, 0, 32768, 65535
  ]);
  const original = source.slice();
  const pixels = createPixelBuffer({ width: 2, height: 2, data: source, sampleType: 'uint16' });
  const output = new Uint8ClampedArray(source.length);
  createSdrMapper(pixels, output, { mode: 'sdr', black: 0, white: 100, exposure: 0, dither: false })(0, 2);
  assert.deepEqual([...output], [0, 64, 128, 255, 128, 128, 255, 0, 128, 128, 64, 128, 255, 0, 128, 255]);
  assert.deepEqual(source, original, 'Screen mapping must not alter exact source samples');

  const chunked = new Uint8ClampedArray(source.length);
  const map = createSdrMapper(pixels, chunked, { ...DEFAULT_DISPLAY, mode: 'sdr', dither: true });
  map(0, 1); map(1, 2);
  const whole = new Uint8ClampedArray(source.length);
  createSdrMapper(pixels, whole, { ...DEFAULT_DISPLAY, mode: 'sdr', dither: true })(0, 2);
  assert.deepEqual(chunked, whole, 'Spatial dither is independent of chunk boundaries');
  const row = new Uint8ClampedArray(2 * 4);
  createSdrMapper(pixels, row, { ...DEFAULT_DISPLAY, mode: 'sdr', dither: true })(1, 2);
  assert.deepEqual(row, whole.subarray(8), 'A reusable row buffer preserves absolute pixel positions');
  assert.equal(chunked[3], 255);
  assert.equal(chunked[7], 0);

  const adjusted = new Uint8ClampedArray(source.length);
  createSdrMapper(pixels, adjusted, { mode: 'sdr', black: 25, white: 75, exposure: 1, dither: false })(0, 2);
  assert.equal(adjusted[0], 0);
  assert.equal(adjusted[1], 128);
  assert.equal(adjusted[2], 255);
  assert.equal(adjusted[7], 0, 'Alpha is never exposed or contrast-stretched');
  assert.deepEqual(source, original);

  const fine = createPixelBuffer({ width: 2, height: 1, sampleType: 'uint16',
    data: new Uint16Array([32768, 0, 0, 65535, 32799, 0, 0, 65535]) });
  const fine8 = new Uint8ClampedArray(8), fine16 = new Float16Array(8);
  createSdrMapper(fine, fine8, { ...DEFAULT_DISPLAY, dither: false })(0, 1);
  createFloat16SdrMapper(fine, fine16, DEFAULT_DISPLAY)(0, 1);
  assert.equal(fine8[0], fine8[4], 'Nearby 16-bit levels collapse in RGBA8');
  assert.notEqual(fine16[0], fine16[4], 'float16 Canvas data retains a difference absent from RGBA8');
  assert.equal(fine16[3], 1);
  assert.deepEqual(fine.data, new Uint16Array([32768, 0, 0, 65535, 32799, 0, 0, 65535]));
  assert.throws(() => createFloat16SdrMapper(fine, fine8), RangeError);

  assert.deepEqual(normalizeDisplay({ mode: 'sdr', black: 60, white: 50, exposure: 9, dither: 'yes' }), { ...DEFAULT_DISPLAY, mode: 'sdr' });
  assert.throws(() => createSdrMapper(pixels, new Uint8ClampedArray(1)), RangeError);
  assert.throws(() => createSdrMapper(pixels, output)(0, 3), RangeError);
  const { createDisplay, probeFloat16Canvas } = await import('../src/ui/display.mjs');
  const floatContext = {
    getContextAttributes: () => ({ colorType: 'float16' }),
    createImageData: (width, height) => ({ pixelFormat: 'rgba-float16', data: new Float16Array(width * height * 4) }),
    putImageData() {},
    getImageData: () => ({ pixelFormat: 'rgba-float16', data: new Float16Array(4) })
  };
  assert.equal(probeFloat16Canvas({ createElement: () => ({ getContext: () => floatContext }) }), true);
  assert.equal(probeFloat16Canvas({ createElement: () => ({ getContext: () => ({ ...floatContext, getContextAttributes: () => ({ colorType: 'unorm8' }) }) }) }), false);
  assert.equal(probeFloat16Canvas({ createElement: () => { throw Error('unsupported'); } }), false);
  let painted = null, redraws = 0;
  const canvas = { width: 0, height: 0, getContext: () => ({
    createImageData: (width, height) => ({ data: new Uint8ClampedArray(width * height * 4) }),
    putImageData: image => { painted = image.data.slice(); }
  }) };
  global.document = { createElement: () => canvas, addEventListener() {} };
  const control = value => ({ value, checked: true, textContent: '', disabled: false,
    addEventListener() {}, setAttribute() {}, classList: { toggle() {} } });
  const els = Object.fromEntries(['displayMode','displayBlack','displayWhite','displayExposure','displayDither',
    'displayBlackValue','displayWhiteValue','displayExposureValue','displayMenuToggle','displayOutputNote'].map(id => [id, control('0')]));
  els.displayMenu = { hidden: true, contains: () => false };
  const app = { display: { ...DEFAULT_DISPLAY, mode: 'sdr', dither: false }, source: { pixelBuffer: pixels, width: 2, height: 2 }, variants: [] };
  const ui = createDisplay({ app, els }, { redrawPreviews: () => { redraws++; } });
  const fallback = { original: true };
  assert.equal(ui.displayImage(pixels, fallback), fallback, 'Use the existing preview while mapping runs');
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(ui.displayImage(pixels, fallback), canvas);
  assert.deepEqual(painted, output);
  assert.equal(redraws, 1);
  ui.clearDisplayCache();
  assert.equal(ui.displayImage(pixels, fallback), fallback, 'Changing settings invalidates the screen-only cache');
  app.display.mode = 'standard';
  ui.clearDisplayCache();
  assert.equal(ui.displayImage(pixels, fallback), fallback, 'Ordinary mode retains its original preview');
  assert.deepEqual(source, original);
  let floatPainted = null;
  const floatCanvas = { getContext: () => ({ ...floatContext, putImageData: image => { floatPainted = image.data.slice(); } }) };
  global.document = { createElement: () => floatCanvas };
  app.source = { pixelBuffer: fine, width: 2, height: 1 };
  app.variants = [{ pixelBuffer: fine, ctx: floatContext }];
  app.display.mode = 'sdr';
  app.float16Canvas = true;
  app.float16CanvasReady = true;
  const floatUI = createDisplay({ app, els }, { redrawPreviews: () => { redraws++; } });
  assert.equal(floatUI.displayImage(fine, fallback, floatContext), fallback);
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(floatUI.displayImage(fine, fallback, floatContext), floatCanvas);
  assert.deepEqual(floatPainted, fine16);
  floatUI.syncDisplayControls();
  assert.match(els.displayOutputNote.textContent, /Canvas float16/);
  assert.equal(els.displayDither.disabled, true);
  assert.deepEqual(fine.data, new Uint16Array([32768, 0, 0, 65535, 32799, 0, 0, 65535]));
  const fallbackCanvas = { getContext: (_type, options) => options?.colorType === 'float16'
    ? { ...floatContext, getContextAttributes: () => ({ colorType: 'unorm8' }) }
    : { createImageData: (width, height) => ({ data: new Uint8ClampedArray(width * height * 4) }), putImageData() {} } };
  global.document = { createElement: () => fallbackCanvas };
  const fallbackUI = createDisplay({ app, els }, { redrawPreviews: () => { redraws++; } });
  assert.equal(fallbackUI.displayImage(fine, fallback, floatContext), fallback);
  fallbackUI.syncDisplayControls();
  assert.match(els.displayOutputNote.textContent, /Canvas RGBA8/);
  assert.equal(els.displayDither.disabled, false);
  assert.equal(fallbackUI.displayImage(fine, fallback, floatContext), fallback);
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(fallbackUI.displayImage(fine, fallback, floatContext), fallbackCanvas);
  const contextRequests = [];
  const viewCanvas = { getContext: (_type, options) => { contextRequests.push(options); return floatContext; } };
  global.document = { querySelectorAll: () => Array.from({ length: 4 }, () => ({ querySelector: () => viewCanvas })) };
  const { createBootstrap } = await import('../src/ui/bootstrap.mjs');
  const bootstrapApp = { float16Canvas: true, wipeFloat16: true, layout: 2 };
  const noop = new Proxy({}, { get: () => () => {} });
  createBootstrap({ app: bootstrapApp, els: {} }, noop).init();
  assert.equal(contextRequests.length, 4);
  assert.ok(contextRequests.every(options => options.colorType === 'float16' && options.colorSpace === 'srgb'));
  assert.equal(bootstrapApp.float16CanvasReady, true);
  const { createCanvas } = await import('../src/ui/canvas.mjs');
  createCanvas({ app: bootstrapApp, els: { wipeCanvas: viewCanvas } }, {});
  assert.equal(contextRequests.at(-1).colorType, 'float16', 'Wipe view requests the same context precision');
  let cellNumber = 0;
  global.document = { querySelectorAll: () => Array.from({ length: 4 }, () => ({ querySelector: () => ({
    getContext: () => ++cellNumber === 1 ? { getContextAttributes: () => ({ colorType: 'unorm8' }) } : floatContext
  }) })) };
  const partialApp = { float16Canvas: true, wipeFloat16: true, layout: 2 };
  createBootstrap({ app: partialApp, els: {} }, noop).init();
  assert.equal(partialApp.float16CanvasReady, false, 'One downgraded cell keeps every view on the common RGBA8 path');
  delete global.document;
  console.log('PASS exact source, RGBA8/float16 paths, capability probe, fallback and invalid settings');
})().catch(error => { console.error(error); process.exitCode = 1; });
