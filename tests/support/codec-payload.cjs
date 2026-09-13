// Independent decoder for release tests; runtime uses the supplied pako instead.
const assert = require('node:assert/strict');
const { gunzipSync } = require('node:zlib');
function decodeScript(entry) {
  if (typeof entry === 'string') return entry;
  assert.equal(entry.encoding, 'gzip-base64');
  const bytes = gunzipSync(Buffer.from(entry.data, 'base64'));
  assert.equal(bytes.length, entry.bytes);
  return bytes.toString('utf8');
}
module.exports = { decodeScript };
