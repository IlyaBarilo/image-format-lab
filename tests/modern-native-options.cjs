const assert = require('node:assert/strict');
const createCodec = require('../vendor/modern-codecs.js');

(async () => {
  const codec = await createCodec({ print() {}, printErr() {} });
  const width = 160, height = 112, pixels = new Uint8Array(width * height * 4);
  let seed = 0x12345678;
  for (let i = 0; i < pixels.length; i += 4) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    pixels[i] = (seed >>> 16) & 255;
    pixels[i + 1] = (seed >>> 8) & 255;
    pixels[i + 2] = seed & 255;
    pixels[i + 3] = 255;
  }
  const input = codec._malloc(pixels.length);
  assert.ok(input);
  codec.HEAPU8.set(pixels, input);
  function encode(kind, method, effort) {
    const started = performance.now();
    const status = codec._viewer_modern_encode(input, pixels.length, width, height, 85, kind, method, effort);
    assert.equal(status, 0, codec.UTF8ToString(codec._viewer_modern_error()));
    const bytes = codec.HEAPU8.slice(codec._viewer_modern_output(), codec._viewer_modern_output() + codec._viewer_modern_output_size());
    assert.ok(bytes.length > 20);
    return { bytes, elapsedMs: Math.round(performance.now() - started) };
  }
  function checkLossless(encoded, format) {
    const at = codec._malloc(encoded.bytes.length);
    try {
      codec.HEAPU8.set(encoded.bytes, at);
      assert.equal(codec._viewer_modern_decode(at, encoded.bytes.length, format), 0, codec.UTF8ToString(codec._viewer_modern_error()));
      assert.deepEqual(codec.HEAPU8.slice(codec._viewer_modern_output(), codec._viewer_modern_output() + pixels.length), pixels);
    } finally { codec._viewer_modern_clear(); codec._free(at); }
  }
  try {
    const webpFast = encode(1, 0, 5), webpSlow = encode(1, 6, 5);
    checkLossless(webpFast, 1); checkLossless(webpSlow, 1);
    assert.notDeepEqual(webpFast.bytes, webpSlow.bytes, 'WebP method must change the actual file');
    const jxlFast = encode(3, 4, 1), jxlSlow = encode(3, 4, 8), jxlMax = encode(3, 4, 10);
    checkLossless(jxlFast, 2); checkLossless(jxlSlow, 2); checkLossless(jxlMax, 2);
    assert.notDeepEqual(jxlFast.bytes, jxlSlow.bytes, 'JPEG XL effort must change the actual file');
    assert.notEqual(codec._viewer_modern_encode(input, pixels.length, width, height, 85, 1, 7, 5), 0);
    assert.notEqual(codec._viewer_modern_encode(input, pixels.length, width, height, 85, 3, 4, 0), 0);
    console.log('PASS real WebP/JPEG XL files change with encoder effort and decode losslessly',
      JSON.stringify({ webp: [[0, webpFast.bytes.length, webpFast.elapsedMs], [6, webpSlow.bytes.length, webpSlow.elapsedMs]],
        jxl: [[1, jxlFast.bytes.length, jxlFast.elapsedMs], [8, jxlSlow.bytes.length, jxlSlow.elapsedMs], [10, jxlMax.bytes.length, jxlMax.elapsedMs]] }));
  } finally { codec._viewer_modern_clear(); codec._free(input); }
})().catch(error => { console.error(error); process.exitCode = 1; });
