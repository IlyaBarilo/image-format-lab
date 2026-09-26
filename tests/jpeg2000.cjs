const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Worker } = require('node:worker_threads');
const createCodec = require('../vendor/jpeg2000-codec.js');

const signature = Buffer.from('0000000c6a5020200d0a870a', 'hex');

async function main() {
  const { FORMAT_OPTIONS, reportFormatConfig } = await import('../src/core/format-options.mjs');
  const { createDecode } = await import('../src/services/decode.mjs');
  assert.ok(FORMAT_OPTIONS.some(option => option.value === 'jp2'));
  assert.ok(FORMAT_OPTIONS.some(option => option.value === 'j2k'));
  assert.equal(reportFormatConfig({ format: 'jp2', quality: 100 }).formatMode, 'lossless');
  assert.equal(reportFormatConfig({ format: 'j2k', quality: 80 }).formatMode, 'lossy');
  const { fileKind } = createDecode({}, {});
  assert.equal(fileKind({ name: 'image.jp2' }), 'jp2');
  assert.equal(fileKind({ name: 'image.j2c' }), 'j2k');
  const { createEncode } = await import('../src/services/encode.mjs');
  const source = { width: 2, height: 1, imageData: { width: 2, height: 1,
    data: new Uint8ClampedArray([1, 2, 3, 255, 4, 5, 6, 255]) },
    pixelBuffer: { width: 2, height: 1, sampleType: 'uint16', bitDepth: 16,
      data: new Uint16Array([257, 514, 771, 65535, 1028, 1285, 1542, 65535]) },
    iccProfile: new Uint8Array([1, 2, 3]) };
  source.nativePixelBuffer = source.pixelBuffer;
  const calls = [];
  const deps = { outputSourceForConfig: () => source,
    loadOptionalCodec: async () => ({ encode: async (...args) => {
      calls.push(args); return new Blob([signature], { type: 'image/jp2' });
    } }),
    withEncodedMeta: (encoded, prepared) => ({ ...encoded, prepared }) };
  const { encodeOne } = createEncode({}, deps);
  const saved = await encodeOne({ format: 'jp2', quality: 100 }, source);
  assert.equal(saved.prepared, source);
  assert.equal(calls[0][0], source.pixelBuffer);
  assert.deepEqual([...calls[0][3]], [1, 2, 3]);
  assert.equal(saved.precisionNote, '16 бит/канал · показ 8 бит');
  const codec = await createCodec({ print() {}, printErr() {} });
  const cases = [
    { width: 17, height: 9, depth: 8, channels: 1, jp2: 1 },
    { width: 17, height: 9, depth: 8, channels: 3, jp2: 0 },
    { width: 17, height: 9, depth: 8, channels: 4, jp2: 1 },
    { width: 17, height: 9, depth: 16, channels: 3, jp2: 1, icc: true },
    { width: 17, height: 9, depth: 16, channels: 4, jp2: 1 },
    { width: 17, height: 9, depth: 16, channels: 4, jp2: 1, icc: true },
    { width: 96, height: 48, depth: 8, channels: 3, jp2: 1, ratio: 10 }
  ];
  for (const item of cases) {
    const { width, height, depth, channels, jp2 } = item;
    const input = new Uint16Array(width * height * channels);
    for (let i = 0; i < input.length; i++) input[i] =
      channels === 4 && i % channels === 3 ? (i * 53) % (depth === 16 ? 65536 : 256) :
        (i * 431 + 17) % (depth === 16 ? 65536 : 256);
    const profile = item.icc ? fs.readFileSync(path.join(__dirname, 'fixtures/srgb-test.icc')) : null;
    const allocations = [];
    const own = length => { const pointer = codec._malloc(length); assert.ok(pointer); allocations.push(pointer); return pointer; };
    const inputPointer = own(input.byteLength);
    codec.HEAPU8.set(new Uint8Array(input.buffer), inputPointer);
    const profilePointer = profile ? own(profile.length) : 0;
    if (profile) codec.HEAPU8.set(profile, profilePointer);
    const resultPointer = own(4), lengthPointer = own(4);
    let encodedPointer = 0, decodedPointer = 0, decodedProfilePointer = 0;
    try {
      assert.equal(codec._eval_encode(inputPointer, width, height, depth, channels, jp2, item.ratio || 0,
        profilePointer, profile?.length || 0, resultPointer, lengthPointer), 1, 'encode ' + JSON.stringify(item));
      encodedPointer = codec.HEAPU32[resultPointer >>> 2];
      const encodedLength = codec.HEAP32[lengthPointer >>> 2];
      const encoded = codec.HEAPU8.slice(encodedPointer, encodedPointer + encodedLength);
      assert.ok(encodedLength > 32);
      if (jp2) assert.deepEqual(Buffer.from(encoded.subarray(0, 12)), signature);
      else assert.deepEqual([...encoded.subarray(0, 2)], [0xff, 0x4f]);
      const [out, w, h, bits, components, alpha, iccLength, iccOut] =
        Array.from({ length: 8 }, () => own(4));
      assert.equal(codec._eval_decode(encodedPointer, encodedLength, jp2,
        out, w, h, bits, components, alpha, iccLength, iccOut), 1, 'decode ' + JSON.stringify(item));
      decodedPointer = codec.HEAPU32[out >>> 2];
      decodedProfilePointer = codec.HEAPU32[iccOut >>> 2];
      assert.deepEqual([codec.HEAP32[w >>> 2], codec.HEAP32[h >>> 2], codec.HEAP32[bits >>> 2], codec.HEAP32[components >>> 2]],
        [width, height, depth, channels]);
      const decoded = new Uint16Array(codec.HEAPU8.buffer.slice(decodedPointer,
        decodedPointer + input.byteLength));
      if (item.ratio) assert.ok(decoded.some((value, index) => value !== input[index]), 'lossy output must change samples');
      else assert.deepEqual(decoded, input);
      if (channels === 4) assert.equal(codec.HEAP32[alpha >>> 2], 1);
      if (profile) {
        const size = codec.HEAP32[iccLength >>> 2];
        assert.equal(size, profile.length);
        assert.deepEqual(Buffer.from(codec.HEAPU8.slice(decodedProfilePointer,
          decodedProfilePointer + size)), profile);
      }
      assert.equal(codec._eval_decode(encodedPointer, 4, jp2,
        out, w, h, bits, components, alpha, iccLength, iccOut), 0, 'truncated input');
    } finally {
      if (decodedProfilePointer) codec._eval_free(decodedProfilePointer);
      if (decodedPointer) codec._eval_free(decodedPointer);
      if (encodedPointer) codec._eval_free(encodedPointer);
      for (const pointer of allocations) codec._free(pointer);
    }
  }
  const workerCode = `const { parentPort } = require('node:worker_threads');
globalThis.self = { postMessage(value) { parentPort.postMessage(value); } };
parentPort.on('message', data => self.onmessage({ data }));\n` +
    fs.readFileSync(path.join(__dirname, '../vendor/jpeg2000-codec.js'), 'utf8') + '\n' +
    fs.readFileSync(path.join(__dirname, '../src/workers/jpeg2000.worker.mjs'), 'utf8');
  const worker = new Worker(workerCode, { eval: true });
  const request = (message, transfers = []) => new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('JPEG 2000 Worker timeout')), 15000);
    const onMessage = result => {
      if (message.type !== 'init' && result.id !== message.id) return;
      clearTimeout(timeout); worker.off('message', onMessage); worker.off('error', onError);
      if (result.type === 'error') reject(new Error(result.message));
      else resolve(result);
    };
    const onError = error => {
      clearTimeout(timeout); worker.off('message', onMessage); reject(error);
    };
    worker.on('message', onMessage); worker.once('error', onError);
    worker.postMessage(message, transfers);
  });
  try {
    assert.equal((await request({ type: 'init' })).type, 'ready');
    const width = 12, height = 7;
    const original = new Uint16Array(width * height * 4);
    for (let i = 0; i < original.length; i++) original[i] = (i * 257 + 3) % 65536;
    const profile = fs.readFileSync(path.join(__dirname, 'fixtures/srgb-test.icc'));
    const encoded = await request({ id: 1, type: 'encode', format: 'jp2', quality: 100,
      width, height, depth: 16, buffer: original.slice().buffer, iccBuffer: Uint8Array.from(profile).buffer });
    assert.equal(encoded.type, 'encoded');
    assert.deepEqual(Buffer.from(encoded.buffer).subarray(0, 12), signature);
    const decoded = await request({ id: 2, type: 'decode', format: 'jp2', buffer: encoded.buffer }, [encoded.buffer]);
    assert.equal(decoded.type, 'decoded');
    assert.deepEqual([decoded.width, decoded.height, decoded.depth], [width, height, 16]);
    assert.deepEqual(new Uint16Array(decoded.exactBuffer), original);
    assert.deepEqual(Buffer.from(decoded.iccBuffer), profile);
    await assert.rejects(request({ id: 3, type: 'decode', format: 'jp2', buffer: Uint8Array.of(1, 2, 3).buffer }),
      /Неверная сигнатура/);
  } finally { await worker.terminate(); }
  console.log('OpenJPEG JP2/J2K lossless 8/16-bit, alpha, ICC, Worker and invalid input: OK');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
