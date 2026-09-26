const assert = require('node:assert/strict');

(async () => {
  const { normalizeModernOptions } = await import('../src/core/modern-options.mjs');
  const { DEFAULT_VARIANTS } = await import('../src/core/config.mjs');
  const { normalizeBatchSettings, validateComparison } = await import('../src/core/settings.mjs');
  assert.deepEqual(normalizeModernOptions(), { webpMethod: 4, jxlEffort: 5 });
  assert.deepEqual(normalizeModernOptions({ webpMethod: 0, jxlEffort: 10 }), { webpMethod: 0, jxlEffort: 10 });
  for (const options of [{ webpMethod: -1 }, { webpMethod: 7 }, { webpMethod: 2.5 },
    { jxlEffort: 0 }, { jxlEffort: 11 }, { jxlEffort: '5' }])
    assert.throws(() => normalizeModernOptions(options), RangeError);
  const comparison = { layout: 2, background: 'checker', metadataPolicy: 'none',
    variants: DEFAULT_VARIANTS.map(({ webpMethod, jxlEffort, ...variant }) => variant) };
  assert.ok(validateComparison(comparison).variants.every(variant => variant.webpMethod === 4 && variant.jxlEffort === 5));
  comparison.variants[1].format = 'webpLossless';
  comparison.variants[1].webpMethod = 0;
  comparison.variants[2].format = 'jxlLossless';
  comparison.variants[2].jxlEffort = 10;
  const restored = validateComparison(comparison);
  assert.equal(restored.variants[1].webpMethod, 0);
  assert.equal(restored.variants[2].jxlEffort, 10);
  comparison.variants[2].jxlEffort = 11;
  assert.throws(() => validateComparison(comparison), RangeError);
  assert.deepEqual([normalizeBatchSettings({ webpMethod: 6, jxlEffort: 1 }).webpMethod,
    normalizeBatchSettings({ webpMethod: 6, jxlEffort: 1 }).jxlEffort], [6, 1]);
  assert.deepEqual([normalizeBatchSettings({ webpMethod: 7, jxlEffort: 0 }).webpMethod,
    normalizeBatchSettings({ webpMethod: 7, jxlEffort: 0 }).jxlEffort], [4, 5]);

  const { reportFormatConfig } = await import('../src/core/format-options.mjs');
  const { createReports } = await import('../src/ui/reports.mjs');
  const outputs = [];
  const report = { source: { name: 'x.png', width: 1, height: 1, bytes: 10, bitDepth: 8 },
    createdAt: 'test', browser: 'test', variants: [
      { cell: 1, status: 'ready', codec: 'test', error: null, config: reportFormatConfig({ format: 'webpLossless', webpMethod: 0 }), metrics: {} },
      { cell: 2, status: 'ready', codec: 'test', error: null, config: reportFormatConfig({ format: 'jxlLossless', jxlEffort: 10 }), metrics: {} }
    ] };
  const reportDeps = { comparisonReport: () => report, downloadBlob: (blob, name) => outputs.push({ blob, name }) };
  const reports = createReports({ app: {}, els: { metadataPolicy: { value: 'none' } } }, reportDeps);
  reportDeps.csvCell = reports.csvCell;
  reports.saveComparisonReport('csv');
  const rows = (await outputs[0].blob.text()).replace(/^\ufeff/, '').split('\r\n').map(line => line.split(',').map(value => value.replace(/^"|"$/g, '')));
  const webpIndex = rows[0].indexOf('webp_method'), jxlIndex = rows[0].indexOf('jxl_effort');
  assert.equal(rows[1].length, rows[0].length);
  assert.equal(rows[2].length, rows[0].length);
  assert.deepEqual([rows[1][webpIndex], rows[1][jxlIndex], rows[2][webpIndex], rows[2][jxlIndex]], ['0', '', '', '10']);
  reports.saveComparisonReport('json');
  const json = JSON.parse(await outputs[1].blob.text());
  assert.equal(json.variants[0].config.webpMethod, 0);
  assert.equal(json.variants[1].config.jxlEffort, 10);

  const calls = [], messages = [];
  const codec = {
    HEAPU8: new Uint8Array(128), _malloc: () => 16, _free() {}, _viewer_modern_clear() {},
    _viewer_modern_encode(...args) { calls.push(args); this.HEAPU8.set([1, 2, 3], 64); return 0; },
    _viewer_modern_error: () => 0, UTF8ToString: () => '',
    _viewer_modern_output: () => 64, _viewer_modern_output_size: () => 3,
    _viewer_modern_width: () => 1, _viewer_modern_height: () => 1
  };
  globalThis.ViewerModernModule = async () => codec;
  globalThis.self = { postMessage: message => messages.push(message) };
  await import('../src/workers/modern.worker.mjs');
  for (const [format, kind, method, effort] of [['webpLossless', 1, 0, 5], ['jxl', 2, 4, 10], ['jxlLossless', 3, 4, 1]]) {
    await self.onmessage({ data: { id: calls.length + 1, type: 'encode', format, width: 1, height: 1,
      quality: 85, webpMethod: method, jxlEffort: effort, buffer: new Uint8Array(4).buffer } });
    assert.deepEqual(calls.at(-1).slice(-3), [kind, method, effort]);
    assert.equal(messages.at(-1).type, 'encoded');
  }
  await self.onmessage({ data: { id: 99, type: 'encode', format: 'jxl', width: 1, height: 1,
    quality: 85, webpMethod: 4, jxlEffort: 11, buffer: new Uint8Array(4).buffer } });
  assert.equal(calls.length, 3);
  assert.equal(messages.at(-1).type, 'error');
  delete globalThis.self;
  delete globalThis.ViewerModernModule;
  console.log('PASS modern option defaults, saved settings, validation and Worker arguments');
})().catch(error => { console.error(error); process.exitCode = 1; });
