const assert = require('node:assert/strict');
const createCodec = require('../vendor/modern-codecs.js');

(async () => {
  const { resolvedJxlDepth } = await import('../src/core/modern-options.mjs');
  const codec = await createCodec({ print() {}, printErr() {} });
  const width = 13, height = 7, data = new Uint16Array(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = (i * 1009 + 1) & 65535;
    data[i + 1] = (i * 379 + 256) & 65535;
    data[i + 2] = (i * 73 + 65534) & 65535;
    data[i + 3] = i % 12 === 0 ? 0 : i % 20 === 0 ? 32769 : 65535;
  }
  const source = { sampleType: 'uint16', bitDepth: 16 };
  assert.equal(resolvedJxlDepth('auto', source), 16);
  assert.equal(resolvedJxlDepth('8', source), 8);
  assert.equal(resolvedJxlDepth('16', {sampleType:'uint8',bitDepth:8}), 16);
  assert.throws(() => resolvedJxlDepth('12', source), RangeError);
  const bytes = new Uint8Array(data.buffer), input = codec._malloc(bytes.length);
  assert.ok(input);
  try {
    codec.HEAPU8.set(bytes, input);
    assert.equal(codec._viewer_modern_encode16(input, bytes.length, width, height, 1), 0,
      codec.UTF8ToString(codec._viewer_modern_error()));
    const encoded = codec.HEAPU8.slice(codec._viewer_modern_output(),
      codec._viewer_modern_output() + codec._viewer_modern_output_size());
    assert.ok(encoded.length > 20);
    const compressed = codec._malloc(encoded.length);
    assert.ok(compressed);
    try {
      codec.HEAPU8.set(encoded, compressed);
      assert.equal(codec._viewer_modern_decode(compressed, encoded.length, 2), 0,
        codec.UTF8ToString(codec._viewer_modern_error()));
      assert.equal(codec._viewer_modern_depth(), 16);
      assert.equal(codec._viewer_modern_output_size(), bytes.length);
      assert.deepEqual(codec.HEAPU8.slice(codec._viewer_modern_output(),
        codec._viewer_modern_output() + bytes.length), bytes);
    } finally { codec._viewer_modern_clear(); codec._free(compressed); }
    assert.notEqual(codec._viewer_modern_encode16(input, bytes.length - 2, width, height, 1), 0);
  } finally { codec._viewer_modern_clear(); codec._free(input); }
  console.log('PASS JPEG XL lossless preserves every RGBA16 value, including transparent RGB');
})().catch(error => { console.error(error); process.exitCode = 1; });
