// Own SDR sRGB color analysis, MIT. CIE xy uses D65; Lab/Delta E 00 use D50.
// Matrices and reference white: W3C CSS Color 4, sample color-conversion math.
// Delta E 00 equations: Sharma, Wu and Dalal, Color Research & Application 30 (2005).
import { createPixelBuffer } from './pixel-buffer.mjs';
import { analysisRegionBounds } from './analysis-region.mjs';

export const COLOR_SAMPLE_LIMIT = 500000;
export const CIE_GRID_SIZE = 257;
export const CIE_X_MAX = 0.8;
export const CIE_Y_MAX = 0.9;
const D50 = [0.3457 / 0.3585, 1, (1 - 0.3457 - 0.3585) / 0.3585];
const PI = Math.PI;
const TO_RAD = PI / 180;
const POW_25_7 = 25 ** 7;

function linear(code) { return code <= 0.04045 ? code / 12.92 : ((code + 0.055) / 1.055) ** 2.4; }
export function srgbToXyzD65(r, g, b) {
  const a = linear(r), c = linear(g), d = linear(b);
  return [
    506752 / 1228815 * a + 87881 / 245763 * c + 12673 / 70218 * d,
    87098 / 409605 * a + 175762 / 245763 * c + 12673 / 175545 * d,
    7918 / 409605 * a + 87881 / 737289 * c + 1001167 / 1053270 * d
  ];
}
export function xyzChromaticity([x, y, z]) {
  const sum = x + y + z;
  return sum > 1e-15 ? [x / sum, y / sum] : null;
}
export function xyzD65ToLabD50([x, y, z]) {
  const adapted = [
    1.0479297925449969 * x + 0.022946870601609652 * y - 0.05019226628920524 * z,
    0.02962780877005599 * x + 0.9904344267538799 * y - 0.017073799063418826 * z,
    -0.009243040646204504 * x + 0.015055191490298152 * y + 0.7518742814281371 * z
  ];
  const epsilon = 216 / 24389, kappa = 24389 / 27;
  const f = adapted.map((value, i) => {
    const n = value / D50[i];
    return n > epsilon ? Math.cbrt(n) : (kappa * n + 16) / 116;
  });
  return [116 * f[1] - 16, 500 * (f[0] - f[1]), 200 * (f[1] - f[2])];
}
export function srgbToLabD50(r, g, b) { return xyzD65ToLabD50(srgbToXyzD65(r, g, b)); }

export function deltaE00([l1, a1, b1], [l2, a2, b2]) {
  if (![l1, a1, b1, l2, a2, b2].every(Number.isFinite)) throw new TypeError('Delta E 00: нужны конечные значения Lab.');
  const c1 = Math.hypot(a1, b1), c2 = Math.hypot(a2, b2), meanC = (c1 + c2) / 2;
  const g = 0.5 * (1 - Math.sqrt(meanC ** 7 / (meanC ** 7 + POW_25_7)));
  const aa1 = (1 + g) * a1, aa2 = (1 + g) * a2;
  const cc1 = Math.hypot(aa1, b1), cc2 = Math.hypot(aa2, b2);
  const hue = (aa, bb, cc) => cc === 0 ? 0 : (Math.atan2(bb, aa) / TO_RAD + 360) % 360;
  const h1 = hue(aa1, b1, cc1), h2 = hue(aa2, b2, cc2);
  let dh = h2 - h1;
  if (cc1 * cc2 === 0) dh = 0;
  else if (dh > 180) dh -= 360;
  else if (dh < -180) dh += 360;
  const deltaL = l2 - l1, deltaC = cc2 - cc1, deltaH = 2 * Math.sqrt(cc1 * cc2) * Math.sin(dh * TO_RAD / 2);
  const meanL = (l1 + l2) / 2, meanCc = (cc1 + cc2) / 2;
  let meanH;
  if (cc1 * cc2 === 0) meanH = h1 + h2;
  else if (Math.abs(h1 - h2) <= 180) meanH = (h1 + h2) / 2;
  else if (h1 + h2 < 360) meanH = (h1 + h2 + 360) / 2;
  else meanH = (h1 + h2 - 360) / 2;
  const t = 1 - 0.17 * Math.cos((meanH - 30) * TO_RAD)
    + 0.24 * Math.cos(2 * meanH * TO_RAD) + 0.32 * Math.cos((3 * meanH + 6) * TO_RAD)
    - 0.20 * Math.cos((4 * meanH - 63) * TO_RAD);
  const theta = 30 * Math.exp(-(((meanH - 275) / 25) ** 2));
  const rotation = -2 * Math.sin(2 * theta * TO_RAD) * Math.sqrt(meanCc ** 7 / (meanCc ** 7 + POW_25_7));
  const lightness = 1 + 0.015 * (meanL - 50) ** 2 / Math.sqrt(20 + (meanL - 50) ** 2);
  const chroma = 1 + 0.045 * meanCc, hueWeight = 1 + 0.015 * meanCc * t;
  const dl = deltaL / lightness, dc = deltaC / chroma, hd = deltaH / hueWeight;
  return Math.sqrt(Math.max(0, dl * dl + dc * dc + hd * hd + rotation * dc * hd));
}

