// Node checks of runtime unpacking, startup sequencing, retries and real WASM factories.
// No browser, network, file traversal or user archives.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module');
const { gzipSync } = require('node:zlib');
const { decodeScript } = require('./support/codec-payload.cjs');
const pako = require('../vendor/pako-2.1.0.min.js');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'image-format-lab.html'), 'utf8');
const payloadText = html.match(/id="embedded-codecs">([\s\S]*?)<\/script>/)[1];
const payload = JSON.parse(payloadText);
const pack = bytes => ({ encoding: 'gzip-base64', bytes: bytes.length, data: gzipSync(bytes).toString('base64') });

(async () => {
  const { decodeCodecEntry } = await import('../src/core/codec-payload.mjs');
  const fromBase64 = Uint8Array.fromBase64;
  try {
    for (const useFastPath of [false, true]) {
      // Test both branch contracts even on a Node without the new browser API.
      Uint8Array.fromBase64 = useFastPath ? text => new Uint8Array(Buffer.from(text, 'base64')) : undefined;
      for (const [name, entry] of Object.entries(payload.scripts)) {
        assert.equal(decodeCodecEntry(entry, pako.ungzip), fs.readFileSync(path.join(root, name), 'utf8'));
        assert.equal(decodeCodecEntry(entry, pako.ungzip), decodeScript(entry));
      }
      assert.equal(decodeCodecEntry(pack(Buffer.from('const текст = "🌈 </script>";')), pako.ungzip), 'const текст = "🌈 </script>";');
    }
  } finally { Uint8Array.fromBase64 = fromBase64; }
  for (const entry of [null, {}, { encoding: 'unknown' }, { ...pack(Buffer.from('x')), bytes: -1 }]) assert.throws(() => decodeCodecEntry(entry, pako.ungzip));
  const example = pack(Buffer.from('example'));
  assert.throws(() => decodeCodecEntry(example), /Распаковщик/);
  assert.throws(() => decodeCodecEntry({ ...example, bytes: 8 }, pako.ungzip), /размер/);
  assert.throws(() => decodeCodecEntry({ ...example, data: '???' }, pako.ungzip));
  const corrupt = Buffer.from(example.data, 'base64'); corrupt[corrupt.length - 8] ^= 1;
  assert.throws(() => decodeCodecEntry({ ...example, data: corrupt.toString('base64') }, pako.ungzip));
  assert.throws(() => decodeCodecEntry(pack(Buffer.from([0xc0, 0xaf])), pako.ungzip));
  console.log('PASS exact executable bytes with both base64 paths; Unicode, invalid metadata, gzip CRC, decoded size and UTF-8 errors');

  const previous = { document: global.document, window: global.window, pako: global.pako, UPNG: global.UPNG, gifenc: global.gifenc, fetch: global.fetch };
  const urls = new Map(), revoked = [], appended = [], failures = [];
  const originalCreate = URL.createObjectURL, originalRevoke = URL.revokeObjectURL;
  let inflateCalls = 0, holdPako = true, held, failPako = true, workerLoads = 0, reads = 0;
  const workers = [], workerEntries = { heic: 'heic-decoder.js', utif: 'jpeg-decoder.js', modern: 'modern-codecs.js' };
  try {
    global.window = global;
    delete global.pako; delete global.UPNG; delete global.gifenc;
    global.fetch = () => { throw Error('Unexpected network'); };
    URL.createObjectURL = blob => { const url = 'blob:codec-test-' + urls.size; urls.set(url, blob); return url; };
    URL.revokeObjectURL = url => revoked.push(url);
    global.document = {
      getElementById(id) { assert.equal(id, 'embedded-codecs'); reads++; return { textContent: payloadText }; },
      createElement(tag) {
        assert.equal(tag, 'script'); const events = {};
        return { addEventListener: (name, fn) => { events[name] = fn; }, removeEventListener: name => { delete events[name]; }, remove() {}, emit: name => events[name]?.() };
      },
      head: { append(script) {
        const pending = (async () => {
          const text = await urls.get(script.src).text();
          const name = Object.keys(payload.scripts).find(name => payload.scripts[name] === text);
          assert.ok(name, 'Only plain bootstrap scripts are inserted as script nodes'); appended.push(name);
          const finish = () => {
            if (name.includes('pako') && failPako) { script.emit('error'); return; }
            if (name.includes('pako')) global.pako = { ...pako, ungzip(bytes) { inflateCalls++; return pako.ungzip(bytes); } };
            else if (name.includes('UPNG')) global.UPNG = { encode() {}, decode() {} };
            else if (name.includes('gifenc')) global.gifenc = { GIFEncoder() {}, quantize() {}, applyPalette() {} };
            script.emit('load');
          };
          if (name.includes('pako') && holdPako) held = finish;
          else finish();
        })().catch(error => { failures.push(error); script.emit('error'); });
        return pending;
      } }
    };
    const reader = await import('../src/services/embedded-codecs.mjs');
    assert.equal(reader.embeddedCodecsNeedInflater(), true);
    assert.throws(() => reader.embeddedCodecSource('vendor/heic-decoder.js'), /Распаковщик/);
    const { createCodecs } = await import('../src/services/codecs.mjs');
    const app = { codecs: {}, codecPromises: {}, codecAttempts: {}, scriptPromises: new Map() };
    const els = { codecStatus: { dataset: {} }, codecNotice: {}, retryCodecs: {} };
    const deps = { updateFormatOptions() {} };
    for (const [key, name] of Object.entries(workerEntries)) {
      deps[{ heic: 'loadHeicCodec', utif: 'loadTiffCodec', modern: 'loadModernCodec' }[key]] = async () => {
        assert.equal(typeof global.pako?.ungzip, 'function', 'Inflater must be ready before worker creation');
        workerLoads++;
        const source = reader.embeddedCodecSource('vendor/' + name);
        assert.equal(source, decodeScript(payload.scripts['vendor/' + name]));
        const filename = path.join(root, 'vendor', name), mod = new Module(filename, module);
        mod.filename = filename; mod.paths = module.paths; mod._compile(source, filename);
        const instance = await mod.exports({ print() {}, printErr() {} });
        if (key === 'heic') assert.ok(instance._viewer_heic_can_encode() && instance._viewer_avif_can_encode());
        workers.push(instance);
        return { decode() {}, encode() {} };
      };
    }
    const actions = createCodecs({ app, els }, deps); Object.assign(deps, actions);
    const first = actions.loadAdditionalCodecs();
    assert.equal(actions.loadAdditionalCodecs(), first);
    while (!held) await new Promise(resolve => setImmediate(resolve));
    assert.equal(workerLoads, 0);
    assert.equal(appended.filter(name => name.includes('pako')).length, 1, 'All codec requests must share bootstrap');
    assert.equal(els.codecNotice.hidden, true, 'Normal startup must not add a status row');
    assert.equal(els.codecStatus.textContent, '');
    held(); await first;
    assert.equal(workerLoads, 0);
    assert.equal(els.codecStatus.dataset.state, 'error');
    assert.equal(els.codecNotice.hidden, false);
    assert.equal(els.retryCodecs.hidden, false);
    failPako = false; holdPako = false;
    await actions.loadAdditionalCodecs();
    assert.equal(els.codecStatus.dataset.state, 'ready');
    assert.equal(els.codecNotice.hidden, true);
    assert.equal(els.retryCodecs.hidden, true);
    assert.equal(Object.keys(app.codecs).length, 5);
    assert.equal(workerLoads, 3);
    assert.equal(inflateCalls, 3);
    for (const name of Object.values(workerEntries)) reader.embeddedCodecSource('vendor/' + name);
    await actions.loadAdditionalCodecs();
    assert.equal(inflateCalls, 3, 'Decoded text is reused for later worker creation');
    assert.equal(reader.embeddedCodecsNeedInflater(), false);
    assert.equal(reads, 1);
    assert.deepEqual(failures, []);
    assert.equal(appended.length, 4, 'pako retry plus UPNG and gifenc');
    assert.equal(new Set(revoked).size, urls.size);
    assert.throws(() => reader.embeddedCodecSource('missing'), /отсутствует/);
  } finally {
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete global[key]; else global[key] = value; }
    URL.createObjectURL = originalCreate; URL.revokeObjectURL = originalRevoke;
    workers.length = 0;
  }
  console.log('PASS real startup controller on mock DOM: coalesced bootstrap, delayed load, error/retry, three real WASM initializations, decode-once cache, revoked Blob URLs, no network');
})().catch(error => { console.error(error); process.exitCode = 1; });
