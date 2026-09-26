const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function segment(marker, payload) {
  const length = payload.length + 2;
  return Buffer.concat([Buffer.from([0xff, marker, length >>> 8, length & 255]), payload]);
}
function addMetadata(jpeg) {
  const exif = Buffer.from('45786966000049492a0008000000000000000000', 'hex');
  const icc = Buffer.concat([Buffer.from('ICC_PROFILE\0', 'ascii'), Buffer.from([1, 1]), fs.readFileSync('tests/fixtures/srgb-test.icc')]);
  const comment = Buffer.from('synthetic JPEG reconstruction test', 'ascii');
  return Buffer.concat([jpeg.subarray(0, 2), segment(0xe1, exif), segment(0xe2, icc), segment(0xfe, comment), jpeg.subarray(2)]);
}
function convert(codec, operation, bytes) {
  const at = codec._malloc(bytes.length);
  assert.ok(at);
  try {
    codec.HEAPU8.set(bytes, at);
    const status = operation === 'encode'
      ? codec._viewer_modern_jpeg_to_jxl(at, bytes.length)
      : codec._viewer_modern_jxl_to_jpeg(at, bytes.length);
    if (status) return { error: codec.UTF8ToString(codec._viewer_modern_error()) };
    const start = codec._viewer_modern_output(), size = codec._viewer_modern_output_size();
    assert.ok(start > 0 && size > 0);
    return { bytes: Buffer.from(codec.HEAPU8.slice(start, start + size)) };
  } finally { codec._viewer_modern_clear(); codec._free(at); }
}
(async () => {
  const { encodeJpegPixels } = await import('../src/core/jpeg-encode.mjs');
  const { reconstructionName, sameBlobBytes } = await import('../src/core/jpeg-reconstruction.mjs');
  assert.equal(reconstructionName('picture.JPEG', 'jpeg-to-jxl'), 'picture-jpeg-reconstruction.jxl');
  assert.equal(reconstructionName('picture.jxl', 'jxl-to-jpeg'), 'picture-restored.jpg');
  assert.equal(await sameBlobBytes(new Blob([Uint8Array.of(1, 2, 3)]), new Blob([Uint8Array.of(1, 2, 3)])), true);
  assert.equal(await sameBlobBytes(new Blob([Uint8Array.of(1, 2, 3)]), new Blob([Uint8Array.of(1, 2, 4)])), false);
  assert.equal(await sameBlobBytes(new Blob([Uint8Array.of(1, 2)]), new Blob([Uint8Array.of(1, 2, 3)])), false);
  const chunks = new Uint8Array(1024 * 1024 + 3), changed = chunks.slice();
  changed[chunks.length - 1] = 1;
  assert.equal(await sameBlobBytes(new Blob([chunks]), new Blob([changed])), false);

  const jpegCodec = await require('../vendor/jpeg-decoder.js')({ print() {}, printErr() {} });
  const modern = await require('../vendor/modern-codecs.js')({ print() {}, printErr() {} });
  const width = 91, height = 67;
  const data = Uint8ClampedArray.from({ length: width * height * 4 }, (_, i) => i % 4 === 3 ? 255 : (i * 29 + Math.floor(i / 4) * 13) & 255);
  const image = { width, height, data };
  for (const progressive of [false, true]) {
    const source = addMetadata(Buffer.from(encodeJpegPixels(jpegCodec, image,
      { quality: 86, jpegSubsampling: progressive ? '444' : '420', jpegProgressive: progressive })));
    const packed = convert(modern, 'encode', source);
    assert.ok(packed.bytes, packed.error);
    assert.deepEqual(packed.bytes.subarray(4, 8), Buffer.from('JXL '));
    const restored = convert(modern, 'decode', packed.bytes);
    assert.ok(restored.bytes, restored.error);
    assert.deepEqual(restored.bytes, source, 'original JPEG bytes, including metadata, must be preserved');
    assert.equal(await sameBlobBytes(new Blob([source]), new Blob([restored.bytes])), true);
  }
  assert.match(convert(modern, 'encode', Buffer.from([0xff, 0xd8, 0xff, 0xd9])).error, /cannot|failed|invalid/i);
  assert.match(convert(modern, 'decode', Buffer.from([0xff, 0x0a, 0, 0])).error, /invalid|truncated|no original/i);

  const pixels = new Uint8Array(width * height * 4);
  pixels.set(data);
  const at = modern._malloc(pixels.length);
  modern.HEAPU8.set(pixels, at);
  assert.equal(modern._viewer_modern_encode(at, pixels.length, width, height, 85, 3, 4, 5), 0);
  const pixelJxl = Buffer.from(modern.HEAPU8.slice(modern._viewer_modern_output(), modern._viewer_modern_output() + modern._viewer_modern_output_size()));
  modern._viewer_modern_clear(); modern._free(at);
  assert.match(convert(modern, 'decode', pixelJxl).error, /no original|metadata/i,
    'pixel-lossless JXL must not silently claim JPEG reconstruction');

  const messages = [];
  const self = { postMessage(message) { messages.push(message); } };
  vm.runInNewContext(fs.readFileSync('src/workers/modern.worker.mjs', 'utf8'),
    { self, ViewerModernModule: require('../vendor/modern-codecs.js') });
  await self.onmessage({ data: { type: 'init' } });
  assert.equal(messages.pop().type, 'ready');
  const jpeg = Buffer.from(encodeJpegPixels(jpegCodec, image, { quality: 82 }));
  await self.onmessage({ data: { type: 'jpeg-to-jxl', id: 1, buffer: Uint8Array.from(jpeg).buffer } });
  const packed = messages.pop();
  assert.equal(packed.type, 'transcoded', packed.message);
  await self.onmessage({ data: { type: 'jxl-to-jpeg', id: 2, buffer: packed.buffer } });
  const restored = messages.pop();
  assert.equal(restored.type, 'transcoded', restored.message);
  assert.deepEqual(Buffer.from(restored.buffer), jpeg);
  console.log('PASS JPEG XL restores baseline/progressive JPEG and metadata byte for byte; unsupported files fail explicitly');
  console.log('PASS JPEG XL reconstruction travels through the Worker without RGBA and stays separate from pixel-lossless JXL');
})().catch(error => { console.error(error); process.exitCode = 1; });
