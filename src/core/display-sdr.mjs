import { createPixelBuffer } from './pixel-buffer.mjs';

export const DEFAULT_DISPLAY = Object.freeze({ mode: 'standard', black: 0, white: 100, exposure: 0, dither: true,
  floatRange: 'unit', floatMin: 0, floatMax: 1 });
export const MAX_DISPLAY_PIXELS = 12_000_000;

export function normalizeDisplay(value) {
  const result = { ...DEFAULT_DISPLAY };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return result;
  if (value.mode === 'sdr' || value.mode === 'float') result.mode = value.mode;
  if (Number.isInteger(value.black) && value.black >= 0 && value.black <= 95) result.black = value.black;
  if (Number.isInteger(value.white) && value.white >= 5 && value.white <= 100) result.white = value.white;
  if (result.white <= result.black) { result.black = 0; result.white = 100; }
  if (typeof value.exposure === 'number' && Number.isFinite(value.exposure) &&
      value.exposure >= -3 && value.exposure <= 3 && value.exposure * 4 === Math.round(value.exposure * 4)) result.exposure = value.exposure;
  if (typeof value.dither === 'boolean') result.dither = value.dither;
  if (['unit', 'auto', 'manual'].includes(value.floatRange)) result.floatRange = value.floatRange;
  if (validFloatDisplayRange(value.floatMin, value.floatMax)) {
    result.floatMin = value.floatMin;
    result.floatMax = value.floatMax;
  }
  return result;
}

export function validFloatDisplayRange(min, max) {
  return typeof min === 'number' && typeof max === 'number' && Number.isFinite(min) && Number.isFinite(max) &&
    Math.abs(min) <= 2 ** 128 && Math.abs(max) <= 2 ** 128 && min < max && Number.isFinite(max - min);
}

export function resolveFloatDisplayRange(settings, stats) {
  if (settings.floatRange === 'manual' && validFloatDisplayRange(settings.floatMin, settings.floatMax))
    return [settings.floatMin, settings.floatMax];
  if (settings.floatRange === 'auto') {
    const lower = stats?.visibleMin?.slice(0, 3), upper = stats?.visibleMax?.slice(0, 3);
    if (lower?.length === 3 && upper?.length === 3 && [...lower, ...upper].every(Number.isFinite)) {
      const min = Math.min(...lower), max = Math.max(...upper);
      if (min < max) return [min, max];
      const half = Math.max(1, Math.abs(min)) * 0.05;
      if (Number.isFinite(half) && validFloatDisplayRange(min - half, max + half)) return [min - half, max + half];
    }
  }
  return [0, 1];
}

const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const clamp = value => Math.max(0, Math.min(255, value));

// Values are mapped in their stored code space. This is an SDR preview, not ICC or HDR conversion.
function createMapper(input, output, options, floatOutput) {
  const pixels = createPixelBuffer(input);
  if (!['uint8', 'uint16'].includes(pixels.sampleType) || pixels.alphaMode !== 'straight')
    throw new TypeError('Для SDR-просмотра нужны целочисленные RGBA с независимой альфой.');
  const rowLength = pixels.width * 4;
  if (!(floatOutput ? typeof Float16Array === 'function' && output instanceof Float16Array : output instanceof Uint8ClampedArray) || output.length < rowLength ||
      output.length > pixels.data.length || output.length % rowLength !== 0)
    throw new RangeError('Неверный размер буфера SDR-просмотра.');
  const settings = normalizeDisplay(options);
  const full = 2 ** pixels.bitDepth - 1;
  const black = settings.black / 100, span = (settings.white - settings.black) / 100;
  const exposure = 2 ** settings.exposure;
  const dither = !floatOutput && settings.dither && pixels.bitDepth > 8;
  const fullFrame = output.length === pixels.data.length;
  return function mapRows(first, last) {
    if (!Number.isInteger(first) || !Number.isInteger(last) || first < 0 || last < first || last > pixels.height)
      throw new RangeError('Неверный диапазон строк SDR-просмотра.');
    if (!fullFrame && last - first > output.length / rowLength)
      throw new RangeError('Блок вывода слишком мал для диапазона строк.');
    const source = pixels.data, width = pixels.width;
    for (let y = first; y < last; y++) for (let x = 0; x < width; x++) {
      const at = (y * width + x) * 4;
      const out = fullFrame ? at : ((y - first) * width + x) * 4;
      const offset = dither ? ((BAYER4[(y & 3) * 4 + (x & 3)] + 0.5) / 16 - 0.5) : 0;
      for (let channel = 0; channel < 3; channel++) {
        const code = (source[at + channel] / full * exposure - black) / span;
        output[out + channel] = floatOutput ? Math.max(0, Math.min(1, code)) : Math.round(clamp(code * 255 + offset));
      }
      const alpha = source[at + 3] / full;
      output[out + 3] = floatOutput ? alpha : Math.round(clamp(alpha * 255));
    }
  };
}

export function createSdrMapper(input, output, options = DEFAULT_DISPLAY) {
  return createMapper(input, output, options, false);
}

export function createFloat16SdrMapper(input, output, options = DEFAULT_DISPLAY) {
  return createMapper(input, output, options, true);
}

// The same numeric window is used for the exact float source and decoded SDR results.
// This changes only the screen copy; alpha and the source arrays remain untouched.
export function createFloatRangeMapper(input, output, range, { floatOutput = false, dither = true } = {}) {
  const pixels = createPixelBuffer(input);
  if (!['uint8', 'uint16', 'float32'].includes(pixels.sampleType) || pixels.alphaMode !== 'straight')
    throw new TypeError('Для показа диапазона нужны RGBA с независимой альфой.');
  if (!Array.isArray(range) || !validFloatDisplayRange(range[0], range[1]))
    throw new RangeError('Неверный диапазон показа float32.');
  const rowLength = pixels.width * 4;
  if (!(floatOutput ? typeof Float16Array === 'function' && output instanceof Float16Array : output instanceof Uint8ClampedArray) ||
      output.length < rowLength || output.length > pixels.data.length || output.length % rowLength !== 0)
    throw new RangeError('Неверный размер буфера показа.');
  const fullFrame = output.length === pixels.data.length;
  const full = pixels.sampleType === 'float32' ? 1 : 2 ** pixels.bitDepth - 1;
  const span = range[1] - range[0];
  const useDither = !floatOutput && dither && (pixels.sampleType === 'float32' || pixels.bitDepth > 8);
  return function mapRows(first, last) {
    if (!Number.isInteger(first) || !Number.isInteger(last) || first < 0 || last < first || last > pixels.height ||
        !fullFrame && last - first > output.length / rowLength)
      throw new RangeError('Неверный диапазон строк показа.');
    const source = pixels.data, width = pixels.width;
    for (let y = first; y < last; y++) for (let x = 0; x < width; x++) {
      const at = (y * width + x) * 4, out = fullFrame ? at : ((y - first) * width + x) * 4;
      const offset = useDither ? (BAYER4[(y & 3) * 4 + (x & 3)] + 0.5) / 16 - 0.5 : 0;
      for (let channel = 0; channel < 3; channel++) {
        const value = (source[at + channel] / full - range[0]) / span;
        output[out + channel] = floatOutput ? Math.max(0, Math.min(1, value)) : Math.round(clamp(value * 255 + offset));
      }
      const alpha = source[at + 3] / full;
      output[out + 3] = floatOutput ? alpha : Math.round(clamp(alpha * 255));
    }
  };
}
