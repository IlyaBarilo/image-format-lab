const assert = require('node:assert/strict');

(async () => {
  const { createPixelBuffer } = await import('../src/core/pixel-buffer.mjs');
  const { createSdrMapper, normalizeDisplay, DEFAULT_DISPLAY } = await import('../src/core/display-sdr.mjs');
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

  assert.deepEqual(normalizeDisplay({ mode: 'sdr', black: 60, white: 50, exposure: 9, dither: 'yes' }), { ...DEFAULT_DISPLAY, mode: 'sdr' });
  assert.throws(() => createSdrMapper(pixels, new Uint8ClampedArray(1)), RangeError);
  assert.throws(() => createSdrMapper(pixels, output)(0, 3), RangeError);
  const { createDisplay } = await import('../src/ui/display.mjs');
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
  delete global.document;
  console.log('PASS exact 16-bit source, alpha, range/exposure, deterministic dither and invalid settings');
})().catch(error => { console.error(error); process.exitCode = 1; });
