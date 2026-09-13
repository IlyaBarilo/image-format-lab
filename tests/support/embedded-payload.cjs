const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { codecNames, licenseNames } = require('../../scripts/vendor-files.cjs');
const { decodeScript } = require('./codec-payload.cjs');

const packedCodecNames = ['heic-decoder.js', 'jpeg-decoder.js', 'modern-codecs.js', 'bmp-decoder.js', 'tiff-codec.js'].map(name => 'vendor/' + name).sort();

function assertEmbeddedPayload(payload, root) {
  assert.deepEqual(Object.keys(payload.scripts).sort(), codecNames.map(name => 'vendor/' + name).sort(), 'include every declared codec, with no extra scripts');
  assert.deepEqual(Object.keys(payload.licenses).sort(), [...licenseNames].sort(), 'include every declared license, with no extra texts');
  assert.deepEqual(Object.entries(payload.scripts).filter(([, entry]) => entry?.encoding === 'gzip-base64').map(([name]) => name).sort(), packedCodecNames, 'pack all five WASM modules');
  for (const [name, entry] of Object.entries(payload.scripts)) {
    if (entry?.encoding === 'gzip-base64') assert.equal(Buffer.from(entry.data, 'base64')[9], 255, 'gzip OS must be platform-neutral: ' + name);
    assert.equal(decodeScript(entry), fs.readFileSync(path.join(root, name), 'utf8'), 'exact codec bytes: ' + name);
  }
  for (const [name, license] of Object.entries(payload.licenses)) assert.equal(license, fs.readFileSync(path.join(root, 'vendor', name), 'utf8'), 'exact license text: ' + name);
  assert.deepEqual(payload.components, JSON.parse(fs.readFileSync(path.join(root, 'vendor/components.json'), 'utf8')), 'embed the complete component registry');
}

module.exports = { assertEmbeddedPayload, packedCodecNames };

if (require.main === module) {
  const root = path.resolve(__dirname, '../..');
  const html = fs.readFileSync(path.join(root, 'image-format-lab.html'), 'utf8');
  const payload = JSON.parse(html.match(/id="embedded-codecs">([\s\S]*?)<\/script>/)[1]);
  assertEmbeddedPayload(payload, root);
  console.log('PASS embedded codec inventory, compression, exact bytes, license texts and component registry');
}
