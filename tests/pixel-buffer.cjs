const assert = require('node:assert/strict');

(async () => {
  const { createPixelBuffer, clonePixelBuffer, pixelBufferByteLength } = await import('../src/core/pixel-buffer.mjs');
  const { pixelBufferFromImageData, pixelBufferToImageData, cloneImageData } = await import('../src/core/pixels.mjs');
  const make = (data, extra = {}) => createPixelBuffer({ width: data.length / 4, height: 1, data, ...extra });

  const backing = new Uint8ClampedArray([99, 99, 99, 99, 255, 7, 128, 0, 19, 23, 31, 127, 88, 88, 88, 88]);
  const view = backing.subarray(4, 12);
  const pixels = make(view, { colorSpace: 'display-p3' });
  assert.equal(pixels.data, view, 'Wrapping borrows the exact view, including its offset');
  assert.equal(pixels.byteLength, 8, 'Size covers the view, not its backing allocation');
  assert.equal(pixels.sampleType, 'uint8');
  assert.equal(pixels.bitDepth, 8);
  assert.equal(pixels.alphaMode, 'straight');
  assert.ok(Object.isFrozen(pixels));
  const copy = clonePixelBuffer(pixels);
  assert.deepEqual(copy, pixels);
  assert.notEqual(copy.data.buffer, pixels.data.buffer);
  assert.equal(copy.data.byteOffset, 0);
  assert.equal(copy.data.buffer.byteLength, 8);
  copy.data[0] = 1;
  assert.equal(view[0], 255, 'Changing a clone leaves source and hidden RGB untouched');
  assert.deepEqual([...backing.subarray(0, 4)], [99, 99, 99, 99]);
  assert.equal(make(new Uint8Array(4)).colorSpace, 'unknown', 'No inferred profile for unlabelled pixels');
  const nodeBuffer = make(Buffer.from([1, 2, 3, 4]));
  const nodeCopy = clonePixelBuffer(nodeBuffer);
  nodeCopy.data[0] = 9;
  assert.equal(nodeBuffer.data[0], 1, 'A Buffer slice must not turn a clone into an alias');

  const sixteen = make(new Uint16Array([1, 256, 65534, 65535]), { sampleType: 'uint16' });
  const sixteenCopy = clonePixelBuffer(sixteen);
  assert.deepEqual([...sixteenCopy.data], [1, 256, 65534, 65535]);
  assert.equal(sixteenCopy.bitDepth, 16);
  assert.equal(sixteenCopy.byteLength, 8);
  const ten = make(new Uint16Array([0, 513, 1022, 1023]), { sampleType: 'uint16', bitDepth: 10 });
  assert.equal(clonePixelBuffer(ten).bitDepth, 10);
  assert.equal(ten.byteLength, 8, 'Effective bit depth does not change storage width');
  const floating = make(new Float32Array([-2, -0, 3.5, 0.25]), { sampleType: 'float32', alphaMode: 'premultiplied' });
  assert.deepEqual(clonePixelBuffer(floating), floating);
  assert.ok(Object.is(clonePixelBuffer(floating).data[1], -0));
  assert.equal(floating.byteLength, 16);
  const floatBits = new Uint32Array([0x7fc01234, 0x80000000, 0x3f800000, 0x7f800000]);
  const bitCopy = clonePixelBuffer(make(new Float32Array(floatBits.buffer), { sampleType: 'float32' }));
  assert.deepEqual(new Uint32Array(bitCopy.data.buffer), floatBits, 'Cloning preserves raw bits; it is not a numeric conversion or sample scan');
  for (const [sampleType, expected] of [['uint8', 160000000], ['uint16', 320000000], ['float32', 640000000]]) {
    assert.equal(pixelBufferByteLength(8000, 5000, sampleType), expected);
  }
  assert.equal(createPixelBuffer(sixteen, { maxBytes: 8 }).byteLength, 8);
  assert.throws(() => clonePixelBuffer(sixteen, { maxBytes: 7 }), /лимит/);

  for (const invalid of [
    { width: 0 }, { height: -1 }, { width: 1.5 }, { height: NaN }, { width: '1' },
    { width: Number.MAX_SAFE_INTEGER }, { data: new Uint8Array(3) }, { data: new Uint8Array(8) },
    { data: [0, 0, 0, 0] }, { data: new DataView(new ArrayBuffer(4)) },
    { data: new Float32Array(4) }, { sampleType: 'uint16' }, { sampleType: '__proto__' },
    { bitDepth: 0 }, { bitDepth: 9 }, { bitDepth: 1.5 }, { colorSpace: 'guessed' }, { alphaMode: 'none' }
  ]) assert.throws(() => createPixelBuffer({ width: 1, height: 1, data: new Uint8Array(4), ...invalid }));
  assert.throws(() => createPixelBuffer({ ...floating, bitDepth: 16 }));
  for (const maxBytes of [-1, 0, NaN, Infinity, '8']) assert.throws(() => createPixelBuffer(sixteen, { maxBytes }));
  const detachable = new Uint8Array(4);
  const detached = make(detachable);
  structuredClone(detachable, { transfer: [detachable.buffer] });
  assert.throws(() => clonePixelBuffer(detached), /Длина/);
  console.log('PASS pixel layout, byte budgets, borrowed views, exact integer/float clones and invalid input');

  // This is an API model, not a browser pixel-rendering or colour-management test.
  class ImageDataModel {
    constructor(data, width, height, settings) {
      Object.assign(this, { data, width, height, colorSpace: settings?.colorSpace ?? 'srgb' });
    }
  }
  globalThis.ImageData = ImageDataModel;
  const imageData = new ImageDataModel(view, 2, 1, { colorSpace: 'display-p3' });
  const wrapped = pixelBufferFromImageData(imageData);
  assert.equal(wrapped.data, imageData.data);
  const restored = pixelBufferToImageData(wrapped);
  assert.equal(restored.data, view);
  assert.equal(restored.colorSpace, 'display-p3');
  const imageCopy = cloneImageData(imageData);
  assert.deepEqual(imageCopy, imageData);
  assert.notEqual(imageCopy.data.buffer, imageData.data.buffer);
  const allLevels = new ImageDataModel(Uint8ClampedArray.from({ length: 1024 }, (_, i) => i % 256), 256, 1);
  assert.deepEqual(cloneImageData(allLevels), allLevels, 'All code levels, including every alpha value, survive');
  assert.equal(pixelBufferFromImageData({ data: view, width: 2, height: 1 }).colorSpace, 'unknown');
  const bytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]).subarray(4);
  const byteImage = pixelBufferToImageData(make(bytes));
  assert.equal(byteImage.data.buffer, bytes.buffer);
  assert.equal(byteImage.data.byteOffset, bytes.byteOffset);
  for (const input of [sixteen, floating, { ...pixels, bitDepth: 7 }, { ...pixels, alphaMode: 'premultiplied' }]) {
    assert.throws(() => pixelBufferToImageData(input), /RGBA8/);
  }
  assert.throws(() => cloneImageData({ width: 1, height: 1, data: new Uint16Array(4) }), /RGBA8/);
  console.log('PASS RGBA8 ImageData adapters, colour label and alpha preservation; no implicit high-depth conversion');

  const { createDecode } = await import('../src/services/decode.mjs');
  const { createEncode } = await import('../src/services/encode.mjs');
  const { createComparison } = await import('../src/ui/comparison.mjs');
  let canvases = 0, bitmaps = 0, closedBitmaps = 0, closedDecoded = 0;
  const drawn = [];
  globalThis.document = { createElement(tag) {
    assert.equal(tag, 'canvas'); canvases++;
    const canvas = { width: 0, height: 0 };
    const context = {
      putImageData(input) { canvas.imageData = input; },
      drawImage(input, ...args) { drawn.push(args); canvas.imageData = input.imageData; },
      getImageData() {
        const data = new Uint8ClampedArray(canvas.width * canvas.height * 4);
        data.set(canvas.imageData.data.subarray(0, data.length));
        return new ImageDataModel(data, canvas.width, canvas.height);
      }
    };
    canvas.getContext = () => context;
    return canvas;
  } };
  globalThis.createImageBitmap = async input => {
    bitmaps++;
    return { width: input.width, height: input.height, close() { closedBitmaps++; } };
  };
  const file = Object.assign(new Blob(['sample'], { type: 'image/png' }), { name: 'sample.png' });
  const rawDecoded = () => ({ width: 2, height: 1, imageData, close() { closedDecoded++; } });
  let nextDecoded = rawDecoded();
  const deps = {
    decodeImageBlobOrOptional: async () => nextDecoded,
    detectAlpha: data => data.some((value, index) => index % 4 === 3 && value !== 255),
    readPanoramaMetadata: async () => ({ panorama: { test: 'kept' } }),
    outputDimensionsForConfig: (config, source) => ({ width: config.resizeWidth || source.width, height: config.resizeHeight || source.height }),
    cloneImageData
  };
  const decode = createDecode({}, deps);
  deps.imageDataToPreview = decode.imageDataToPreview;
  const source = await decode.decodeSourceFile(file);
  assert.equal(source.imageData, imageData);
  assert.equal(source.pixelBuffer.data, imageData.data);
  assert.equal(source.pixelBuffer.colorSpace, 'display-p3');
  assert.equal(source.hasAlpha, true);
  assert.equal(source.panorama.test, 'kept');
  assert.equal(closedDecoded, 1);
  const preview = await decode.decodeVariantForPreview(file);
  assert.equal(preview.pixelBuffer.data, preview.imageData.data);
  assert.equal(preview.pixelBuffer.colorSpace, 'display-p3');
  assert.equal(closedDecoded, 2);
  preview.bitmap.close();
  nextDecoded = { width: 2, height: 1, image: { imageData }, close() { closedDecoded++; } };
  const browserSource = await decode.decodeSourceFile(file);
  assert.equal(browserSource.pixelBuffer.data, browserSource.imageData.data);
  assert.equal(browserSource.pixelBuffer.colorSpace, 'srgb', 'Describe the returned working pixels, not the file profile');
  const browserPreview = await decode.decodeVariantForPreview(file);
  assert.equal(browserPreview.pixelBuffer.data, browserPreview.imageData.data);
  browserPreview.bitmap.close();
  for (const invalid of [
    { width: 0, height: 1 }, { width: 2.5, height: 1 }, { width: 40000001, height: 1 },
    { width: 1, height: 1, imageData },
    { width: 2, height: 1, imageData: { width: 2, height: 1, data: new Uint8ClampedArray(4) } },
    { width: 1, height: 1, imageData: { width: 1, height: 1, data: new Uint16Array(4) } }
  ]) {
    const before = { canvases, bitmaps, closedDecoded };
    nextDecoded = { ...invalid, close() { closedDecoded++; } };
    await assert.rejects(decode.decodeSourceFile(file));
    await assert.rejects(decode.decodeVariantForPreview(file));
    assert.equal(canvases, before.canvases, 'Reject malformed dimensions before allocating a canvas');
    assert.equal(bitmaps, before.bitmaps);
    assert.equal(closedDecoded, before.closedDecoded + 2, 'Failure releases the decoder on both paths');
  }
  nextDecoded = rawDecoded();
  const encode = createEncode({}, deps);
  Object.assign(deps, encode);
  assert.equal(encode.outputSourceForConfig({ format: 'png' }, source), source);
  const resized = encode.outputSourceForConfig({ format: 'png', resizeWidth: 1, resizeHeight: 1 }, source);
  assert.equal(resized.pixelBuffer.width, 1);
  assert.equal(resized.pixelBuffer.height, 1);
  assert.equal(resized.pixelBuffer.byteLength, 4);
  assert.equal(resized.pixelBuffer.data, resized.imageData.data);
  assert.notEqual(resized.pixelBuffer.data.buffer, source.pixelBuffer.data.buffer);
  assert.equal(resized.pixelBuffer.colorSpace, 'srgb');
  const icon = encode.outputSourceForConfig({ format: 'ico' }, source);
  assert.equal(icon.pixelBuffer.width, 256);
  assert.equal(icon.pixelBuffer.height, 256);
  assert.equal(icon.pixelBuffer.byteLength, 256 * 256 * 4);
  assert.equal(icon.pixelBuffer.data, icon.imageData.data);
  const original = await encode.encodeOne({ format: 'original' }, source);
  assert.equal(original.blob, file);
  assert.equal(original.sourcePixelBuffer, source.pixelBuffer);
  assert.deepEqual(original.previewImageData, imageData);
  assert.notEqual(original.previewImageData.data.buffer, source.pixelBuffer.data.buffer);
  const smallEncoded = encode.withEncodedMeta({ blob: file }, resized);
  assert.equal(smallEncoded.sourcePixelBuffer, resized.pixelBuffer);
  assert.equal(smallEncoded.sourceImageData, resized.imageData);
  const { pixelBuffer: omitted, ...legacySource } = source;
  assert.equal(encode.withEncodedMeta({ blob: file }, legacySource).sourcePixelBuffer.data, imageData.data);
  console.log('PASS decoded sources/results, rejected layouts, resize and ICO refresh, original copy and encoded reference');

  const app = { source, sourceGeneration: 1 };
  const variant = { generation: 0, config: { format: 'original' } };
  const errors = [];
  const comparisonDeps = {
    ...decode, encodeFromSource: async () => original,
    outputFormatLabel: () => 'PNG', updateMetrics() {}, measurePixels: async () => ({ psnr: Infinity, alpha: 0 }),
    alphaLabel: () => 'alpha', formatBytes: String, drawAll() {}, showStatus: text => errors.push(text)
  };
  Object.assign(comparisonDeps, createComparison({ app, els: { metadataPolicy: { value: 'panorama' } } }, comparisonDeps));
  await comparisonDeps.renderVariant(variant);
  assert.deepEqual(errors, []);
  assert.equal(variant.pixelBuffer.data, variant.imageData.data);
  assert.notEqual(variant.pixelBuffer.data.buffer, source.pixelBuffer.data.buffer);
  assert.equal(variant.measurement.psnrRGB, Infinity);
  const beforeClose = closedBitmaps;
  comparisonDeps.disposeVariantOutput(variant);
  assert.equal(variant.pixelBuffer, null);
  assert.equal(variant.imageData, null);
  assert.equal(variant.resultSource, null);
  assert.equal(closedBitmaps, beforeClose + 1);
  let finishPreview;
  comparisonDeps.imageDataToPreview = () => new Promise(resolve => { finishPreview = resolve; });
  const pending = comparisonDeps.renderVariant(variant);
  await Promise.resolve();
  assert.equal(typeof finishPreview, 'function');
  variant.generation++;
  finishPreview(await decode.imageDataToPreview(imageData));
  await pending;
  assert.equal(variant.pixelBuffer, null, 'A stale preview never retains a pixel buffer');
  assert.equal(closedBitmaps, beforeClose + 2);
  console.log('PASS comparison stores/releases descriptors and discards stale results');
  delete globalThis.ImageData;
  delete globalThis.document;
  delete globalThis.createImageBitmap;
})().catch(error => { console.error(error); process.exitCode = 1; });
