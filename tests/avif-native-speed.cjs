const assert = require('node:assert/strict');
const createCodec = require('../vendor/heic-decoder.js');

(async () => {
  const codec = await createCodec({ print() {}, printErr() {} });
  const width = 64, height = 48, pixels = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4;
    pixels[i] = (x * 17 + y * 3) & 255;
    pixels[i + 1] = (x * 5 + y * 19) & 255;
    pixels[i + 2] = (x * y * 7) & 255;
    pixels[i + 3] = 255;
  }
  const pointer = codec._malloc(pixels.length);
  assert.ok(pointer);
  codec.HEAPU8.set(pixels, pointer);
  function encode(speed) {
    const started = performance.now();
    const status = codec._viewer_avif_encode(pointer, pixels.length, width, height, 75, speed);
    assert.equal(status, 0, codec.UTF8ToString(codec._viewer_heic_error()));
    const bytes = codec.HEAPU8.slice(codec._viewer_heic_output(), codec._viewer_heic_output() + codec._viewer_heic_output_size());
    assert.ok(bytes.length > 20);
    assert.equal(Buffer.from(bytes).toString('ascii', 8, 12), 'avif');
    return { bytes, elapsedMs: Math.round(performance.now() - started) };
  }
  function checkDecodes(encoded) {
    const at = codec._malloc(encoded.bytes.length);
    try {
      codec.HEAPU8.set(encoded.bytes, at);
      assert.equal(codec._viewer_heic_decode(at, encoded.bytes.length), 0, codec.UTF8ToString(codec._viewer_heic_error()));
      assert.deepEqual([codec._viewer_heic_width(), codec._viewer_heic_height()], [width, height]);
    } finally { codec._viewer_heic_clear(); codec._free(at); }
  }
  try {
    const slowest = encode(0), slow = encode(3), before = encode(6), fast = encode(9);
    for (const result of [slowest, slow, before, fast]) checkDecodes(result);
    assert.notDeepEqual(slow.bytes, fast.bytes, 'AVIF speed must change the actual file');
    assert.notEqual(codec._viewer_avif_encode(pointer, pixels.length, width, height, 75, -1), 0);
    assert.notEqual(codec._viewer_avif_encode(pointer, pixels.length, width, height, 75, 10), 0);
    assert.equal(codec._viewer_heic_encode(pointer, pixels.length, width, height, 75), 0,
      codec.UTF8ToString(codec._viewer_heic_error()));
    console.log('PASS AVIF speeds produce different valid files; HEIC ABI remains unchanged',
      JSON.stringify([[0, slowest.bytes.length, slowest.elapsedMs], [3, slow.bytes.length, slow.elapsedMs], [6, before.bytes.length, before.elapsedMs], [9, fast.bytes.length, fast.elapsedMs]]));
  } finally { codec._viewer_heic_clear(); codec._free(pointer); }
})().catch(error => { console.error(error); process.exitCode = 1; });
