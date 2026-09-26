// Computed BT.709 code-value scopes from integer RGB samples, MIT.
// Cb/Cr are full-range display levels, not native codec planes or video-range samples.
import { analysisRegionBounds } from './analysis-region.mjs';
import { createPixelBuffer } from './pixel-buffer.mjs';

export function signalLevels(r, g, b, output = [0, 0, 0]) {
  const y = (2126 * r + 7152 * g + 722 * b) / 10000;
  const cb = (b - y) / 1.8556;
  const cr = (r - y) / 1.5748;
  output[0] = Math.round(y);
  output[1] = Math.max(0, Math.min(255, Math.round(cb + 128)));
  output[2] = Math.max(0, Math.min(255, Math.round(cr + 128)));
  return output;
}

export function signalLevelsAtDepth(r, g, b, scaleMax, output = [0, 0, 0]) {
  if (scaleMax === 255) return signalLevels(r, g, b, output);
  const y = (2126 * r + 7152 * g + 722 * b) / 10000;
  output[0] = Math.round(y);
  output[1] = Math.max(0, Math.min(scaleMax, Math.round((b - y) / 1.8556 + (scaleMax + 1) / 2)));
  output[2] = Math.max(0, Math.min(scaleMax, Math.round((r - y) / 1.5748 + (scaleMax + 1) / 2)));
  return output;
}

export function computeSignalHistogram(input, matte = 'white', region = null) {
  const { width, height, data, sampleType, bitDepth, colorSpace, alphaMode } = createPixelBuffer(input);
  if (sampleType === 'float32') throw new Error('Гистограмма Y′CbCr поддерживает целые RGBA8/16; float32 пока недоступен.');
  const bounds = analysisRegionBounds(width, height, region);
  if (matte !== 'white' && matte !== 'black') throw new Error('Неизвестная подложка анализа.');
  const scaleMax = 2 ** bitDepth - 1, background = matte === 'white' ? scaleMax : 0;
  const channels = Array.from({ length: 3 }, () => new Uint32Array(scaleMax + 1));
  const sums = new Float64Array(3);
  const minima = new Uint32Array(3).fill(scaleMax), maxima = new Uint32Array(3);
  const levels = [0, 0, 0], rgb = [0, 0, 0];
  for (let y = bounds.y; y < bounds.y + bounds.height; y++) for (let x = bounds.x; x < bounds.x + bounds.width; x++) {
    const i = (y * width + x) * 4, alpha = data[i + 3];
    if (alpha > scaleMax) throw new Error('Отсчёт альфы не соответствует разрядности гистограммы Y′CbCr.');
    for (let channel = 0; channel < 3; channel++) {
      const raw = data[i + channel];
      if (raw > scaleMax) throw new Error('Отсчёт цвета не соответствует разрядности гистограммы Y′CbCr.');
      const value = Math.round(((alphaMode === 'straight' ? raw * alpha : raw * scaleMax) + background * (scaleMax - alpha)) / scaleMax);
      if (value > scaleMax) throw new Error('Некорректное предварительно умноженное значение гистограммы Y′CbCr.');
      rgb[channel] = value;
    }
    signalLevelsAtDepth(...rgb, scaleMax, levels);
    for (let channel = 0; channel < 3; channel++) { const value = levels[channel]; channels[channel][value]++; sums[channel] += value; minima[channel] = Math.min(minima[channel], value); maxima[channel] = Math.max(maxima[channel], value); }
  }
  const pixelCount = bounds.width * bounds.height;
  return { width, height, bounds, pixelCount, matte, channels, sampleType, bitDepth, colorSpace: 'derived-rgb', sourceColorSpace: colorSpace, alphaMode,
    scale: { kind: 'integer', min: 0, max: scaleMax, bins: scaleMax + 1, alphaMax: scaleMax, white: scaleMax },
    channelMin: Array.from(minima), channelMax: Array.from(maxima), means: Array.from(sums, sum => sum / pixelCount),
    signal: `BT.709-derived-RGB${bitDepth}`, cbCr: `full-range-offset-${(scaleMax + 1) / 2}` };
}
