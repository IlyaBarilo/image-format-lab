// Exercise PNG export with real plotters on an in-memory recording Canvas.
const assert = require('node:assert/strict');
const {createHash} = require('node:crypto');

function recordingCanvas() {
  const ops = [], images = [], state = {};
  const ctx = new Proxy({
    measureText: text => ({width: text.length * 8}),
    createImageData: (width, height) => ({width, height, data: new Uint8ClampedArray(width * height * 4)}),
    putImageData: (pixels, ...args) => ops.push(['pixels', pixels.width, pixels.height, createHash('sha256').update(pixels.data).digest('hex'), ...args]),
    drawImage(image, ...args) { images.push(image); ops.push(['image', image.width, image.height, structuredClone(image.ops), ...args]); }
  }, {
    get(target, key) { return target[key] ?? state[key] ?? ((...args) => ops.push([key, ...args])); },
    set(target, key, value) { state[key] = value; ops.push(['set', key, value]); return true; }
  });
  return {width: 1, height: 1, ops, images, getContext: () => ctx, toBlob: fn => fn(new Blob(['PNG'], {type:'image/png'}))};
}

async function makeSnapshot(type, display, count = 2) {
  const {computeHistogram} = await import('../src/core/histogram.mjs');
  const {computeWaveform} = await import('../src/core/waveform.mjs');
  const {computeVectorscope} = await import('../src/core/vectorscope.mjs');
  const {computeLineProfile} = await import('../src/core/line-profile.mjs');
   const {computeDifference} = await import('../src/core/difference.mjs');
   const {computeErrorHistogram} = await import('../src/core/error-histogram.mjs');
  const {computeCieXy, computeDeltaE00} = await import('../src/core/color-sdr.mjs');
  const width = 64, height = 32, region = {unit:'pixels', x:8, y:4, width:48, height:24};
  const image = {width, height, data: Uint8ClampedArray.from({length:width * height * 4}, (_, i) => i % 4 === 3 ? 255 : (Math.floor(i / 4) + i % 4 * 51) % 256)};
  const altered = {...image, data:image.data.map((v, i) => i % 4 === 3 ? v : Math.round(v / 32) * 32)};
  const compute = {histogram:computeHistogram, waveform:computeWaveform, ycbcrWaveform:computeWaveform, parade:computeWaveform, vectorscope:computeVectorscope, profile:computeLineProfile};
  const items = Array.from({length:count}, (_, i) => {
    const input = i % 2 ? altered : image;
    return {cell:i + 1, label:`${i + 1} · ${i % 2 ? 'Квантование цвета' : 'Исходный: PNG'}`, status:'ready', message:'',
      measurement:{width, height, bytes:8192 - i * 1000, psnrRGB:i ? 35 : Infinity, processingMs:i * 3, alphaErrorPercent:0},
       data:type === 'tradeoff' ? {width, height} : type === 'difference' ? computeDifference(input, image, 'white', region) : type === 'errorHistogram' ? computeErrorHistogram(input, image, 'white', region) : type === 'cieXy' ? computeCieXy(input, 'white', region) : type === 'deltaE' ? computeDeltaE00(input, image, 'white', region) : compute[type](input, 'white', region)};
  });
  return {version:1, revision:1, source:{name:'gradient.png', width, height, bytes:8192},
    method:'Графики используют одинаковую шкалу и рассчитанные данные выбранной области изображения.', items,
    settings:{type, display, pair:count === 4 ? [3,4] : [1,2], matte:'white', scope:type === 'tradeoff' ? undefined : 'viewport',
      viewports:items.map(item => ({cell:item.cell, region})),
       ...(type === 'histogram' ? {channel:'rgb', level:128} : {}),
       ...(type === 'errorHistogram' ? {errorChannel:'rgb', level:0} : {}),
      ...(type === 'profile' ? {profileChannel:'rgb', position:500, line:{x0:0, y0:500, x1:1000, y1:500}} : {}),
      ...(type === 'difference' ? {differenceChannel:'rgb', gain:4} : {}), metric:'psnrRGB'}};
}

