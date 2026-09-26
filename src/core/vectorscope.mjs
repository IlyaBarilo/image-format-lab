// Own Cb/Cr density scope, MIT. ITU-R BT.709-6 sections 3.2–3.3 coefficients,
// applied to decoded integer RGB code values, without broadcast-range quantization.
import { analysisRegionBounds } from './analysis-region.mjs';
import { createPixelBuffer } from './pixel-buffer.mjs';
export function chromaCoordinates(r, g, b, scaleMax = 255) {
  const y = (2126*r + 7152*g + 722*b) / 10000;
  return { cb: (b-y) / (1.8556*scaleMax), cr: (r-y) / (1.5748*scaleMax) };
}
export function computeVectorscope(input, matte = 'white', region = null) {
  const {width,height,data,sampleType,bitDepth,colorSpace,alphaMode}=createPixelBuffer(input);
  if (!((sampleType==='uint8'&&bitDepth===8)||(sampleType==='uint16'&&bitDepth===16)))
    throw new Error('Вектороскоп поддерживает точные целые RGBA8 и RGBA16.');
  const bounds=analysisRegionBounds(width,height,region);
  if(matte!=='white'&&matte!=='black')throw new Error('Неизвестная подложка анализа.');
  const size=257, bins=new Uint32Array(size*size), scaleMax=2**bitDepth-1, background=matte==='white'?scaleMax:0;
  let sumCb=0,sumCr=0;
  const rgb=[0,0,0];
  for(let y=bounds.y;y<bounds.y+bounds.height;y++)for(let x=bounds.x;x<bounds.x+bounds.width;x++){
    const i=(y*width+x)*4,a=data[i+3];
    if(a>scaleMax)throw new Error('Отсчёт альфы не соответствует разрядности вектороскопа.');
    for(let c=0;c<3;c++){
      const raw=data[i+c];
      if(raw>scaleMax)throw new Error('Отсчёт цвета не соответствует разрядности вектороскопа.');
      const composed=Math.round(((alphaMode==='straight'?raw*a:raw*scaleMax)+background*(scaleMax-a))/scaleMax);
      if(composed>scaleMax)throw new Error('Некорректное предварительно умноженное значение вектороскопа.');
      rgb[c]=composed;
    }
    const {cb,cr}=chromaCoordinates(...rgb,scaleMax);
    const bx=Math.max(0,Math.min(256,Math.round((cb+0.5)*256)));
    const by=Math.max(0,Math.min(256,Math.round((0.5-cr)*256)));
    bins[by*size+bx]++;sumCb+=cb;sumCr+=cr;
  }
  const pixelCount=bounds.width*bounds.height;
  return {width,height,bounds,pixelCount,matte,size,bins,sampleType,bitDepth,colorSpace,alphaMode,
    meanCb:sumCb/pixelCount,meanCr:sumCr/pixelCount};
}
