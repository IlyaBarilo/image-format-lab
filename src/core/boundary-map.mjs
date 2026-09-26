// Own exact integer code-value boundaries, MIT. A boundary is not proof of clipping.
import { analysisRegionBounds } from './analysis-region.mjs';
import { createPixelBuffer } from './pixel-buffer.mjs';

export const BOUNDARY_COLORS = Object.freeze([
  [16, 25, 35], [49, 184, 220], [255, 184, 72], [210, 107, 236]
]);

export function computeBoundaryMap(input, matte = 'white', region = null) {
  const pixels = createPixelBuffer(input);
  const { width, height, data, sampleType, bitDepth, colorSpace, alphaMode } = pixels;
  if (!((sampleType === 'uint8' && bitDepth === 8) || (sampleType === 'uint16' && bitDepth === 16)))
    throw new Error('Карта границ диапазона поддерживает только целые RGBA8/16.');
  if (matte !== 'white' && matte !== 'black') throw new Error('Неизвестная подложка анализа.');
  const bounds = analysisRegionBounds(width, height, region);
  const peak = 2 ** bitDepth - 1, background = matte === 'white' ? peak : 0;
  const scale = Math.min(1, 512 / Math.max(bounds.width, bounds.height));
  const mapWidth = Math.max(1, Math.round(bounds.width * scale));
  const mapHeight = Math.max(1, Math.round(bounds.height * scale));
  const maps = [new Uint8Array(mapWidth * mapHeight), new Uint8Array(mapWidth * mapHeight)];
  const counts = [{low:0,high:0,both:0,any:0},{low:0,high:0,both:0,any:0}];
  for (let y = 0; y < bounds.height; y++) for (let x = 0; x < bounds.width; x++) {
    const i = ((y + bounds.y) * width + x + bounds.x) * 4, alpha = data[i + 3];
    if (alpha > peak) throw new Error('Отсчёт альфы не соответствует разрядности карты границ.');
    let rgb = 0;
    for (let c = 0; c < 3; c++) {
      const raw = data[i + c];
      if (raw > peak) throw new Error('Отсчёт цвета не соответствует разрядности карты границ.');
      const value = Math.round(((alphaMode === 'straight' ? raw * alpha : raw * peak) + background * (peak - alpha)) / peak);
      if (value > peak) throw new Error('Некорректное предварительно умноженное значение карты границ.');
      if (value === 0) rgb |= 1;
      if (value === peak) rgb |= 2;
    }
    const states = [rgb, (alpha === 0 ? 1 : 0) | (alpha === peak ? 2 : 0)];
    const p = Math.floor(y * mapHeight / bounds.height) * mapWidth + Math.floor(x * mapWidth / bounds.width);
    for (let c = 0; c < 2; c++) {
      const state = states[c], tally = counts[c];
      maps[c][p] |= state;
      if (state & 1) tally.low++;
      if (state & 2) tally.high++;
      if (state === 3) tally.both++;
      if (state) tally.any++;
    }
  }
  return {width, height, bounds, pixelCount:bounds.width * bounds.height, matte, sampleType, bitDepth, colorSpace,
    alphaMode, scaleMax:peak, mapWidth, mapHeight, maps, counts};
}
