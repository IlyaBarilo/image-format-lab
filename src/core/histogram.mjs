// Project implementation, MIT. Counts in native integer levels or explicit float bins.
// RGB is composited in code-value space; alpha is counted independently.
import { analysisRegionBounds } from './analysis-region.mjs';
import { createPixelBuffer } from './pixel-buffer.mjs';

export function computeHistogram(input, matte = 'white', region = null, options = {}) {
  const pixels = createPixelBuffer(input);
  const { width, height, data, sampleType, bitDepth, colorSpace, alphaMode } = pixels;
  const bounds = analysisRegionBounds(width, height, region);
  if (matte !== 'white' && matte !== 'black') throw new Error('Неизвестная подложка анализа.');
  if (!options || typeof options !== 'object' || Array.isArray(options) ||
      Object.keys(options).some(key => !['range', 'bins', 'floatPeak'].includes(key))) throw new Error('Некорректные параметры гистограммы.');
  const floating = sampleType === 'float32';
  let min = 0, max = 2 ** bitDepth - 1, bins = max + 1, white = max;
  if (floating) {
    const { range, floatPeak } = options;
    if (!Array.isArray(range) || range.length !== 2 || !range.every(Number.isFinite) || range[0] >= range[1] ||
        !Number.isFinite(range[1] - range[0]) || Math.abs(range[0]) > 2 ** 128 || Math.abs(range[1]) > 2 ** 128 ||
        !Number.isInteger(options.bins) || options.bins < 2 || options.bins > 65536 ||
        !Number.isFinite(floatPeak) || floatPeak < 2 ** -149 || floatPeak > (2 - 2 ** -23) * 2 ** 127) {
      throw new Error('Для float32 нужны явные range [min, max], bins (2–65536) и положительный floatPeak.');
    }
    [min, max] = range; bins = options.bins; white = floatPeak;
  } else if (Object.keys(options).length) throw new Error('Параметры интервалов применяются только к float32.');
  const channels = Array.from({ length: 4 }, () => new Uint32Array(bins));
  const underflow = new Uint32Array(4), overflow = new Uint32Array(4), sums = new Float64Array(4);
  const alphaMax = floating ? 1 : max, background = matte === 'white' ? white : 0;
  for (let y = bounds.y; y < bounds.y + bounds.height; y++) for (let x = bounds.x; x < bounds.x + bounds.width; x++) {
    const offset = (y * width + x) * 4, alpha = data[offset + 3];
    if (!Number.isFinite(alpha) || alpha < 0 || alpha > alphaMax) throw new Error('Некорректная альфа для гистограммы.');
    for (let c = 0; c < 4; c++) {
      const raw = data[offset + c];
      if (!Number.isFinite(raw) || (!floating && (raw < 0 || raw > max))) throw new Error('Отсчёт не соответствует разрядности гистограммы.');
      // Integer arithmetic retains the existing RGBA8 composition/rounding exactly.
      const value = c === 3 ? alpha : floating
        ? (alphaMode === 'straight' ? raw * alpha : raw) + background * (1 - alpha)
        : Math.round(((alphaMode === 'straight' ? raw * alpha : raw * alphaMax) + background * (alphaMax - alpha)) / alphaMax);
      const low = c === 3 ? 0 : min, high = c === 3 ? alphaMax : max;
      sums[c] += value;
      if (value < low) underflow[c]++;
      else if (value > high) overflow[c]++;
      else channels[c][floating ? Math.min(bins - 1, Math.floor((value - low) / (high - low) * bins)) : value]++;
    }
  }
  const pixelCount = bounds.width * bounds.height;
  return { width, height, bounds, pixelCount, matte, channels, sampleType, bitDepth, colorSpace, alphaMode,
    scale: { kind: floating ? 'float' : 'integer', min, max, bins, alphaMax, white },
    underflow, overflow, means: sums.map(sum => sum / pixelCount),
    boundaryCounts: floating ? null : { low: channels.map(values => values[0]), high: channels.map(values => values[max]) } };
}
