const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const pako = require('../vendor/pako-2.1.0.min.js');

function makeProfile(matrix) {
  const profile = Buffer.alloc(384);
  profile.writeUInt32BE(profile.length, 0);
  profile.writeUInt32BE(0x04300000, 8);
  profile.write('mntr', 12); profile.write('RGB ', 16); profile.write('XYZ ', 20);
  profile.write('acsp', 36);
  profile.writeUInt32BE(6, 128);
  const names = ['rXYZ', 'gXYZ', 'bXYZ', 'rTRC', 'gTRC', 'bTRC'];
  names.forEach((name, index) => {
    const offset = 204 + (index < 3 ? index * 20 : 60 + (index - 3) * 40);
    profile.write(name, 132 + index * 12);
    profile.writeUInt32BE(offset, 136 + index * 12);
    profile.writeUInt32BE(index < 3 ? 20 : 40, 140 + index * 12);
    if (index < 3) {
      profile.write('XYZ ', offset);
      matrix[index].forEach((value, row) => profile.writeInt32BE(Math.round(value * 65536), offset + 8 + row * 4));
    } else {
      profile.write('para', offset);
      profile.writeUInt16BE(4, offset + 8);
      [2.4, 1 / 1.055, 0.055 / 1.055, 1 / 12.92, 0.04045, 0, 0].forEach((value, i) =>
        profile.writeInt32BE(Math.round(value * 65536), offset + 12 + i * 4));
    }
  });
  return new Uint8Array(profile);
}

