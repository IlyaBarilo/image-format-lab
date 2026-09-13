// Project implementation, MIT. Exact counts of decoded 8-bit RGBA samples.
// RGB is composited in code-value space on an explicitly selected neutral matte.
import { analysisBounds } from './analysis-region.mjs';
export function computeHistogram(imageData, matte = 'white', region = null) {
  const bounds = analysisBounds(imageData, region);
  const { width, height, data } = imageData;
  if (matte !== 'white' && matte !== 'black') throw new Error('Неизвестная подложка анализа.');
  const channels = Array.from({ length: 4 }, () => new Uint32Array(256));
  const background = matte === 'white' ? 255 : 0;
  for (let y = bounds.y; y < bounds.y + bounds.height; y++) for (let x = bounds.x; x < bounds.x + bounds.width; x++) {
    const i = (y * width + x) * 4;
    const alpha = data[i + 3], rest = background * (255 - alpha);
    channels[0][Math.round((data[i] * alpha + rest) / 255)]++;
    channels[1][Math.round((data[i + 1] * alpha + rest) / 255)]++;
    channels[2][Math.round((data[i + 2] * alpha + rest) / 255)]++;
    channels[3][alpha]++;
  }
  return { width, height, bounds, pixelCount: bounds.width * bounds.height, matte, channels };
}
