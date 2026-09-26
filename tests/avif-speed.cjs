const assert = require('node:assert/strict');

(async () => {
  const { normalizeAvifOptions } = await import('../src/core/avif-options.mjs');
  const { DEFAULT_VARIANTS } = await import('../src/core/config.mjs');
  const { normalizeBatchSettings, validateComparison } = await import('../src/core/settings.mjs');
  assert.deepEqual(normalizeAvifOptions(), { avifSpeed: 6 });
  assert.deepEqual(normalizeAvifOptions({ avifSpeed: 0 }), { avifSpeed: 0 });
  assert.deepEqual(normalizeAvifOptions({ avifSpeed: 9 }), { avifSpeed: 9 });
  for (const avifSpeed of [-1, 10, 3.5, '6'])
    assert.throws(() => normalizeAvifOptions({ avifSpeed }), RangeError);

  const comparison = { layout: 2, background: 'checker', metadataPolicy: 'none',
    variants: DEFAULT_VARIANTS.map(({ avifSpeed, ...variant }) => variant) };
  assert.ok(validateComparison(comparison).variants.every(variant => variant.avifSpeed === 6));
  comparison.variants[1].format = 'avif';
  comparison.variants[1].avifSpeed = 0;
  assert.equal(validateComparison(comparison).variants[1].avifSpeed, 0);
  comparison.variants[1].avifSpeed = 10;
  assert.throws(() => validateComparison(comparison), RangeError);
  assert.equal(normalizeBatchSettings({ avifSpeed: 9 }).avifSpeed, 9);
  assert.equal(normalizeBatchSettings({ avifSpeed: 10 }).avifSpeed, 6);

  const { reportFormatConfig } = await import('../src/core/format-options.mjs');
  const { createReports } = await import('../src/ui/reports.mjs');
  const outputs = [];
  const report = { source: { name: 'x.png', width: 1, height: 1, bytes: 10, bitDepth: 8 },
    createdAt: 'test', browser: 'test', variants: [
      { cell: 1, status: 'ready', codec: 'test', error: null,
        config: reportFormatConfig({ format: 'avif', avifSpeed: 0 }), metrics: {} },
      { cell: 2, status: 'ready', codec: 'test', error: null,
        config: reportFormatConfig({ format: 'heic', avifSpeed: 9 }), metrics: {} }
    ] };
  const reportDeps = { comparisonReport: () => report, downloadBlob: (blob, name) => outputs.push({ blob, name }) };
  const reports = createReports({ app: {}, els: { metadataPolicy: { value: 'none' } } }, reportDeps);
  reportDeps.csvCell = reports.csvCell;
  reports.saveComparisonReport('csv');
  const rows = (await outputs[0].blob.text()).replace(/^\ufeff/, '').split('\r\n')
    .map(line => line.split(',').map(value => value.replace(/^"|"$/g, '')));
  const index = rows[0].indexOf('avif_speed');
  assert.ok(index >= 0);
  assert.equal(rows[1].length, rows[0].length);
  assert.equal(rows[2].length, rows[0].length);
  assert.deepEqual([rows[1][index], rows[2][index]], ['0', '']);
  reports.saveComparisonReport('json');
  const json = JSON.parse(await outputs[1].blob.text());
  assert.equal(json.variants[0].config.avifSpeed, 0);

  const calls = [], messages = [];
  const codec = {
    HEAPU8: new Uint8Array(128), _malloc: () => 16, _free() {}, _viewer_heic_clear() {},
    _viewer_avif_encode(...args) { calls.push(['avif', args]); this.HEAPU8.set([1, 2, 3, 4], 64); return 0; },
    _viewer_heic_encode(...args) { calls.push(['heic', args]); this.HEAPU8.set([1, 2, 3, 4], 64); return 0; },
    _viewer_heic_error: () => 0, UTF8ToString: () => '',
    _viewer_heic_output: () => 64, _viewer_heic_output_size: () => 16
  };
  globalThis.ViewerHeicModule = async () => codec;
  globalThis.self = { postMessage: message => messages.push(message) };
  await import('../src/workers/heic.worker.mjs');
  const request = (format, avifSpeed, id) => self.onmessage({ data: {
    id, type: 'encode', format, width: 1, height: 1, quality: 85, avifSpeed,
    buffer: new Uint8Array(4).buffer
  } });
  await request('avif', 0, 1);
  assert.deepEqual(calls.at(-1), ['avif', [16, 4, 1, 1, 85, 0]]);
  assert.equal(messages.at(-1).type, 'encoded');
  await request('avif', 9, 2);
  assert.equal(calls.at(-1)[1].at(-1), 9);
  await request('heic', undefined, 3);
  assert.deepEqual(calls.at(-1), ['heic', [16, 4, 1, 1, 85]]);
  await request('avif', 10, 4);
  assert.equal(calls.length, 3);
  assert.equal(messages.at(-1).type, 'error');
  delete globalThis.self;
  delete globalThis.ViewerHeicModule;
  console.log('PASS AVIF speed defaults, saved settings, report fields and Worker arguments');
})().catch(error => { console.error(error); process.exitCode = 1; });
