import { createPixelBuffer } from './pixel-buffer.mjs';

export function detectAlpha(data) {
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] < 255) return true;
  }
  return false;
}

export function computePsnr(a, b) {
  if (!a.length || a.length !== b.length || a.length % 4) return null;
  let squaredError = 0;
  for (let i = 0; i < a.length; i += 4) {
    const alphaA = a[i + 3] / 255;
    const alphaB = b[i + 3] / 255;
    for (let c = 0; c < 3; c++) {
      // Compare every visible RGB channel on the same white background.
      const delta = (a[i + c] - 255) * alphaA - (b[i + c] - 255) * alphaB;
      squaredError += delta * delta;
    }
  }
  if (squaredError === 0) return Infinity;
  return 10 * Math.log10(255 * 255 / (squaredError / (a.length / 4 * 3)));
}

export function computeAlphaError(a, b) {
  if (!a.length || a.length !== b.length || a.length % 4) return null;
  let total = 0;
  for (let i = 3; i < a.length; i += 4) total += Math.abs(a[i] - b[i]);
  return total / (a.length / 4 * 255) * 100;
}

// Metadata validation is shared by the caller and Worker. It never copies pixels.
export function prepareMetricInputs(a, b, options = {}) {
  a = createPixelBuffer(a);
  b = createPixelBuffer(b);
  if (a.width !== b.width || a.height !== b.height) throw new Error('Для метрик нужны одинаковые размеры изображений.');
  if (!options || typeof options !== 'object' || Array.isArray(options) ||
      Object.keys(options).some(key => !['floatPeak', 'allowUnknownColorSpace'].includes(key))) {
    throw new TypeError('Некорректные параметры метрик.');
  }
  const { floatPeak, allowUnknownColorSpace = false } = options;
  if (typeof allowUnknownColorSpace !== 'boolean') throw new TypeError('Некорректная политика цветового пространства.');
  const unknown = a.colorSpace === 'unknown' || b.colorSpace === 'unknown';
  if (unknown ? !allowUnknownColorSpace : a.colorSpace !== b.colorSpace) {
    throw new Error('Цветовые пространства не сопоставимы: нужно общее пространство или явное сравнение неизвестных кодовых значений.');
  }
  const floating = a.sampleType === 'float32' || b.sampleType === 'float32';
  if (floating) {
    // Keep normalisation within the numeric range supported by float32 samples.
    if (!Number.isFinite(floatPeak) || floatPeak < 2 ** -149 || floatPeak > (2 - 2 ** -23) * 2 ** 127) {
      throw new RangeError('Для float32 нужен явный положительный floatPeak в диапазоне float32.');
    }
  } else if (floatPeak !== undefined) throw new TypeError('floatPeak применяется только к float32.');
  return { a, b, options: Object.freeze({ allowUnknownColorSpace, ...(floating ? { floatPeak } : {}) }) };
}

function metricScale(pixels, floatPeak) {
  const floating = pixels.sampleType === 'float32';
  const peak = floating ? floatPeak : 2 ** pixels.bitDepth - 1;
  return { pixels, peak, alphaPeak: floating ? 1 : peak, floating,
    checkRange: floating || pixels.bitDepth < (pixels.sampleType === 'uint8' ? 8 : 16) };
}

function validateMetricSample(scale, offset) {
  const { data } = scale.pixels;
  if (scale.checkRange) {
    for (let channel = 0; channel < 4; channel++) {
      const value = data[offset + channel];
      if (!Number.isFinite(value) || (!scale.floating && (value < 0 || value > scale.peak))) {
        throw new RangeError('Отсчёт пикселя не соответствует разрядности или не является конечным числом.');
      }
    }
    if (scale.floating && (data[offset + 3] < 0 || data[offset + 3] > 1)) {
      throw new RangeError('Альфа float32 должна быть в диапазоне 0–1.');
    }
  }
}

/** RGB PSNR on white, in code-value space; alpha is mean absolute error in percent.
 * Float RGB may extend outside 0..floatPeak; alpha is always normalised to 0..1.
 * No colour transform, resampling, rounding or clamp is applied to the samples.
 */
export function computePixelMetrics(first, second, options) {
  const { a, b, options: settings } = prepareMetricInputs(first, second, options);
  // Retain the exact arithmetic of the existing RGBA8 measurements.
  if (a.sampleType === 'uint8' && b.sampleType === 'uint8' && a.bitDepth === 8 && b.bitDepth === 8 &&
      a.alphaMode === 'straight' && b.alphaMode === 'straight') {
    return { psnr: computePsnr(a.data, b.data), alpha: computeAlphaError(a.data, b.data) };
  }
  const sa = metricScale(a, settings.floatPeak), sb = metricScale(b, settings.floatPeak);
  const sameIntegerScale = !sa.floating && !sb.floating && sa.peak === sb.peak;
  const peak = sameIntegerScale ? sa.peak : 1;
  let squaredError = 0, alphaError = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    validateMetricSample(sa, i);
    validateMetricSample(sb, i);
    const alphaA = a.data[i + 3] / sa.alphaPeak, alphaB = b.data[i + 3] / sb.alphaPeak;
    alphaError += Math.abs(alphaA - alphaB);
    for (let c = 0; c < 3; c++) {
      const va = sameIntegerScale ? a.data[i + c] : a.data[i + c] / sa.peak;
      const vb = sameIntegerScale ? b.data[i + c] : b.data[i + c] / sb.peak;
      // Subtract the white contributions separately so tiny opaque float RGB
      // differences are not erased by first subtracting a much larger white.
      const ca = a.alphaMode === 'straight' ? va * alphaA : va;
      const cb = b.alphaMode === 'straight' ? vb * alphaB : vb;
      const delta = (ca - cb) + peak * (alphaB - alphaA);
      squaredError += delta * delta;
    }
  }
  const count = a.width * a.height;
  return { psnr: squaredError === 0 ? Infinity : 10 * Math.log10(peak * peak / (squaredError / (count * 3))),
    alpha: alphaError / count * 100 };
}
