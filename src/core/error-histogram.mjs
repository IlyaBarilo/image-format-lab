// Exact integer-pixel error distribution. No display conversion or DOM state.
import { createPixelBuffer } from './pixel-buffer.mjs';
import { analysisRegionBounds } from './analysis-region.mjs';

const BINS = 256;
const peak = pixels => 2 ** pixels.bitDepth - 1;
const binFor = error => error === 0 ? 0 : Math.max(1, Math.min(255, Math.ceil(error * 255 - 1e-12)));

export function comparableErrorRasters(result, reference, matte = 'white') {
  const current = createPixelBuffer(result), source = createPixelBuffer(reference);
  if (![current, source].every(p => (p.sampleType === 'uint8' && p.bitDepth === 8) || (p.sampleType === 'uint16' && p.bitDepth === 16))) {
    throw new Error('Анализ ошибок поддерживает точные целые RGBA8 и RGBA16.');
  }
  if (current.alphaMode !== 'straight' || source.alphaMode !== 'straight') throw new Error('Анализ ошибок требует прямую прозрачность.');
  if (current.width !== source.width || current.height !== source.height) throw new Error('Анализ ошибок требует одинаковых размеров результата и исходника.');
  if (current.colorSpace !== 'unknown' && source.colorSpace !== 'unknown' && current.colorSpace !== source.colorSpace) {
    throw new Error('Цветовые пространства результата и исходника различаются; сравнение кодовых значений невозможно без преобразования цвета.');
  }
  if (matte !== 'white' && matte !== 'black') throw new Error('Неизвестная подложка анализа.');
  return { current, source, currentPeak: peak(current), sourcePeak: peak(source),
    colorComparison: current.colorSpace === 'unknown' || source.colorSpace === 'unknown' ? 'unknown-code-values' : 'same-code-values' };
}

export function errorBinInterval(bin) {
  if (!Number.isInteger(bin) || bin < 0 || bin >= BINS) throw new RangeError('Некорректная группа ошибки.');
  return bin === 0 ? '0% (точное совпадение)' : `(${((bin - 1) / 255 * 100).toFixed(3)}%; ${(bin / 255 * 100).toFixed(3)}%]`;
}

export function errorHistogramSummary(data) {
  const fmt = value => value.toLocaleString('ru-RU', { maximumFractionDigits: 4 });
  const m = data.metrics;
  return `MAE RGB ${fmt(m.maeRGB)}%, RMSE RGB ${fmt(m.rmseRGB)}%; MAE α ${fmt(m.maeAlpha)}%, RMSE α ${fmt(m.rmseAlpha)}%; точных совпадений RGB ${fmt(data.channels[0][0] / data.pixelCount * 100)}%, α ${fmt(data.channels[1][0] / data.pixelCount * 100)}%`;
}

export function computeErrorHistogram(result, reference, matte = 'white', region = null) {
  const {current,source,currentPeak,sourcePeak,colorComparison}=comparableErrorRasters(result,reference,matte);
  const bounds = analysisRegionBounds(current.width, current.height, region);
  const pixelCount = bounds.width * bounds.height, channels = [new Uint32Array(BINS), new Uint32Array(BINS)];
  let sumRGB = 0, squaresRGB = 0, sumAlpha = 0, squaresAlpha = 0, sumMaxRGB = 0, maxRGB = 0, maxAlpha = 0, changedRGB = 0, changedAlpha = 0;
  for (let y = bounds.y; y < bounds.y + bounds.height; y++) for (let x = bounds.x; x < bounds.x + bounds.width; x++) {
    const i = (y * current.width + x) * 4;
    const a = current.data[i + 3], b = source.data[i + 3];
    const alphaError = Math.abs(a / currentPeak - b / sourcePeak);
    let rgbError = 0;
    for (let c = 0; c < 3; c++) {
      const ca = current.data[i + c], cb = source.data[i + c];
      const composedA = matte === 'white' ? Math.round((ca * a + currentPeak * (currentPeak - a)) / currentPeak) : Math.round(ca * a / currentPeak);
      const composedB = matte === 'white' ? Math.round((cb * b + sourcePeak * (sourcePeak - b)) / sourcePeak) : Math.round(cb * b / sourcePeak);
      const error = Math.abs(composedA / currentPeak - composedB / sourcePeak);
      rgbError = Math.max(rgbError, error);
      sumRGB += error; squaresRGB += error * error;
    }
    channels[0][binFor(rgbError)]++; channels[1][binFor(alphaError)]++;
    sumMaxRGB += rgbError; maxRGB = Math.max(maxRGB, rgbError); maxAlpha = Math.max(maxAlpha, alphaError);
    sumAlpha += alphaError; squaresAlpha += alphaError * alphaError;
    if (rgbError > 0) changedRGB++;
    if (alphaError > 0) changedAlpha++;
  }
  return { width: current.width, height: current.height, bounds, pixelCount, bins: BINS, channels, matte,
    bitDepth: { result: current.bitDepth, source: source.bitDepth }, colorSpace: { result: current.colorSpace, source: source.colorSpace },
    colorComparison,
    metrics: { maeRGB: sumRGB / (3 * pixelCount) * 100, rmseRGB: Math.sqrt(squaresRGB / (3 * pixelCount)) * 100,
      maeAlpha: sumAlpha / pixelCount * 100, rmseAlpha: Math.sqrt(squaresAlpha / pixelCount) * 100,
      meanMaxRGB: sumMaxRGB / pixelCount * 100, maxRGB: maxRGB * 100, maxAlpha: maxAlpha * 100,
      changedRGB, changedAlpha } };
}
