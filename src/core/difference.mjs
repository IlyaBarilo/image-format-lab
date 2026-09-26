// Own absolute difference map, MIT. No registration or resampling of input images.
import { analysisRegionBounds } from './analysis-region.mjs';
import { comparableErrorRasters } from './error-histogram.mjs';
export function differenceColor(error, gain = 1) {
  const stops = [[0,0,0],[0,180,200],[255,224,80],[255,48,64]];
  const ratio = Math.max(0,Math.min(1,error * gain / 255));
  const value = ratio === 0 ? 0 : Math.max(0.15,ratio * 3);
  const index = Math.min(2,Math.floor(value)), mix = value-index;
  return stops[index].map((channel,c)=>Math.round(channel+(stops[index+1][c]-channel)*mix));
}
export function computeDifference(imageData, reference, matte = 'white', region = null) {
  const {current,source,currentPeak,sourcePeak,colorComparison}=comparableErrorRasters(imageData,reference,matte);
  const {width,height,data}=current,original=source.data;
  const bounds=analysisRegionBounds(width,height,region);
  const scale = Math.min(1, 512 / Math.max(bounds.width, bounds.height));
  const mapWidth = Math.max(1, Math.round(bounds.width * scale)), mapHeight = Math.max(1, Math.round(bounds.height * scale));
  const maps = [new Uint8Array(mapWidth * mapHeight), new Uint8Array(mapWidth * mapHeight)];
  const sums = [0,0], maxima = [0,0], changed = [0,0];
  const sameDepth=currentPeak===sourcePeak;
  for (let y = 0; y < bounds.height; y++) for (let x = 0; x < bounds.width; x++) {
    const i = ((y + bounds.y) * width + x + bounds.x) * 4;
    const a = data[i+3], b = original[i+3];
    if(a>currentPeak||b>sourcePeak)throw new Error('Отсчёт альфы не соответствует разрядности карты различий.');
    let rgb = 0;
    for (let c = 0; c < 3; c++) {
      const cv=data[i+c],sv=original[i+c];
      if(cv>currentPeak||sv>sourcePeak)throw new Error('Отсчёт цвета не соответствует разрядности карты различий.');
      const v = Math.round(((current.alphaMode==='straight'?cv*a:cv*currentPeak)+(matte==='white'?currentPeak*(currentPeak-a):0))/currentPeak);
      const r = Math.round(((source.alphaMode==='straight'?sv*b:sv*sourcePeak)+(matte==='white'?sourcePeak*(sourcePeak-b):0))/sourcePeak);
      if(v>currentPeak||r>sourcePeak)throw new Error('Некорректное предварительно умноженное значение карты различий.');
      rgb = Math.max(rgb, sameDepth?Math.abs(v-r)*255/currentPeak:Math.abs(v*sourcePeak-r*currentPeak)*255/(currentPeak*sourcePeak));
    }
    const errors = [rgb,sameDepth?Math.abs(a-b)*255/currentPeak:Math.abs(a*sourcePeak-b*currentPeak)*255/(currentPeak*sourcePeak)];
    const p = Math.floor(y * mapHeight / bounds.height) * mapWidth + Math.floor(x * mapWidth / bounds.width);
    for (let c=0;c<2;c++) {
      const error = errors[c];
      maps[c][p] = Math.max(maps[c][p],error===0?0:Math.max(1,Math.ceil(error-1e-12)));
      sums[c] += error; maxima[c] = Math.max(maxima[c],error); if(error)changed[c]++;
    }
  }
  const pixelCount = bounds.width * bounds.height;
  return { width, height, bounds, pixelCount, matte, mapWidth, mapHeight, maps,
    bitDepth:{result:current.bitDepth,source:source.bitDepth},
    colorSpace:{result:current.colorSpace,source:source.colorSpace},colorComparison,
    units:'8bit-equivalent',means: sums.map(sum=>sum/pixelCount), maxima, changed };
}
