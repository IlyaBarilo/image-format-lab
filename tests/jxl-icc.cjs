const assert = require('node:assert/strict');
const createCodec = require('../vendor/modern-codecs.js');

(async () => {
  const { prepareIccSdr, parseIccSdr } = await import('../src/core/icc-sdr.mjs');
  const { createIccP3Sample } = await import('../src/core/reference-samples.mjs');
  const builtInProfile = createIccP3Sample().iccProfile;
  parseIccSdr(builtInProfile);
  const profile = builtInProfile;
  parseIccSdr(profile);
  const codec = await createCodec({ print() {}, printErr() {} });
  const width = 3, height = 2;
  const rgba16 = new Uint16Array([
    40001, 20003, 10007, 0, 32769, 12345, 43210, 65535, 1, 65534, 256, 32768,
    65535, 1, 30001, 65535, 40500, 20500, 10500, 123, 40000, 40000, 40000, 65535
  ]);
  const rgba8 = Uint8Array.from(rgba16, value => Math.round(value / 257));
  for (const [depth, bytes] of [[16, new Uint8Array(rgba16.buffer)], [8, rgba8]]) {
    const input = codec._malloc(bytes.length), icc = codec._malloc(profile.length);
    assert.ok(input && icc);
    try {
      codec.HEAPU8.set(bytes, input);
      codec.HEAPU8.set(profile, icc);
      assert.equal(codec._viewer_modern_encode_icc(input, bytes.length, width, height,
        depth, 1, icc, profile.length), 0, codec.UTF8ToString(codec._viewer_modern_error()));
      const encoded = codec.HEAPU8.slice(codec._viewer_modern_output(),
        codec._viewer_modern_output() + codec._viewer_modern_output_size());
      assert.ok(encoded.length > 20);
      const compressed = codec._malloc(encoded.length);
      assert.ok(compressed);
      try {
        codec.HEAPU8.set(encoded, compressed);
        assert.equal(codec._viewer_modern_decode(compressed, encoded.length, 2), 0,
          codec.UTF8ToString(codec._viewer_modern_error()));
        assert.equal(codec._viewer_modern_depth(), depth);
        assert.deepEqual(codec.HEAPU8.slice(codec._viewer_modern_output(),
          codec._viewer_modern_output() + codec._viewer_modern_output_size()), bytes);
        assert.equal(codec._viewer_modern_icc_size(), profile.length);
        assert.deepEqual(codec.HEAPU8.slice(codec._viewer_modern_icc(),
          codec._viewer_modern_icc() + profile.length), profile);
      } finally { codec._viewer_modern_clear(); codec._free(compressed); }
    } finally { codec._viewer_modern_clear(); codec._free(input); codec._free(icc); }
  }
  const native = {width,height,data:rgba16,sampleType:'uint16',bitDepth:16};
  const managed = await prepareIccSdr(native,profile);
  assert.deepEqual(managed.nativePixelBuffer.data,rgba16);
  assert.notDeepEqual(managed.pixelBuffer.data,rgba16);
  assert.equal(managed.pixelBuffer.colorSpace,'srgb');
  const damaged = profile.slice(); damaged.set([67, 77, 89, 75], 16);
  await assert.rejects(prepareIccSdr(native,damaged),/RGB-профили/);
  console.log('PASS JPEG XL ICC keeps original RGBA8/16 and profile, separate SDR preview and rejects unsupported ICC');
})().catch(error => { console.error(error); process.exitCode = 1; });