(async () => {
  const { parseIccSdr, prepareIccSdr } = await import('../src/core/icc-sdr.mjs');
  const { createPixelBuffer } = await import('../src/core/pixel-buffer.mjs');
  const { encodePng, decodePng } = await import('../src/core/png.mjs');
  const fixture = new Uint8Array(fs.readFileSync(path.join(__dirname, 'fixtures/srgb-test.icc')));
  assert.equal(parseIccSdr(fixture).matrix.length, 3, 'real sRGB profile is supported');
  const gray = createPixelBuffer({ width: 1, height: 1, sampleType: 'uint16', bitDepth: 16,
    data: new Uint16Array([32768, 32768, 32768, 65535]) });
  const grayManaged = await prepareIccSdr(gray, fixture);
  for (const value of grayManaged.pixelBuffer.data.subarray(0, 3)) assert.ok(Math.abs(value - 32768) < 256);
  const p3 = makeProfile([
    [0.515102, 0.241182, -0.001049],
    [0.291965, 0.692236, 0.041882],
    [0.157153, 0.066582, 0.784378]
  ]);
  const source = createPixelBuffer({ width: 2, height: 1, sampleType: 'uint16', bitDepth: 16,
    data: new Uint16Array([40000, 20000, 10000, 32768, 32768, 32768, 32768, 65535]) });
  const before = source.data.slice();
  const result = await prepareIccSdr(source, p3);
  assert.equal(result.pixelBuffer.colorSpace, 'srgb');
  assert.equal(result.nativePixelBuffer.data, source.data);
  assert.deepEqual(source.data, before, 'conversion does not modify exact source samples');
  assert.equal(result.pixelBuffer.data[3], 32768);
  assert.equal(result.pixelBuffer.data[7], 65535);
  for (const value of result.pixelBuffer.data.subarray(4, 7)) assert.ok(Math.abs(value - 32768) < 64);
  assert.ok(result.pixelBuffer.data.slice(0, 3).some((value, i) => value !== before[i]));
  for (const value of result.pixelBuffer.data) assert.ok(value >= 0 && value <= 65535);

  const blob = encodePng(source, 16, pako, { iccProfile: p3 });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const encoded = Buffer.from(bytes), chunkName = encoded.indexOf('iCCP');
  assert.ok(chunkName > 12);
  const payload = encoded.subarray(chunkName + 4, chunkName + 4 + encoded.readUInt32BE(chunkName - 4));
  assert.equal(payload.subarray(0, 9).toString('ascii'), 'IFL ICC\0\0');
  assert.deepEqual(zlib.inflateSync(payload.subarray(9)), Buffer.from(p3));
  assert.throws(() => decodePng(bytes, pako), /ICC\/HDR-преобразование/);
  const decoded = decodePng(bytes, pako, { withIcc: true });
  assert.deepEqual(decoded.pixels.data, before);
  assert.deepEqual(decoded.iccProfile, p3);
  const reread = await prepareIccSdr(decoded.pixels, decoded.iccProfile);
  assert.deepEqual(reread.pixelBuffer.data, result.pixelBuffer.data);
  const { computePixelMetrics } = await import('../src/core/metrics.mjs');
  const sameVisibleSrgb = createPixelBuffer({ ...result.pixelBuffer,
    data: result.pixelBuffer.data.slice(), colorSpace: 'srgb' });
  assert.equal(computePixelMetrics(result.pixelBuffer, sameVisibleSrgb).psnr, Infinity);
  assert.ok(source.data.some((value, i) => value !== sameVisibleSrgb.data[i]));

  const oldWindow = global.window, oldImageData = global.ImageData;
  global.window = { pako };
  global.ImageData = class ImageData {
    constructor(data, width, height) { this.data = data; this.width = width; this.height = height; this.colorSpace = 'srgb'; }
  };
  try {
    const { createPng } = await import('../src/services/png.mjs');
    const { decodePngFile } = createPng({}, { loadScript: async () => {} });
    const opened = await decodePngFile(blob, true);
    assert.deepEqual(opened.nativePixelBuffer.data, before);
    assert.deepEqual(opened.pixelBuffer.data, result.pixelBuffer.data);
    assert.deepEqual(opened.iccProfile, p3);
    assert.notEqual(opened.imageData.data[0], Math.round(before[0] / 65535 * 255));

    const { createEncode } = await import('../src/services/encode.mjs');
    const sourceForSave = { ...opened, canvas: {}, size: blob.size, file: blob };
    const calls = [];
    const { encodeOne } = createEncode({}, {
      outputDimensionsForConfig: () => ({ width: 2, height: 1 }),
      outputSourceForConfig: () => sourceForSave,
      encodeExactPng: async (pixels, depth, options) => {
        calls.push({ pixels, depth, options }); return encodePng(pixels, depth, pako, options);
      },
      loadOptionalCodec: async () => ({ encode: async (...args) => {
        calls.push({ args }); return new Blob([1]);
      } }),
      withEncodedMeta: encoded => encoded
    });
    const pngSaved = await encodeOne({ format: 'png', pngDepth: '16' }, sourceForSave);
    assert.equal(calls[0].pixels.data, opened.nativePixelBuffer.data);
    assert.equal(calls[0].options.iccProfile, opened.iccProfile);
    assert.deepEqual(decodePng(new Uint8Array(await pngSaved.blob.arrayBuffer()), pako, { withIcc: true }).pixels.data, before);
    await encodeOne({ format: 'jp2', quality: 100 }, sourceForSave);
    assert.equal(calls[1].args[0].data, opened.nativePixelBuffer.data);
    assert.equal(calls[1].args[3], opened.iccProfile);
    await encodeOne({ format: 'j2k', quality: 100 }, sourceForSave);
    assert.equal(calls[2].args[0].data, opened.pixelBuffer.data);
    assert.equal(calls[2].args[3], null);
  } finally { global.window = oldWindow; global.ImageData = oldImageData; }
  assert.throws(() => parseIccSdr(p3.subarray(0, 60)), /ICC:/);
  const unsupported = p3.slice(); unsupported.fill(0x4c, 16, 20);
  await assert.rejects(prepareIccSdr(source, unsupported), /RGB-профили/);
  console.log('PASS ICC matrix/TRC SDR comparison, exact uint16 ownership, PNG/JP2 paths and explicit rejection');
})().catch(error => { console.error(error); process.exitCode = 1; });