// A supplied Canvas factory also permits visual inspection using a native renderer.
async function exportReport(snapshot, {width = 1000, height = 112, dpr = 1, canvasFactory = recordingCanvas, includeJSON = false} = {}) {
  const {createAnalysis} = await import('../src/ui/analysis.mjs');
  const {createAnalysisOutput} = await import('../src/ui/analysis-output.mjs');
  const {createAnalysisCombined} = await import('../src/ui/analysis-combined.mjs');
  const {createScopePlots} = await import('../src/ui/scope-plots.mjs');
  const {analysisMaximum} = await import('../src/core/analysis-output.mjs');
  const oldDocument = globalThis.document, oldDpr = globalThis.devicePixelRatio;
  const elements = new Map(), liveCanvases = [], created = [], downloads = [];
  function element() {
    return {dataset:{}, style:{}, attrs:{}, children:[], events:{}, hidden:false, value:'', textContent:'',
      get options() { return this.children; }, get selectedOptions() { return [{textContent:this.label || this.value}]; },
      append(child) { this.children.push(child); }, replaceChildren() { this.children = []; },
      setAttribute(k,v) { this.attrs[k] = v; }, getAttribute(k) { return this.attrs[k] ?? null; }, removeAttribute(k) { delete this.attrs[k]; },
      addEventListener(k,fn) { (this.events[k] ??= []).push(fn); }, async fire(k) { for (const fn of this.events[k] || []) await fn(); },
      querySelector: () => get('plots'), querySelectorAll: () => []};
  }
  const get = id => { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); };
  function canvas(live = false) {
    const c = Object.assign(canvasFactory(), {dataset:{}, attrs:{}, hidden:false});
    c.setAttribute = (k,v) => { c.attrs[k] = v; }; c.getAttribute = k => c.attrs[k] ?? null; c.removeAttribute = k => { delete c.attrs[k]; };
    c.getBoundingClientRect = () => { assert.ok(live, 'export drawing must not measure a detached canvas'); return {width, height}; };
    (live ? liveCanvases : created).push(c);
    return c;
  }
  try {
    globalThis.devicePixelRatio = dpr;
    const cards = snapshot.items.map(() => canvas(true)), combined = canvas(true);
    elements.set('analysisCombinedChart', combined);
    globalThis.document = {getElementById:get, createElement: tag => tag === 'canvas' ? canvas() : element(), querySelectorAll: () => cards};
    get('analysisType').value = snapshot.settings.type;
     get('analysisType').label = {histogram:'Гистограмма', errorHistogram:'Гистограмма ошибок', waveform:'Waveform', ycbcrWaveform:'Waveform', parade:'Parade', vectorscope:'Вектороскоп', cieXy:'CIE xy', deltaE:'Цветовая разница ΔE00', profile:'Профиль', difference:'Карта различий', tradeoff:'Размер и метрика'}[snapshot.settings.type];
    get('analysisMetric').value = snapshot.settings.metric;
    const deps = {...createAnalysisCombined(), ...createScopePlots(), isAnalysisResizing:() => false, getAnalysisSnapshot:() => snapshot,
      downloadBlob: (blob, name) => downloads.push({blob, name})};
    const state = {app:{layout:snapshot.items.length}};
    deps.renderAnalysisChart = createAnalysis(state, deps).renderAnalysisChart;
    const output = createAnalysisOutput(state, deps);
    output.applyAnalysisOutputPreferences({displays:{[snapshot.settings.type]:snapshot.settings.display}, pair:snapshot.settings.pair, metric:snapshot.settings.metric});
    output.attachAnalysisOutputEvents();
    if (snapshot.settings.display === 'separate') for (const [i, item] of snapshot.items.entries()) {
       if (item.data) deps.renderAnalysisChart(cards[i], item, snapshot.settings, analysisMaximum(snapshot.settings.type, snapshot.items, snapshot.settings.type==='errorHistogram'?snapshot.settings.errorChannel:snapshot.settings.channel));
      cards[i].setAttribute('aria-label', item.label + (item.data ? ` · Область ${item.data.bounds.width}×${item.data.bounds.height} px` : ''));
    }
    output.presentAnalysis(snapshot);
    const sizesBefore = liveCanvases.map(c => [c.width, c.height]);
    const previousCount = created.length;
    await get('analysisPNG').fire('click');
    assert.equal(get('analysisSaveStatus').textContent, '');
    assert.equal(downloads.length, 1);
    assert.deepEqual(liveCanvases.map(c => [c.width, c.height]), sizesBefore, 'PNG leaves live canvas sizes intact');
    const report = created.slice(previousCount).find(c => c.width === 1200);
    assert.ok(report); assert.ok(report.height > 400);
    let json;
    if (includeJSON) { await get('analysisJSON').fire('click'); json = JSON.parse(await downloads[1].blob.text()); }
    return {report, blob:downloads[0].blob, liveCanvases, json};
  } finally { globalThis.document = oldDocument; globalThis.devicePixelRatio = oldDpr; }
}

