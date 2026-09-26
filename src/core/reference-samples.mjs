// Reproducible RGBA8 inputs made from integer pixel formulas; no Canvas or external images.
import { createPixelBuffer } from './pixel-buffer.mjs';

export const REFERENCE_SAMPLES = Object.freeze({
  gradient: Object.freeze({label:'Градиенты и резкие границы',fileName:'ifl-gradient-v1.png',experiment:'photo',description:'Плавные переходы, контрастные границы и тонкие линии.'}),
  alpha: Object.freeze({label:'Прозрачность и цвет',fileName:'ifl-alpha-v1.png',experiment:'alpha',description:'Прозрачные и полупрозрачные области, включая скрытый RGB.'}),
  palette: Object.freeze({label:'Палитра и дизеринг',fileName:'ifl-palette-v1.png',experiment:'palette',description:'Градиенты, редкие цвета и детерминированная мелкая текстура.'})
});

export const SAMPLE_CATALOG = Object.freeze([
  Object.freeze({id:'canvas',label:'Текст, линии и прозрачность',fileName:'sample-alpha-lines.png',size:'960×640',
    description:'Текст, тонкие линии, цветные переходы и прозрачные детали.'}),
  ...Object.entries(REFERENCE_SAMPLES).map(([id, sample]) => Object.freeze({id,...sample,size:'512×320'})),
  Object.freeze({id:'tiff16',label:'TIFF16 · точность градиента',fileName:'ifl-tiff16-v1.tif',size:'512×256',
    description:'Точный 16-битный градиент с различающимися младшими разрядами.'})
]);

export function createReferenceSamplePixels(id) {
  if (!Object.hasOwn(REFERENCE_SAMPLES,id)) throw new Error('Неизвестный контрольный образец.');
  const width=512,height=320,data=new Uint8Array(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const i=(y*width+x)*4,t=Math.round(x*255/(width-1)),v=Math.round(y*255/(height-1));
    let r,g,b,a=255;
    if(id==='gradient'){
      if(y<80){r=g=b=t;}
      else if(y<160){r=t;g=v;b=255-t;}
      else if(y<240){const edge=x%64<32?24:232;r=edge;g=(x+y)%8<4?edge:255-edge;b=v;}
      else {const line=x%4===0||y%4===0;r=line?12:t;g=line?244:255-t;b=line?128:v;}
    }else if(id==='alpha'){
      r=t;g=255-t;b=(x*7+y*11)&255;
      a=y<80?0:y<160?t:y<240?128:(x%32<16?0:255);
    }else{
      const noise=(Math.imul(x+1,1103515245)^Math.imul(y+1,12345))>>>0;
      r=y<160?t:(t+(noise&31))&255;
      g=y<160?v:((x>>2)*17+(noise>>>8&15))&255;
      b=y<160?255-t:((y>>2)*23+(noise>>>16&15))&255;
    }
    data[i]=r;data[i+1]=g;data[i+2]=b;data[i+3]=a;
  }
  return createPixelBuffer({width,height,data,sampleType:'uint8',bitDepth:8,colorSpace:'srgb',alphaMode:'straight'});
}

export function createTiff16SamplePixels() {
  const width=512,height=256,data=new Uint16Array(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const at=(y*width+x)*4;
    data[at]=Math.round(x*65535/(width-1));
    data[at+1]=Math.round(y*65535/(height-1));
    data[at+2]=(x*257+y*73)&65535;
    data[at+3]=65535;
  }
  return createPixelBuffer({width,height,data,sampleType:'uint16',bitDepth:16,colorSpace:'srgb',alphaMode:'straight'});
}