function raster(input) {
  const pixels = createPixelBuffer(input);
  if (!((pixels.sampleType === 'uint8' && pixels.bitDepth === 8) || (pixels.sampleType === 'uint16' && pixels.bitDepth === 16)))
    throw new Error('Цветовой анализ поддерживает целые RGBA8 и RGBA16.');
  if (pixels.alphaMode !== 'straight') throw new Error('Цветовой анализ требует прямую прозрачность.');
  if (!['srgb', 'unknown'].includes(pixels.colorSpace)) throw new Error('Цветовой анализ требует SDR sRGB; для другого пространства сначала нужно преобразование.');
  return pixels;
}
function backgroundFor(matte) {
  if (matte !== 'white' && matte !== 'black') throw new Error('Неизвестная подложка анализа.');
  return matte === 'white' ? 1 : 0;
}
function colorAt(pixels, at, background) {
  const peak = 2 ** pixels.bitDepth - 1, alpha = pixels.data[at + 3] / peak;
  return [0, 1, 2].map(c => Math.round((pixels.data[at + c] / peak * alpha + background * (1 - alpha)) * peak) / peak);
}
function sampleBounds(pixels, region, maxSamples) {
  if (!Number.isInteger(maxSamples) || maxSamples < 1 || maxSamples > COLOR_SAMPLE_LIMIT) throw new RangeError('Некорректный предел отсчётов цвета.');
  const bounds = analysisRegionBounds(pixels.width, pixels.height, region);
  const pixelCount = bounds.width * bounds.height, sampleCount = Math.min(pixelCount, maxSamples);
  return { bounds, pixelCount, sampleCount };
}
function pixelOffset(pixels, bounds, sample, pixelCount, sampleCount) {
  const position = Math.floor((sample + 0.5) * pixelCount / sampleCount);
  return ((bounds.y + Math.floor(position / bounds.width)) * pixels.width + bounds.x + position % bounds.width) * 4;
}
export function computeCieXy(input, matte = 'white', region = null, maxSamples = COLOR_SAMPLE_LIMIT) {
  const pixels = raster(input), background = backgroundFor(matte);
  const { bounds, pixelCount, sampleCount } = sampleBounds(pixels, region, maxSamples);
  const bins = new Uint32Array(CIE_GRID_SIZE ** 2);
  let blackCount = 0, occupiedBins = 0;
  for (let n = 0; n < sampleCount; n++) {
    const at = pixelOffset(pixels, bounds, n, pixelCount, sampleCount);
    const xy = xyzChromaticity(srgbToXyzD65(...colorAt(pixels, at, background)));
    if (!xy) { blackCount++; continue; }
    const bx = Math.max(0, Math.min(CIE_GRID_SIZE - 1, Math.floor(xy[0] / CIE_X_MAX * CIE_GRID_SIZE)));
    const by = Math.max(0, Math.min(CIE_GRID_SIZE - 1, Math.floor((1 - xy[1] / CIE_Y_MAX) * CIE_GRID_SIZE)));
    const index = by * CIE_GRID_SIZE + bx;
    if (!bins[index]) occupiedBins++;
    bins[index]++;
  }
  return { width: pixels.width, height: pixels.height, bounds, pixelCount, sampleCount,
    exact: sampleCount === pixelCount, matte, size: CIE_GRID_SIZE, xMax: CIE_X_MAX, yMax: CIE_Y_MAX,
    bins, blackCount, occupiedBins, colorAssumption: pixels.colorSpace === 'unknown' ? 'srgb-assumed' : 'srgb-managed' };
}
export function computeDeltaE00(input, reference, matte = 'white', region = null, maxSamples = COLOR_SAMPLE_LIMIT) {
  const result = raster(input), source = raster(reference), background = backgroundFor(matte);
  if (result.width !== source.width || result.height !== source.height)
    throw new Error('ΔE00 требует одинаковых размеров результата и исходника.');
  const { bounds, pixelCount, sampleCount } = sampleBounds(result, region, maxSamples);
  let sum = 0, maximum = 0, changed = 0;
  for (let n = 0; n < sampleCount; n++) {
    const at = pixelOffset(result, bounds, n, pixelCount, sampleCount);
    const rgb = colorAt(result, at, background), original = colorAt(source, at, background);
    const error = deltaE00(srgbToLabD50(...original), srgbToLabD50(...rgb));
    sum += error; maximum = Math.max(maximum, error); if (error > 1e-12) changed++;
  }
  return { width: result.width, height: result.height, bounds, pixelCount, sampleCount,
    exact: sampleCount === pixelCount, matte, mean: sum / sampleCount, maximum, changed,
    bitDepth: { result: result.bitDepth, source: source.bitDepth },
    colorAssumption: result.colorSpace === 'unknown' || source.colorSpace === 'unknown' ? 'srgb-assumed' : 'srgb-managed',
    method: { name: 'CIEDE2000', source: 'SDR sRGB', labWhite: 'D50', chromaticityWhite: 'D65', weighting: [1, 1, 1], sampling: 'stratified-midpoint' } };
}
