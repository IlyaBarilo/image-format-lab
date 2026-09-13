// Diagnostic timing, not a pass/fail browser test. No project walks or file writes.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { performance } = require('node:perf_hooks');
const Module = require('node:module');
const { decodeScript } = require('./support/codec-payload.cjs');
const root = path.resolve(__dirname, '..');
const names = ['heic-decoder.js', 'jpeg-decoder.js', 'modern-codecs.js', 'bmp-decoder.js', 'tiff-codec.js'];
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

(async () => {
  if (process.argv.includes('--child')) {
    const input = fs.readFileSync(0, 'utf8');
    const { decodeCodecEntry } = await import('../src/core/codec-payload.mjs');
    const start = performance.now(), payload = JSON.parse(input), parsed = performance.now();
    const pako = require('../vendor/pako-2.1.0.min.js');
    const scripts = names.map(name => decodeCodecEntry(payload.scripts['vendor/' + name], pako.ungzip));
    const unpacked = performance.now();
    const instances = await Promise.all(names.map((name, i) => {
      const filename = path.join(root, 'vendor', name), mod = new Module(filename, module);
      mod.filename = filename; mod.paths = module.paths; mod._compile(scripts[i], filename);
      return mod.exports({ print() {}, printErr() {} });
    }));
    if (!instances[0]._viewer_heic_can_encode() || !instances[0]._viewer_avif_can_encode()) throw Error('HEIC/AVIF unavailable');
    const end = performance.now();
    process.stdout.write(JSON.stringify({ parseMs: parsed - start, unpackMs: unpacked - parsed, initMs: end - unpacked, totalMs: end - start }));
    return;
  }
  if (process.argv.length !== 2) throw Error('Run without arguments');
  const html = fs.readFileSync(path.join(root, 'image-format-lab.html'));
  const packed = JSON.parse(html.toString('utf8').match(/id="embedded-codecs">([\s\S]*?)<\/script>/)[1]);
  if (names.some(name => packed.scripts['vendor/' + name]?.encoding !== 'gzip-base64')) throw Error('Build the compressed HTML first');
  const plain = structuredClone(packed);
  for (const name of names) plain.scripts['vendor/' + name] = decodeScript(plain.scripts['vendor/' + name]);
  const inputs = { plain: JSON.stringify(plain), gzip: JSON.stringify(packed) }, rounds = [];
  for (let pair = 0; pair < 7; pair++) for (const kind of pair % 2 ? ['gzip', 'plain'] : ['plain', 'gzip']) {
    const child = spawnSync(process.execPath, [__filename, '--child'], { input: inputs[kind], encoding: 'utf8', maxBuffer: 100000, timeout: 30000 });
    if (child.status !== 0) throw Error(child.stderr || child.error?.message || 'Benchmark child failed');
    rounds.push({ pair, kind, ...JSON.parse(child.stdout) });
  }
  const median = rows => rows.sort((a, b) => a - b)[Math.floor(rows.length / 2)];
  const metrics = ['parseMs', 'unpackMs', 'initMs', 'totalMs'];
  const summary = Object.fromEntries(['plain', 'gzip'].map(kind => [kind, Object.fromEntries(metrics.map(key => [key, median(rounds.filter(row => row.kind === kind).map(row => row[key]))]))]));
  console.log(JSON.stringify({
    scope: 'Fresh Node processes: JSON parse, supplied pako, actual application unpacker and real WASM factory initialization. Not browser or HTML startup.',
    node: process.version, platform: process.platform, arch: process.arch,
    html: { bytes: html.length, sha256: sha(html) }, unpackerSha256: sha(fs.readFileSync(path.join(root, 'src/core/codec-payload.mjs'))),
    excludes: ['Process creation and stdin reading', 'HTML file loading, DOM and rendering', 'Browser script loading, Blob handling and Worker scheduling'],
    rounds, median: summary, medianExtraMs: summary.gzip.totalMs - summary.plain.totalMs
  }, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
