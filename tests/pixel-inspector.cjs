// Native samples and real UI/canvas controllers on a DOM model; no browser.
const assert = require('node:assert/strict');

(async () => {
  const { createPixelBuffer } = await import('../src/core/pixel-buffer.mjs');
  const { samplePixel, comparePixelSamples, pixelAtClientPoint, pixelCenterInCanvas } = await import('../src/core/pixel-inspector.mjs');
  const raster = (values, bits = 16, extra = {}) => createPixelBuffer({ width: values.length / 4, height: 1,
    sampleType: bits === 32 ? 'float32' : bits > 8 ? 'uint16' : 'uint8', bitDepth: bits,
    data: new (bits === 32 ? Float32Array : bits > 8 ? Uint16Array : Uint8Array)(values), colorSpace: 'srgb', ...extra });
  const reference = raster([256, 257, 65535, 0, 0, 9, 65534, 65535]);
  const original = reference.data.slice();
  const a = samplePixel(reference, 0, 0), b = samplePixel(raster([257, 256, 65535, 1, 0, 0, 0, 0]), 0, 0);
  assert.deepEqual(a.rgba, [256, 257, 65535, 0], 'RGB below zero alpha remains exact');
  assert.deepEqual(samplePixel(reference, 1, 0).rgba, [0, 9, 65534, 65535]);
  assert.deepEqual(comparePixelSamples(a, b).values, [1, -1, 0, 1]);
  assert.equal(comparePixelSamples(a, b).unit, 'levels');
  a.rgba[0] = 123; assert.deepEqual(reference.data, original); a.rgba[0] = 256;
  const eight = samplePixel(raster([1, 1, 255, 0, 0, 0, 0, 0], 8), 0, 0);
  const mixed = comparePixelSamples(a, eight);
  assert.equal(mixed.unit, 'normalized'); assert.ok(Math.abs(mixed.values[0] - 1 / 65535) < 1e-18);
  assert.deepEqual(mixed.values.slice(1), [0, 0, 0]);
  assert.equal(comparePixelSamples(a, { ...b, colorSpace: 'display-p3' }).values, null);
  assert.match(comparePixelSamples(a, { ...b, colorSpace: 'unknown' }).note, /неизвестно/);
  assert.equal(comparePixelSamples(a, { ...b, width: 3 }).values, null);
  assert.equal(comparePixelSamples(a, { ...b, x: 1 }).values, null);
  assert.equal(comparePixelSamples(a, { ...b, alphaMode: 'premultiplied' }).values, null);
  const float = samplePixel(raster([-2, 4, 1e30, 0], 32), 0, 0);
  assert.equal(float.rgba[0], -2); assert.equal(float.peak, null);
  assert.equal(comparePixelSamples(float, float).values, null, 'no implicit HDR range');
  for (const xy of [[-1, 0], [2, 0], [0, 1], [0.5, 0], [NaN, 0]]) assert.throws(() => samplePixel(reference, ...xy));
  assert.throws(() => samplePixel({ ...reference, data: new Uint8Array(8) }, 0, 0));
  assert.throws(() => samplePixel(raster([1024, 0, 0, 0], 10), 0, 0));
  assert.throws(() => samplePixel(raster([NaN, 0, 0, 0], 32), 0, 0));
  console.log('PASS exact lower bits, alpha-zero RGB, signed native/mixed deltas, compatibility and ownership');

  for (const dpr of [1, 2, 2.5]) {
    // The displayed 4x2 raster occupies CSS x=180..260, y=140..180.
    const geom = { rect: { left: 100, top: 50, width: 300, height: 200 }, canvas: { width: 300 * dpr, height: 200 * dpr },
      view: { centerX: 3.5, centerY: 0.5 }, source: { width: 4, height: 2 }, image: { width: 4, height: 2 }, scale: 20 * dpr };
    assert.deepEqual(pixelAtClientPoint(geom, 210, 150), { x: 1, y: 0 });
    assert.deepEqual(pixelAtClientPoint(geom, 180, 140), { x: 0, y: 0 });
    assert.deepEqual(pixelAtClientPoint(geom, 259.999, 179.999), { x: 3, y: 1 });
    for (const xy of [[179.999, 150], [260, 150], [210, 180], [410, 150]]) assert.equal(pixelAtClientPoint(geom, ...xy), null);
    assert.deepEqual(pixelCenterInCanvas(geom, { x: 1, y: 0 }), { x: 110 * dpr, y: 100 * dpr });
    assert.equal(pixelAtClientPoint({ ...geom, rect: { ...geom.rect, height: 0 } }, 210, 150), null);
    const small = { ...geom, image: { width: 2, height: 1 } };
    assert.deepEqual(pixelAtClientPoint(small, 210, 160), { x: 0, y: 0 }, 'smaller images are centered, never stretched');
  }
  const rounded = { rect: { left: 0, top: 0, width: 100.3, height: 80.2 }, canvas: { width: 251, height: 201 },
    source: { width: 4, height: 2 }, image: { width: 4, height: 2 }, view: { centerX: 2, centerY: 1 }, scale: 10 };
  const mid = pixelCenterInCanvas(rounded, { x: 1, y: 1 });
  assert.deepEqual(pixelAtClientPoint(rounded, mid.x * 100.3 / 251, mid.y * 80.2 / 201), { x: 1, y: 1 });
  console.log('PASS client coordinates, pan, zoom, independent DPR axes, borders and centered rasters');

  class Element {
    constructor() { this.children = []; this.events = new Map(); this.attrs = {}; this.value = ''; this.text = ''; this.open = false; this.hidden = false; this.disabled = false; this.rect = { left: 100, top: 200, width: 200, height: 100 }; this.classList = { contains: () => false, add() {}, remove() {} }; }
    set textContent(v) { this.text = String(v); this.children = []; }
    get textContent() { return this.text + this.children.map(c => c.textContent).join(''); }
    append(...nodes) { this.children.push(...nodes); }
    replaceChildren(...nodes) { this.text = ''; this.children = nodes; }
    setAttribute(k, v) { this.attrs[k] = String(v); }
    removeAttribute(k) { delete this.attrs[k]; }
    addEventListener(k, fn) { const list = this.events.get(k) || []; list.push(fn); this.events.set(k, list); }
    emit(k, event = {}) { for (const fn of this.events.get(k) || []) fn({ currentTarget: this, target: this, preventDefault() {}, pointerId: 1, button: 0, isPrimary: true, ...event }); }
    getBoundingClientRect() { return this.rect; }
    setPointerCapture() {}
    focus() { document.activeElement = this; }
  }
  const elements = new Map(), get = id => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); };
  global.document = { getElementById: get, createElement: () => new Element() };
  global.window = { devicePixelRatio: 2 };
  const sourcePixels = createPixelBuffer({ ...reference, width: 4, height: 2, data: new Uint16Array(Array.from({ length: 32 }, (_, i) => i * 257 + (i % 4 === 0 ? 1 : 0))) });
  const app = { source: { width: 4, height: 2, pixelBuffer: sourcePixels, canvas: {} }, sourceGeneration: 1,
    layout: 2, variants: [], pointer: {}, view: { centerX: 2, centerY: 1, absoluteScale: 20, zoom: 1 } };
  let encodes = 0, computes = 0, paints = 0, strokes = 0;
  const { createCanvas } = await import('../src/ui/canvas.mjs');
  const { createPixelInspector } = await import('../src/ui/pixel-inspector.mjs');
  const { createControls } = await import('../src/ui/controls.mjs');
  const deps = { isAnalysisResizing: () => false, clamp: (v, a, b) => Math.max(a, Math.min(b, v)),
    updateAnalysisViewport() { computes++; }, updateAnalysis() { computes++; }, redrawAnalysis() {},
    outputFormatLabel: f => f, renderVariant() { encodes++; } };
  const canvasUI = createCanvas({ app, els: {} }, deps);
  const ui = createPixelInspector({ app }, deps);
  const controls = createControls({ app, els: {} }, deps);
  Object.assign(deps, canvasUI, ui, { isVariantReady: controls.isVariantReady, updateMetrics: controls.updateMetrics });
  function variant(index, pixels = sourcePixels) {
    const canvas = new Element(); canvas.width = 400; canvas.height = 200; canvas.parentElement = new Element();
    const ctx = new Proxy({}, { get: (t, k) => k === 'drawImage' ? () => { paints++; } : k === 'stroke' ? () => { strokes++; } : () => {} });
    const v = { index, canvas, ctx, cell: new Element(), config: { format: 'png' }, resultConfig: { format: 'png' },
      resultSource: app.source, blob: {}, url: 'blob:test', bitmap: { width: pixels.width, height: pixels.height }, pixelBuffer: pixels,
      controls: { download: {} }, generation: 0, metricsEls: Object.fromEntries(['format', 'size', 'ratio', 'psnr', 'time'].map(k => [k, new Element()])) };
    canvasUI.attachCanvasEvents(canvas); return v;
  }
  app.variants = [variant(0), variant(1, createPixelBuffer({ ...sourcePixels, sampleType: 'uint8', bitDepth: 8, data: new Uint8Array(sourcePixels.data.map(n => Math.round(n / 257))) }))];
  ui.attachPixelInspectorEvents(); assert.equal(get('pixelTable').hidden, true);
  const panel = get('pixelInspector'), canvas = app.variants[0].canvas;
  panel.open = true; panel.emit('toggle');
  computes = 0; const view = { ...app.view };
  canvas.emit('pointerdown', { clientX: 190, clientY: 240 }); canvas.emit('pointerup', { clientX: 190, clientY: 240 });
  assert.deepEqual([get('pixelX').value, get('pixelY').value], ['1', '0']);
  assert.equal(get('pixelRows').children.length, 3);
  const cells = get('pixelRows').children.map(row => row.children);
  assert.equal(cells[0][2].textContent, '1029'); assert.equal(cells[0][5].textContent, '1799');
  assert.equal(cells[1][2].textContent, '1029Δ 0');
  assert.equal(cells[2][2].textContent, '4Δ −0,001526%');
  assert.equal(computes, 0); assert.equal(encodes, 0); assert.deepEqual(app.view, view); assert.ok(strokes > 0);
  const painted = paints; ui.updatePixelInspector(); assert.equal(paints, painted, 'reading the inspector does not repaint');
  get('pixelX').value = '3'; get('pixelY').value = '1'; get('pixelForm').emit('submit');
  assert.equal(get('pixelRows').children[0].children[2].textContent, '7197'); assert.equal(computes, 0);
  get('pixelX').value = '4'; get('pixelForm').emit('submit');
  assert.equal(get('pixelTable').hidden, true); assert.equal(document.activeElement, get('pixelX')); assert.equal(get('pixelX').attrs['aria-invalid'], 'true');
  get('pixelX').value = '0'; get('pixelY').value = '0'; get('pixelForm').emit('submit');
  assert.equal(get('pixelRows').children[0].children[2].textContent, '1');
  const oldRows = get('pixelRows').textContent;
  panel.open = false; panel.emit('toggle'); assert.equal(get('pixelTable').hidden, true);
  canvas.emit('pointerdown', { clientX: 210, clientY: 240 }); canvas.emit('pointerup', { clientX: 210, clientY: 240 });
  panel.open = true; panel.emit('toggle'); assert.equal(get('pixelRows').textContent, oldRows);
  get('analysisBody').hidden = true; ui.updatePixelInspector(); const beforeHidden = strokes; deps.redrawPreviews(); assert.equal(strokes, beforeHidden);
  get('analysisBody').hidden = false; ui.updatePixelInspector();
  controls.markDirty(app.variants[1], { schedule: false });
  assert.match(get('pixelRows').children[2].textContent, /Ожидание/); assert.doesNotMatch(get('pixelRows').children[2].textContent, /Δ/);
  app.variants[1].dirty = false; app.variants[1].error = 'failure'; controls.updateMetrics(app.variants[1]); assert.match(get('pixelRows').children[2].textContent, /Ошибка/);
  app.variants[1].error = null; app.variants[1].pixelBuffer = raster([3, 4, 5, 6]); controls.updateMetrics(app.variants[1]);
  assert.match(get('pixelRows').children[2].textContent, /Размеры различаются/); assert.equal(get('pixelRows').children[2].children[2].textContent, '3');
  app.variants.push(variant(2), variant(3)); app.layout = 4; ui.updatePixelInspector(); assert.equal(get('pixelRows').children.length, 5);
  app.layout = 2; ui.updatePixelInspector(); assert.equal(get('pixelRows').children.length, 3);
  console.log('PASS native UI values, keyboard coordinates, invalidation, errors, size mismatch, collapse and 2/4 rows without encoding');

  function gesture(events) { for (const [kind, x, y, extra] of events) canvas.emit(kind, { clientX: x, clientY: y, ...extra }); }
  gesture([['pointerdown', 190, 240], ['pointermove', 220, 240], ['pointermove', 190, 240], ['pointerup', 190, 240]]);
  assert.equal(get('pixelX').value, '0', 'an out-and-back drag is not a click'); assert.deepEqual(app.view, view);
  gesture([['pointerdown', 190, 240], ['pointermove', 210, 240], ['pointerup', 210, 240]]);
  assert.equal(app.view.centerX, 1, 'normal pan remains active'); assert.equal(get('pixelX').value, '0');
  Object.assign(app.view, view);
  for (const cancel of ['pointercancel', 'lostpointercapture']) {
    gesture([['pointerdown', 190, 240], [cancel, 190, 240], ['pointerup', 190, 240]]); assert.equal(get('pixelX').value, '0');
  }
  gesture([['pointerdown', 190, 240], ['pointerdown', 190, 240, { pointerId: 2, isPrimary: false }], ['pointerup', 190, 240]]);
  assert.equal(get('pixelX').value, '0');
  gesture([['pointerdown', 190, 240, { button: 2 }], ['pointerup', 190, 240, { button: 2 }]]); assert.equal(get('pixelX').value, '0');
  gesture([['pointerdown', 110, 210], ['pointerup', 110, 210]]); assert.equal(get('pixelX').value, '0'); assert.match(get('pixelStatus').textContent, /вне изображения/);
  gesture([['pointerdown', 190, 240]]); app.variants[0].dirty = true; gesture([['pointerup', 190, 240]]); assert.equal(get('pixelX').value, '0'); app.variants[0].dirty = false;
  gesture([['pointerdown', 190, 240]]); app.variants[0].pixelBuffer = { ...sourcePixels }; gesture([['pointerup', 190, 240]]); assert.equal(get('pixelX').value, '0');
  gesture([['pointerdown', 190, 240]]); app.source = { ...app.source }; app.sourceGeneration++; gesture([['pointerup', 190, 240]]);
  assert.equal(get('pixelX').value, ''); assert.equal(get('pixelTable').hidden, true);
  app.source = null; ui.updatePixelInspector(); assert.equal(get('pixelShow').disabled, true);
  assert.equal(encodes, 0); assert.deepEqual(reference.data, original);
  console.log('PASS actual pointer wiring, pan vs click, cancel, multitouch, pending/replaced results and source changes');
})().catch(error => { console.error(error); process.exitCode = 1; });
