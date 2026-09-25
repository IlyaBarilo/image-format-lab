// Packed RGBA samples. Descriptors borrow their arrays; cloning is explicit.
const SAMPLE_TYPES = Object.freeze({
  uint8: { bytes: 1, bits: 8, ArrayType: Uint8Array },
  uint16: { bytes: 2, bits: 16, ArrayType: Uint16Array },
  float32: { bytes: 4, bits: 32, ArrayType: Float32Array }
});

function sampleInfo(sampleType) {
  if (typeof sampleType !== 'string' || !Object.hasOwn(SAMPLE_TYPES, sampleType)) throw new TypeError('Неизвестный тип отсчётов пикселей.');
  return SAMPLE_TYPES[sampleType];
}

export function pixelBufferByteLength(width, height, sampleType = 'uint8') {
  const { bytes } = sampleInfo(sampleType);
  if (![width, height].every(value => Number.isSafeInteger(value) && value > 0)) {
    throw new RangeError('Размеры растра должны быть положительными целыми числами.');
  }
  const length = width * height * 4 * bytes;
  if (!Number.isSafeInteger(length)) throw new RangeError('Объём растра превышает точный целочисленный диапазон.');
  return length;
}

/**
 * Validate the layout without scanning, converting or copying sample values.
 * bitDepth describes the stored working samples, not the original file.
 * Integer samples use native code values; float32 has no implicit 0..1 clamp.
 */
export function createPixelBuffer({ width, height, data, sampleType = 'uint8',
  bitDepth = sampleInfo(sampleType).bits, colorSpace = 'unknown', alphaMode = 'straight' },
  { maxBytes = Number.MAX_SAFE_INTEGER } = {}) {
  const info = sampleInfo(sampleType);
  const byteLength = pixelBufferByteLength(width, height, sampleType);
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new RangeError('Некорректный лимит памяти растра.');
  if (byteLength > maxBytes) throw new RangeError('Объём растра превышает лимит памяти.');
  if (!(data instanceof info.ArrayType) && !(sampleType === 'uint8' && data instanceof Uint8ClampedArray)) {
    throw new TypeError('Массив пикселей не соответствует типу отсчётов.');
  }
  if (data.byteLength !== byteLength || data.length !== width * height * 4) {
    throw new RangeError('Длина массива не соответствует размерам RGBA-растра.');
  }
  if (!Number.isInteger(bitDepth) || bitDepth < 1 || bitDepth > info.bits ||
      (sampleType === 'float32' && bitDepth !== 32)) {
    throw new RangeError('Некорректная разрядность отсчётов.');
  }
  if (!['unknown', 'srgb', 'display-p3'].includes(colorSpace)) throw new TypeError('Неизвестное цветовое пространство растра.');
  if (!['straight', 'premultiplied'].includes(alphaMode)) throw new TypeError('Неизвестный способ хранения прозрачности.');
  return Object.freeze({ width, height, data, sampleType, bitDepth, colorSpace, alphaMode, byteLength });
}

export function clonePixelBuffer(pixels, options) {
  const validated = createPixelBuffer(pixels, options);
  const ArrayType = validated.data instanceof Uint8ClampedArray ? Uint8ClampedArray : sampleInfo(validated.sampleType).ArrayType;
  const data = new ArrayType(validated.data.length);
  // Copy only the view's bytes, retaining float bits and excluding its neighbours.
  new Uint8Array(data.buffer).set(new Uint8Array(validated.data.buffer, validated.data.byteOffset, validated.byteLength));
  return createPixelBuffer({ ...validated, data }, options);
}
