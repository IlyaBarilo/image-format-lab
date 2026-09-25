// Own spatial signal counts, MIT. Coefficients: ITU-R BT.709-6, section 3.2.
// Applied to decoded RGB8 code values, not linear light or broadcast-range IRE.
import { analysisBounds } from './analysis-region.mjs';
import { signalLevels } from './signal-scopes.mjs';
export function computeWaveform(imageData, matte = 'white', region = null) {
  const bounds = analysisBounds(imageData, region);
  const { width, height, data } = imageData;
  if (matte !== 'white' && matte !== 'black') throw new Error('Неизвестная подложка анализа.');
  const columns = Math.min(bounds.width, 256);
  const channels = Array.from({ length: 6 }, () => new Uint32Array(columns * 256));
  const columnPixels = new Uint32Array(columns);
  const levels = [0, 0, 0];
  const background = matte === 'white' ? 255 : 0;
  // Each source column goes into one spatial bin; every row contributes.
  for (let x = 0; x < bounds.width; x++) {
    const column = Math.floor(x * columns / bounds.width), offset = column * 256;
    columnPixels[column] += bounds.height;
    for (let y = 0, i = (bounds.y * width + bounds.x + x) * 4; y < bounds.height; y++, i += width * 4) {
      const alpha = data[i + 3], rest = background * (255 - alpha);
      const r = Math.round((data[i] * alpha + rest) / 255);
      const g = Math.round((data[i + 1] * alpha + rest) / 255);
      const b = Math.round((data[i + 2] * alpha + rest) / 255);
      signalLevels(r, g, b, levels);
      channels[0][offset + r]++;
      channels[1][offset + g]++;
      channels[2][offset + b]++;
      channels[3][offset + levels[0]]++;
      channels[4][offset + levels[1]]++;
      channels[5][offset + levels[2]]++;
    }
  }
  return { width, height, bounds, pixelCount: bounds.width * bounds.height, matte, columns, columnPixels, channels };
}
