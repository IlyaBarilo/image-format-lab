// Own spatial signal counts, MIT. Coefficients: ITU-R BT.709-6, section 3.2.
// Derived from integer RGB code values, not linear light or codec YCbCr planes.
import { analysisRegionBounds } from './analysis-region.mjs';
import { createPixelBuffer } from './pixel-buffer.mjs';
import { signalLevelsAtDepth } from './signal-scopes.mjs';
export function computeWaveform(input, matte = 'white', region = null) {
  const pixels = createPixelBuffer(input);
  const { width, height, data, sampleType, bitDepth, colorSpace, alphaMode } = pixels;
  if (sampleType === 'float32') throw new Error('Waveform и Parade поддерживают целые RGBA8/16; float32 пока недоступен.');
  if (matte !== 'white' && matte !== 'black') throw new Error('Неизвестная подложка анализа.');
  const bounds = analysisRegionBounds(width, height, region);
  const scaleMax = 2 ** bitDepth - 1;
  const levelBins = Math.min(scaleMax + 1, 1024);
  const columns = Math.min(bounds.width, 256);
  const channels = Array.from({ length: 6 }, () => new Uint32Array(columns * levelBins));
  const columnPixels = new Uint32Array(columns);
  const sums = new Float64Array(6), minima = new Uint32Array(6).fill(scaleMax), maxima = new Uint32Array(6);
  const levels = [0, 0, 0];
  const values = [0, 0, 0, 0, 0, 0];
  const background = matte === 'white' ? scaleMax : 0;
  const bucket = value => Math.min(levelBins - 1, Math.floor(value * levelBins / (scaleMax + 1)));
  // Grouping follows native-value composition and BT.709 conversion.
  for (let x = 0; x < bounds.width; x++) {
    const column = Math.floor(x * columns / bounds.width), offset = column * levelBins;
    columnPixels[column] += bounds.height;
    for (let y = 0, i = (bounds.y * width + bounds.x + x) * 4; y < bounds.height; y++, i += width * 4) {
      const alpha = data[i + 3];
      if (alpha > scaleMax) throw new Error('Отсчёт альфы не соответствует разрядности Waveform.');
      for (let c = 0; c < 3; c++) {
        const raw = data[i + c];
        if (raw > scaleMax) throw new Error('Отсчёт цвета не соответствует разрядности Waveform.');
        values[c] = Math.round(((alphaMode === 'straight' ? raw * alpha : raw * scaleMax) + background * (scaleMax - alpha)) / scaleMax);
        if (values[c] > scaleMax) throw new Error('Некорректное предварительно умноженное значение Waveform.');
      }
      const [r, g, b] = values;
      signalLevelsAtDepth(r, g, b, scaleMax, levels);
      values[3] = levels[0]; values[4] = levels[1]; values[5] = levels[2];
      for (let c = 0; c < 6; c++) {
        const value = values[c];
        channels[c][offset + bucket(value)]++;
        sums[c] += value;
        minima[c] = Math.min(minima[c], value);
        maxima[c] = Math.max(maxima[c], value);
      }
    }
  }
  const pixelCount = bounds.width * bounds.height;
  return { width, height, bounds, pixelCount, matte, columns, columnPixels, channels,
    sampleType, bitDepth, colorSpace, alphaMode, scaleMax, levelBins,
    channelMin: Array.from(minima), channelMax: Array.from(maxima), means: Array.from(sums, sum => sum / pixelCount),
    signal: `BT.709-derived-RGB${bitDepth}` };
}
