const assert = require('node:assert/strict');
const { buildSync } = require('../scripts/node_modules/esbuild');

(async () => {
  // Exercise the real composition root; worker source text is not executed here.
  const bundle = buildSync({
    entryPoints: ['src/application.mjs'], bundle: true, write: false,
    format: 'cjs', platform: 'node', external: ['viewer:*']
  }).outputFiles[0].text;
  const application = { exports: {} };
  new Function('exports', 'module', 'require', bundle)(application.exports, application, name => {
    assert.ok(['compute', 'modern', 'heic', 'tiff', 'jpeg2000'].some(worker => name === `viewer:${worker}-worker`));
    return '';
  });
  const element = { closest: () => element, querySelector: () => element,
    querySelectorAll: () => [], getContext: () => null };
  global.document = { getElementById: () => element, createElement: () => element };
  const { app, actions } = application.exports.createApplication();
  const calls = [], operations = [], script = {}, versions = { version: 'test-codec' };
  const activeCodec = { encode: () => 'comparison' };
  app.codecs.gifenc = activeCodec;
  const before = JSON.stringify({ codecs: app.codecs, promises: app.codecPromises });
  actions.loadScript = async (...args) => { calls.push(['script', ...args]); return script; };
  actions.loadOptionalCodec = async name => {
    calls.push(['codec', name]);
    return { diagnosticInfo: versions, encode: value => value + 1 };
  };
  const runtime = actions.createDiagnosticRuntime(operation => operations.push(operation));
  try {
    assert.equal(await runtime.actions.loadScript('test-script', 123), script);
    for (const name of ['upng', 'gifenc']) {
      const codec = await runtime.actions.loadOptionalCodec(name);
      assert.equal(codec.encode(41), 42);
      assert.equal(await runtime.actions.loadOptionalCodec(name), codec);
      assert.equal(runtime.info[name], versions);
    }
    assert.deepEqual(calls, [['script', 'test-script', 123], ['codec', 'upng'], ['codec', 'gifenc']]);
    assert.ok(operations.includes('loadScript'));
    assert.ok(operations.includes('loadOptionalCodec'));
    assert.ok(operations.includes('encode'));
    assert.equal(app.codecs.gifenc, activeCodec);
    assert.equal(activeCodec.encode(), 'comparison');
    assert.equal(JSON.stringify({ codecs: app.codecs, promises: app.codecPromises }), before);
  } finally { runtime.dispose(); }
  assert.throws(() => runtime.actions.loadScript('disposed'));

  const failure = new TypeError('unavailable script');
  actions.loadScript = async () => { throw failure; };
  actions.loadOptionalCodec = async () => { throw failure; };
  const failed = actions.createDiagnosticRuntime();
  try {
    await assert.rejects(failed.actions.loadScript('failure'), error => error === failure);
    await assert.rejects(failed.actions.loadOptionalCodec('gifenc'), error => error === failure);
  } finally { failed.dispose(); }

  actions.loadScript = async () => script;
  actions.loadOptionalCodec = async () => ({ encode: () => 'recovered' });
  const recovered = actions.createDiagnosticRuntime();
  try {
    assert.equal(await recovered.actions.loadScript('retry'), script);
    assert.equal((await recovered.actions.loadOptionalCodec('gifenc')).encode(), 'recovered');
  } finally { recovered.dispose(); }
  console.log('PASS application passes current script/PNG/GIF loaders, caches isolated codecs, records operations and versions, and recovers after loader failure');
})().catch(error => { console.error(error); process.exitCode = 1; });
