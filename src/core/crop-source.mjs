import { analysisRegionBounds } from './analysis-region.mjs';
import { createPixelBuffer } from './pixel-buffer.mjs';
import { checkPngSize } from './png.mjs';

// Crop stored samples, never the screen preview or a re-encoded variant.
export function cropSourcePixels(input,region){
  const source=createPixelBuffer(input);
  if(!region)throw new Error('Сначала примените заданную область.');
  if(!['uint8','uint16'].includes(source.sampleType)||source.alphaMode!=='straight'||
      !['srgb','unknown'].includes(source.colorSpace)){
    throw new Error('Для этого исходника точное создание области в PNG не поддерживается.');
  }
  const bounds=analysisRegionBounds(source.width,source.height,region);
  checkPngSize(bounds.width,bounds.height);
  const data=new source.data.constructor(bounds.width*bounds.height*4);
  for(let row=0;row<bounds.height;row++){
    const from=((bounds.y+row)*source.width+bounds.x)*4;
    data.set(source.data.subarray(from,from+bounds.width*4),row*bounds.width*4);
  }
  return {bounds,pixels:createPixelBuffer({width:bounds.width,height:bounds.height,data,
    sampleType:source.sampleType,bitDepth:source.bitDepth,colorSpace:source.colorSpace,alphaMode:source.alphaMode})};
}

export function croppedSourceName(name,bounds){
  const stem=(String(name||'image').replace(/\.[^.]+$/,'')||'image');
  return `${stem}-area-x${bounds.x}-y${bounds.y}-${bounds.width}x${bounds.height}.png`;
}
