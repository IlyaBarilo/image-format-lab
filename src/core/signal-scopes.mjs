// Computed BT.709 code-value scopes from the decoded RGB8 preview, MIT.
// Cb/Cr are full-range display bins, not native codec planes or video-range samples.
import { analysisBounds } from './analysis-region.mjs';

export function signalLevels(r, g, b, output = [0, 0, 0]) {
  const y = (2126 * r + 7152 * g + 722 * b) / 10000;
  const cb = (b - y) / 1.8556;
  const cr = (r - y) / 1.5748;
  output[0] = Math.round(y);
  output[1] = Math.max(0, Math.min(255, Math.round(cb + 128)));
  output[2] = Math.max(0, Math.min(255, Math.round(cr + 128)));
  return output;
}

export function computeSignalHistogram(imageData, matte = 'white', region = null) {
  const bounds = analysisBounds(imageData, region);
  if (matte !== 'white' && matte !== 'black') throw new Error('Неизвестная подложка анализа.');
  const { width, height, data } = imageData;
  const background = matte === 'white' ? 255 : 0;
  const channels = Array.from({ length: 3 }, () => new Uint32Array(256));
  const sums = new Float64Array(3);
  const levels = [0, 0, 0];
  for (let y = bounds.y; y < bounds.y + bounds.height; y++) for (let x = bounds.x; x < bounds.x + bounds.width; x++) {
    const i = (y * width + x) * 4, alpha = data[i + 3], rest = background * (255 - alpha);
    const r = Math.round((data[i] * alpha + rest) / 255);
    const g = Math.round((data[i + 1] * alpha + rest) / 255);
    const b = Math.round((data[i + 2] * alpha + rest) / 255);
    signalLevels(r, g, b, levels);
    for (let channel = 0; channel < 3; channel++) { const value = levels[channel]; channels[channel][value]++; sums[channel] += value; }
  }
  const pixelCount = bounds.width * bounds.height;
  return { width, height, bounds, pixelCount, matte, channels, sampleType: 'uint8', bitDepth: 8,
    colorSpace: 'derived-rgb8', scale: { kind: 'integer', min: 0, max: 255, bins: 256, alphaMax: 255, white: 255 },
    means: sums.map(sum => sum / pixelCount), signal: 'BT.709-derived-RGB8',
    cbCr: 'full-range-offset-128' };
}
