// Node-only checks. No browser, network, SDK, project walk or user archives.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto');
const { inflateRawSync } = require('node:zlib');
const { spawnSync } = require('node:child_process');
const { sourceNames, heicSourceNames } = require('../scripts/vendor-files.cjs');
const { sourceZip } = require('../scripts/source-zip.cjs');
const { decodeScript } = require('./support/codec-payload.cjs');
const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name));
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const payloadOf = html => JSON.parse(html.match(/id="embedded-codecs">([\s\S]*?)<\/script>/)[1]);
function unzip(zip) {
  const entries = new Map(); let offset = 0;
  while (zip.readUInt32LE(offset) === 0x04034b50) {
    assert.equal(zip.readUInt16LE(offset + 10), 0, 'source ZIP time must use the fixed epoch');
    assert.equal(zip.readUInt16LE(offset + 12), 0x21, 'source ZIP date must use the fixed epoch');
    const method = zip.readUInt16LE(offset + 8), size = zip.readUInt32LE(offset + 18);
    const names = zip.readUInt16LE(offset + 26), extra = zip.readUInt16LE(offset + 28);
    const name = zip.subarray(offset + 30, offset + 30 + names).toString('utf8');
    assert.ok(!entries.has(name));
    const start = offset + 30 + names + extra, bytes = zip.subarray(start, start + size);
    assert.ok([0, 8].includes(method));
    const decoded = method === 8 ? inflateRawSync(bytes) : bytes;
    assert.equal(decoded.length, zip.readUInt32LE(offset + 22));
    entries.set(name, decoded); offset = start + size;
  }
  assert.equal(zip.readUInt32LE(offset), 0x02014b50);
  assert.equal(zip.readUInt32LE(zip.length - 22), 0x06054b50);
  assert.equal(zip.readUInt16LE(zip.length - 12), entries.size);
  return entries;
}
function checkKit(file, names, archiveName) {
  const bytes = read('vendor/' + file), entries = unzip(bytes);
  assert.deepEqual([...entries.keys()].sort(), names.map(archiveName).sort());
  for (const name of names) assert.deepEqual(entries.get(archiveName(name)), read('vendor/' + name));
  return { bytes, entries };
}
class Element {
  constructor() { this.children = []; this.events = {}; this.textContent = ''; this.hidden = true; this.disabled = true; }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  addEventListener(name, fn) { this.events[name] = fn; }
  removeAttribute(name) { delete this[name]; }
  showModal() { this.open = true; }
}
(async () => {
  const html = read('image-format-lab.html').toString('utf8'), payload = payloadOf(html);
  assert.ok(!Object.hasOwn(payload, 'sources') && !Object.hasOwn(payload, 'sourceArchives'));
  const gif = checkKit('gifenc-1.0.3-sources.zip', sourceNames, n => n.slice(8));
  const heic = checkKit('heic-sources.zip', heicSourceNames, n => 'heic-sources/' + n.slice('sources/heic/'.length));
  assert.deepEqual(sourceZip([...gif.entries].map(([name, bytes]) => ({ name, bytes }))), gif.bytes);
  assert.match(gif.entries.get('gifenc-1.0.3/src/pnnquant2.js').toString(), /Mozilla Public/);
  for (const [id, kit] of [['gifenc', gif], ['heic', heic]]) {
    assert.equal(payload.sourcePackages[id].sha256, sha(kit.bytes));
    assert.equal(payload.sourcePackages[id].bytes, kit.bytes.length);
    assert.ok(!html.includes(kit.bytes.toString('base64')));
  }
  console.log('PASS separate source ZIPs: every input byte, manifests, deterministic gifenc and no archive payload in HTML');

  const { sourcePackages } = await import('../scripts/source-release.mjs');
  const config = { version: 1, urls: { gifenc: null, heic: null } };
  assert.throws(() => sourcePackages(config, payload.manifest, { release: true }), /requires source URLs/);
  // Reserved test domain, never written to the real release config or fetched.
  const releaseConfig = { version: 1, urls: { gifenc: 'https://example.invalid/test/gifenc.zip', heic: 'https://example.invalid/test/heic.zip' } };
  for (const url of ['', 'relative.zip', 'http://example.invalid/a.zip', 'javascript:alert(1)', 'https://user:secret@example.invalid/a', 'https://example.invalid/a#fragment']) {
    assert.throws(() => sourcePackages({ version: 1, urls: { ...releaseConfig.urls, heic: url } }, payload.manifest), /HTTPS/);
  }
  const { buildViewer } = await import('../scripts/build.mjs');
  const tag = 'v9.8.7-rc.1'; // Test-only tag; no real release is created.
  const released = payloadOf((await buildViewer({ release: true, tag, sourceConfig: releaseConfig })).html);
  assert.equal(released.releaseTag, tag);
  const local = { ...payload, releaseTag: null };
  await assert.rejects(buildViewer({ release: true, sourceConfig: releaseConfig }), /explicit version tag/);
  await assert.rejects(buildViewer({ release: true, tag, sourceConfig: config }), /requires source URLs/);
  assert.deepEqual(released.scripts, payload.scripts);
  assert.deepEqual(released.licenses, payload.licenses);
  assert.equal(released.sourcePackages.heic.url, releaseConfig.urls.heic);
  console.log('PASS public build requires HTTPS source URLs and retains exactly the same executable codec bytes and license texts');

  const { createLicenses } = await import('../src/ui/licenses.mjs');
  const oldDocument = global.document, oldFetch = global.fetch;
  try {
    global.fetch = () => { throw Error('Unexpected network access'); };
    for (const current of [local, released, { ...released, releaseTag: null }, { ...released, sourcePackages: { ...released.sourcePackages, heic: { ...released.sourcePackages.heic, url: 'javascript:alert(1)' } } }]) {
      const nodes = new Map(), get = id => { if (!nodes.has(id)) nodes.set(id, new Element()); return nodes.get(id); };
      global.document = { getElementById: get, createElement: () => new Element() };
      get('embedded-codecs').textContent = JSON.stringify(current);
      get('embedded-notices').textContent = html.match(/id="embedded-notices">([\s\S]*?)<\/script>/)[1];
      let download;
      createLicenses({}, { downloadBlob: (blob, name) => { download = { blob, name }; } }).attachLicenseEvents();
      get('licensesOpen').events.click();
      assert.equal(get('licensesDialog').open, true);
      if (current.sourcePackages.heic.url === 'javascript:alert(1)') {
        assert.match(get('licensesError').textContent, /Некорректная ссылка/);
        assert.equal(get('licensesSources').hidden, true);
        assert.equal(get('licensesDownload').disabled, true);
        continue;
      }
      assert.equal(get('licensesError').textContent, '');
      for (const [index, component] of current.components.components.entries()) {
        const version = component.id === 'viewer' ? current.releaseTag : component.version;
        assert.equal(get('licensesContent').children[index].children[0].textContent, component.name + (version ? ' · ' + version : ''));
      }
      for (const [id, node] of [['gifenc', 'licensesSources'], ['heic', 'licensesHeicSources']]) assert.equal(get(node).href, current.sourcePackages[id].url || undefined);
      get('licensesDownload').events.click();
      assert.equal(download.name, 'image-format-lab-licenses.txt');
      const notices = await download.blob.text();
      for (const text of Object.values(payload.licenses)) assert.ok(notices.includes(text));
      if (!current.sourcePackages.heic.url) assert.match(get('licensesSourceStatus').textContent, /Локальная сборка/);
    }
  } finally { global.document = oldDocument; global.fetch = oldFetch; }
  console.log('PASS actual license controller: offline TXT, configured links, local status, unsafe link rejection (mock DOM)');

  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'viewer-source-packages-'));
  const run = args => spawnSync(process.execPath, [path.join(root, 'vendor/sources/heic/relink.mjs'), ...args], { encoding: 'utf8' });
  try {
    const original = path.join(temp, 'original.html'), decoder = path.join(temp, 'modified.js'), sources = path.join(temp, 'modified-sources.zip');
    // Start with a configured source URL to verify relink never keeps a stale URL.
    const configuredHtml = html.replace(/(id="embedded-codecs">)[\s\S]*?(<\/script>)/, (_, a, b) => a + JSON.stringify(released).replace(/</g, '\\u003c') + b);
    fs.writeFileSync(original, configuredHtml);
    fs.writeFileSync(decoder, decodeScript(payload.scripts['vendor/heic-decoder.js']) + '\n// Relink packaging test only; compiled library is unchanged.\n');
    fs.writeFileSync(sources, heic.bytes);
    for (const url of [null, 'https://example.invalid/modified/modified-sources.zip']) {
      const output = path.join(temp, url ? 'public.html' : 'local.html');
      const result = run([original, decoder, sources, output, ...(url ? ['--source-url=' + url] : [])]);
      assert.equal(result.status, 0, result.stderr);
      const changedHtml = fs.readFileSync(output, 'utf8'), changed = payloadOf(changedHtml);
      assert.ok(!changed.sourceArchives && !changed.sources && !changedHtml.includes(heic.bytes.toString('base64')));
      assert.equal(changed.sourcePackages.heic.url, url);
      assert.equal(changed.sourcePackages.heic.name, 'modified-sources.zip');
      assert.equal(changed.sourcePackages.heic.sha256, sha(heic.bytes));
      assert.equal(changed.scripts['vendor/heic-decoder.js'].encoding, 'gzip-base64');
      assert.equal(decodeScript(changed.scripts['vendor/heic-decoder.js']), fs.readFileSync(decoder, 'utf8'));
      assert.equal(changed.manifest.files.find(i => i.file === 'heic-decoder.js').sha256, sha(fs.readFileSync(decoder)));
      for (const [name, script] of Object.entries(payload.scripts)) if (name !== 'vendor/heic-decoder.js') assert.deepEqual(changed.scripts[name], script);
      assert.deepEqual(changed.sourcePackages.gifenc, released.sourcePackages.gifenc);
      assert.deepEqual(changed.licenses, payload.licenses);
      assert.notEqual(run([original, decoder, sources, output]).status, 0, 'existing output must not be overwritten');
    }
    assert.notEqual(run([original, decoder, sources, original]).status, 0);
    assert.equal(fs.readFileSync(original, 'utf8'), configuredHtml);
    const plainInput = path.join(temp, 'plain.html'), plainOutput = path.join(temp, 'plain-result.html');
    const plain = structuredClone(released);
    plain.scripts['vendor/heic-decoder.js'] = decodeScript(plain.scripts['vendor/heic-decoder.js']);
    fs.writeFileSync(plainInput, html.replace(/(id="embedded-codecs">)[\s\S]*?(<\/script>)/, (_, a, b) => a + JSON.stringify(plain).replace(/</g, '\\u003c') + b));
    const plainResult = run([plainInput, decoder, sources, plainOutput]);
    assert.equal(plainResult.status, 0, plainResult.stderr);
    assert.equal(payloadOf(fs.readFileSync(plainOutput, 'utf8')).scripts['vendor/heic-decoder.js'], fs.readFileSync(decoder, 'utf8'));
    const bad = path.join(temp, 'bad.zip'), output = path.join(temp, 'bad.html');
    fs.writeFileSync(bad, heic.bytes.subarray(0, 60));
    assert.notEqual(run([original, decoder, bad, output]).status, 0);
    assert.ok(!fs.existsSync(output));
    const corrupt = [...heic.entries].map(([name, bytes]) => ({ name, bytes: name.includes('/upstream/') ? Buffer.concat([bytes, Buffer.from('tampered')]) : bytes }));
    fs.writeFileSync(bad, sourceZip(corrupt));
    const rejected = run([original, decoder, bad, output]);
    assert.notEqual(rejected.status, 0);
    assert.match(rejected.stderr, /Source archive integrity check failed/);
    assert.ok(!fs.existsSync(output));
  } finally {
    // Only this test's own flat temporary directory; no recursive deletion.
    assert.equal(path.dirname(temp), path.resolve(os.tmpdir()));
    assert.ok(path.basename(temp).startsWith('viewer-source-packages-'));
    for (const name of ['original.html', 'modified.js', 'modified-sources.zip', 'local.html', 'public.html', 'bad.zip', 'bad.html', 'plain.html', 'plain-result.html']) {
      const file = path.join(temp, name); if (fs.existsSync(file)) fs.unlinkSync(file);
    }
    fs.rmdirSync(temp);
  }
  console.log('PASS relink: separate source metadata, stale URL cleared, explicit replacement URL, intact other codecs/notices, corrupt input rejected, original preserved');
})().catch(error => { console.error(error); process.exitCode = 1; });
