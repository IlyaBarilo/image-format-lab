// Own absolute difference map, MIT. No registration or resampling of input images.
import { analysisBounds } from './analysis-region.mjs';
export function differenceColor(error, gain = 1) {
  const stops = [[0,0,0],[0,180,200],[255,224,80],[255,48,64]];
  const value = Math.max(0,Math.min(1,error * gain / 255)) * 3;
  const index = Math.min(2,Math.floor(value)), mix = value-index;
  return stops[index].map((channel,c)=>Math.round(channel+(stops[index+1][c]-channel)*mix));
}
export function computeDifference(imageData, reference, matte = 'white', region = null) {
  const bounds = analysisBounds(imageData, region);
  analysisBounds(reference, region);
  if (imageData.width !== reference.width || imageData.height !== reference.height)
    throw new Error(`Карта требует одинаковых размеров: ${imageData.width}×${imageData.height} и ${reference.width}×${reference.height}.`);
  if (matte !== 'white' && matte !== 'black') throw new Error('Неизвестная подложка анализа.');
  const { width, height, data } = imageData, original = reference.data;
  const scale = Math.min(1, 512 / Math.max(bounds.width, bounds.height));
  const mapWidth = Math.max(1, Math.round(bounds.width * scale)), mapHeight = Math.max(1, Math.round(bounds.height * scale));
  const maps = [new Uint8Array(mapWidth * mapHeight), new Uint8Array(mapWidth * mapHeight)];
  const sums = [0,0], maxima = [0,0], changed = [0,0], background = matte === 'white' ? 255 : 0;
  for (let y = 0; y < bounds.height; y++) for (let x = 0; x < bounds.width; x++) {
    const i = ((y + bounds.y) * width + x + bounds.x) * 4;
    const a = data[i+3], b = original[i+3];
    let rgb = 0;
    for (let c = 0; c < 3; c++) {
      const v = Math.round((data[i+c] * a + background * (255-a)) / 255);
      const r = Math.round((original[i+c] * b + background * (255-b)) / 255);
      rgb = Math.max(rgb, Math.abs(v-r));
    }
    const errors = [rgb, Math.abs(a-b)];
    const p = Math.floor(y * mapHeight / bounds.height) * mapWidth + Math.floor(x * mapWidth / bounds.width);
    for (let c=0;c<2;c++) {
      const error = errors[c];
      maps[c][p] = Math.max(maps[c][p], error);
      sums[c] += error; maxima[c] = Math.max(maxima[c],error); if(error)changed[c]++;
    }
  }
  const pixelCount = bounds.width * bounds.height;
  return { width, height, bounds, pixelCount, matte, mapWidth, mapHeight, maps,
    means: sums.map(sum=>sum/pixelCount), maxima, changed };
}