async function main() {
   for (const type of ['histogram','errorHistogram','waveform','ycbcrWaveform','parade','vectorscope','cieXy','deltaE','profile','difference','tradeoff']) {
     const modes = type === 'tradeoff' ? ['metrics'] : ['difference','deltaE'].includes(type) ? ['separate'] : ['vectorscope','errorHistogram','cieXy'].includes(type) ? ['separate','overlay'] : ['separate','overlay','delta'];
    for (const display of modes) {
      const snapshot = await makeSnapshot(type, display, 4), before = structuredClone(snapshot);
      const short = await exportReport(snapshot, {width:1400, height:112, dpr:2});
      const tall = await exportReport(snapshot, {width:320, height:480, dpr:1});
      const charts = short.report.images;
      assert.equal(charts.length, display === 'separate' ? 4 : 1, `${type}/${display} exports the right number of charts`);
      for (const [i, chart] of charts.entries()) {
        assert.ok(!short.liveCanvases.includes(chart), 'no on-screen raster is copied into PNG');
        assert.deepEqual([chart.width, chart.height], [display === 'separate' ? 566 : 1152, 280]);
        assert.deepEqual(chart.ops, tall.report.images[i].ops, `${type}/${display} is independent of the panel height, width and DPR`);
        assert.ok(chart.ops.some(op => op[0] === 'fillRect' && op[4] === 280));
      }
      assert.deepEqual(snapshot, before, 'export preserves arrays, ROI, measurements and settings');
      if (type === 'histogram' && display === 'separate') {
        assert.ok(charts[0].ops.some(op => op[0] === 'lineTo' && op[2] === 28), 'histogram reaches the top of the report plotting area');
        assert.deepEqual(charts[0].ops.filter(op => op[0] === 'fillText' && op[1].endsWith('%')), charts[1].ops.filter(op => op[0] === 'fillText' && op[1].endsWith('%')), 'separate histograms retain a common percentage axis');
      }
    }
  }
  const unavailable = await makeSnapshot('histogram', 'separate');
  unavailable.items[1] = {...unavailable.items[1], data:null, status:'unavailable', message:'Результат ещё не готов.'};
  const {report} = await exportReport(unavailable);
  assert.equal(report.images.length, 1);
  assert.ok(report.ops.some(op => op[0] === 'fillText' && op[1].includes('Результат ещё не готов.')));
  const color = await exportReport(await makeSnapshot('deltaE','separate'), {includeJSON:true});
  assert.equal(color.json.settings.type,'deltaE');
  assert.ok(color.json.items[1].data.mean > 0);
  const xy = await exportReport(await makeSnapshot('cieXy','overlay'), {includeJSON:true});
  assert.equal(xy.json.items[0].data.bins.length,257*257);
  assert.ok(xy.report.images[0].ops.some(op => op[0] === 'image'), 'CIE xy includes color density in PNG');
  console.log('PASS report-sized redraw for all charts/modes, 2/4 cells, DPR, viewport data, common scale, unavailable cells and unchanged live dimensions');
}
module.exports = {makeSnapshot, exportReport};
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
