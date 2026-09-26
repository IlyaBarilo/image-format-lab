const assert = require('node:assert/strict');

(async () => {
  const { processingStages } = await import('../src/core/processing-timing.mjs');
  const stages = processingStages({ started: 0, encodeStart: 3, encodeEnd: 11,
    decodeStart: 13, decodeEnd: 17, metricsStart: 19, metricsEnd: 24, finished: 27 });
  assert.deepEqual(stages, { totalMs: 27, beforeEncodeMs: 3, encodeMs: 8,
    decodeMs: 4, metricsMs: 5, otherMs: 7 });
  assert.equal(stages.beforeEncodeMs + stages.encodeMs + stages.decodeMs + stages.metricsMs + stages.otherMs, stages.totalMs);
  assert.throws(() => processingStages({ started: 0, encodeStart: 4, encodeEnd: 3,
    decodeStart: 5, decodeEnd: 6, metricsStart: 7, metricsEnd: 8, finished: 9 }), TypeError);

  const { createEncode } = await import('../src/services/encode.mjs');
  let releaseFirst;
  const firstGate = new Promise(resolve => { releaseFirst = resolve; });
  const order = [];
  const deps = { staleRequest: () => Error('stale'), encodeOne: async (config) => {
    order.push('start ' + config.id);
    if (config.id === 1) await firstGate;
    order.push('end ' + config.id);
    return { blob: new Blob([config.id]) };
  } };
  const encoder = createEncode({ app: {} }, deps);
  const first = {}, second = {};
  const a = encoder.encodeFromSource({ id: 1 }, {}, () => true, first);
  await new Promise(resolve => setImmediate(resolve));
  const b = encoder.encodeFromSource({ id: 2 }, {}, () => true, second);
  assert.deepEqual(order, ['start 1']);
  releaseFirst();
  await Promise.all([a, b]);
  assert.deepEqual(order, ['start 1', 'end 1', 'start 2', 'end 2']);
  assert.ok(first.encodeStart <= first.encodeEnd);
  assert.ok(first.encodeEnd <= second.encodeStart);
  assert.ok(second.encodeStart <= second.encodeEnd);

  const { createReports } = await import('../src/ui/reports.mjs');
  const captured = [];
  const report = { source: { name: 'test.png', width: 2, height: 2, bytes: 100, bitDepth: 8 },
    createdAt: 'test', browser: 'test', variants: [{ cell: 1, status: 'ready', codec: 'test', error: null,
      config: { format: 'jpeg', quality: 85 }, metrics: { processingMs: 27, stages } }] };
  const reportDeps = { comparisonReport: () => report, downloadBlob: (blob, name) => captured.push({ blob, name }) };
  const reports = createReports({ app: {}, els: { metadataPolicy: { value: 'none' } } }, reportDeps);
  reportDeps.csvCell = reports.csvCell;
  reports.saveComparisonReport('csv');
  const csv = await captured[0].blob.text();
  const [head, row] = csv.replace(/^\ufeff/, '').split('\r\n').map(line => line.split(',').map(value => value.replace(/^"|"$/g, '')));
  assert.equal(head.length, row.length);
  assert.equal(row[head.indexOf('processing_ms')], '27');
  assert.equal(row[head.indexOf('before_encode_ms')], '3');
  assert.equal(row[head.indexOf('encoding_ms')], '8');
  assert.equal(row[head.indexOf('result_read_ms')], '4');
  assert.equal(row[head.indexOf('metrics_ms')], '5');
  assert.equal(row[head.indexOf('other_ms')], '7');
  assert.equal(row[head.indexOf('measured_total_ms')], '27');
  reports.saveComparisonReport('json');
  assert.deepEqual(JSON.parse(await captured[1].blob.text()).variants[0].metrics.stages, stages);
  console.log('PASS stage arithmetic and serialized encoding boundaries');
})().catch(error => { console.error(error); process.exitCode = 1; });
