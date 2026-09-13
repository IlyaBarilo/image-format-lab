// Own Cb/Cr density scope, MIT. ITU-R BT.709-6 sections 3.2–3.3 coefficients,
// applied to decoded RGB8 code values, without broadcast-range quantization.
import { analysisBounds } from './analysis-region.mjs';
export function chromaCoordinates(r, g, b) {
  const y = (2126*r + 7152*g + 722*b) / 10000;
  return { cb: (b-y) / (1.8556*255), cr: (r-y) / (1.5748*255) };
}
export function computeVectorscope(imageData, matte = 'white', region = null) {
  const bounds=analysisBounds(imageData,region), {width,height,data}=imageData;
  if(matte!=='white'&&matte!=='black')throw new Error('Неизвестная подложка анализа.');
  const size=257, bins=new Uint32Array(size*size), background=matte==='white'?255:0;
  let sumCb=0,sumCr=0;
  for(let y=bounds.y;y<bounds.y+bounds.height;y++)for(let x=bounds.x;x<bounds.x+bounds.width;x++){
    const i=(y*width+x)*4,a=data[i+3],rest=background*(255-a);
    const r=Math.round((data[i]*a+rest)/255),g=Math.round((data[i+1]*a+rest)/255),b=Math.round((data[i+2]*a+rest)/255);
    const {cb,cr}=chromaCoordinates(r,g,b);
    const bx=Math.max(0,Math.min(256,Math.round((cb+0.5)*256)));
    const by=Math.max(0,Math.min(256,Math.round((0.5-cr)*256)));
    bins[by*size+bx]++;sumCb+=cb;sumCr+=cr;
  }
  const pixelCount=bounds.width*bounds.height;
  return {width,height,bounds,pixelCount,matte,size,bins,meanCb:sumCb/pixelCount,meanCr:sumCr/pixelCount};
}
