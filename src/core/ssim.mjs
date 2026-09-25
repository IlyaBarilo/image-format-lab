// Own single-scale SSIM calculation on exact integer pixels; no third-party implementation.
import { analysisRegionBounds } from './analysis-region.mjs';
import { comparableErrorRasters } from './error-histogram.mjs';

const RADIUS = 5;
const SIGMA = 1.5;
const C1 = 0.01 ** 2;
const C2 = 0.03 ** 2;
const LUMA = [0.2126, 0.7152, 0.0722];
const kernel = Float64Array.from({ length: 2 * RADIUS + 1 }, (_, i) => Math.exp(-((i - RADIUS) ** 2) / (2 * SIGMA ** 2)));
const kernelSum = kernel.reduce((sum, value) => sum + value, 0);
for (let i = 0; i < kernel.length; i++) kernel[i] /= kernelSum;

function reflect(index, length) {
  if (length === 1) return 0;
  while (index < 0 || index >= length) index = index < 0 ? -index : 2 * length - 2 - index;
  return index;
}

function luminance(pixels, peak, x, y, matte) {
  const i = (y * pixels.width + x) * 4, alpha = pixels.data[i + 3];
  let value = 0;
  for (let c = 0; c < 3; c++) {
    const code = pixels.data[i + c];
    const composed = matte === 'white'
      ? Math.round((code * alpha + peak * (peak - alpha)) / peak)
      : Math.round(code * alpha / peak);
    value += composed / peak * LUMA[c];
  }
  return value;
}

export function computeSSIM(result, reference, matte = 'white', region = null) {
  const { current, source, currentPeak, sourcePeak, colorComparison } = comparableErrorRasters(result, reference, matte);
  const bounds = analysisRegionBounds(current.width, current.height, region), width = bounds.width, height = bounds.height;
  const rows = new Map();
  function horizontal(row) {
    const cached = rows.get(row);
    if (cached) return cached;
    const a = new Float64Array(width), b = new Float64Array(width);
    for (let x = 0; x < width; x++) {
      const imageX = bounds.x + x, imageY = bounds.y + row;
      a[x] = luminance(current, currentPeak, imageX, imageY, matte);
      b[x] = luminance(source, sourcePeak, imageX, imageY, matte);
    }
    const moments = Array.from({ length: 5 }, () => new Float64Array(width));
    for (let x = 0; x < width; x++) for (let k = -RADIUS; k <= RADIUS; k++) {
      const j = reflect(x + k, width), weight = kernel[k + RADIUS], av = a[j], bv = b[j];
      moments[0][x] += weight * av;
      moments[1][x] += weight * bv;
      moments[2][x] += weight * av * av;
      moments[3][x] += weight * bv * bv;
      moments[4][x] += weight * av * bv;
    }
    rows.set(row, moments);
    return moments;
  }
  let sum = 0, minimum = 1, maximum = -1;
  for (let y = 0; y < height; y++) {
    const neighbours = Array.from({ length: kernel.length }, (_, k) => horizontal(reflect(y + k - RADIUS, height)));
    for (let x = 0; x < width; x++) {
      let meanA = 0, meanB = 0, squareA = 0, squareB = 0, product = 0;
      for (let k = 0; k < kernel.length; k++) {
        const row = neighbours[k], weight = kernel[k];
        meanA += weight * row[0][x]; meanB += weight * row[1][x];
        squareA += weight * row[2][x]; squareB += weight * row[3][x]; product += weight * row[4][x];
      }
      const varianceA = Math.max(0, squareA - meanA * meanA), varianceB = Math.max(0, squareB - meanB * meanB);
      const covariance = product - meanA * meanB;
      const value = Math.max(-1, Math.min(1, ((2 * meanA * meanB + C1) * (2 * covariance + C2)) /
        ((meanA * meanA + meanB * meanB + C1) * (varianceA + varianceB + C2))));
      sum += value; minimum = Math.min(minimum, value); maximum = Math.max(maximum, value);
    }
    for (const row of rows.keys()) if (row < y - RADIUS) rows.delete(row);
  }
  const pixelCount = width * height;
  return { width: current.width, height: current.height, bounds, pixelCount, score: sum / pixelCount,
    minimum, maximum, matte, bitDepth: { result: current.bitDepth, source: source.bitDepth },
    colorSpace: { result: current.colorSpace, source: source.colorSpace }, colorComparison,
    method: { name: 'SSIM', scale: 'single', channel: 'Y-prime-BT.709-code-values', window: 11,
      sigma: SIGMA, border: 'reflect-within-region', k1: 0.01, k2: 0.03, downsample: false } };
}
