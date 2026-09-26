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
    description:'Точный 16-битный градиент с различающимися младшими разрядами.'}),
  Object.freeze({id:'iccP3',label:'PNG16 · цветовой профиль P3',fileName:'ifl-p3-icc16-v1.png',size:'256×128',
    description:'Градиент с синтетическим ICC Display P3: сравните исходные значения и sRGB-показ.'}),
  Object.freeze({id:'tiffFloat',label:'TIFF float32 · диапазон значений',fileName:'ifl-float32-v1.tif',size:'64×32',
    description:'Дробные и отрицательные значения, участки выше 1 и полупрозрачность. Показ — условный SDR.'})
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

export function createTiffFloatSample() {
  const width=64,height=32,data=new Float32Array(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const at=(y*width+x)*4;
    data[at]=-0.25+2.25*x/(width-1);
    data[at+1]=y/(height-1);
    data[at+2]=0.25;
    data[at+3]=x<width/4?0:x<width/2?0.5:1;
  }
  const pixels=createPixelBuffer({width,height,data,sampleType:'float32',bitDepth:32,colorSpace:'unknown'});
  const tags=[[256,4,1,width],[257,4,1,height],[258,3,4,0],[259,3,1,1],[262,3,1,2],
    [273,4,1,0],[277,3,1,4],[278,4,1,height],[279,4,1,data.byteLength],
    [284,3,1,1],[338,3,1,2],[339,3,4,0]];
  const bitsAt=8+2+tags.length*12+4,formatsAt=bitsAt+8,pixelsAt=formatsAt+8;
  tags.find(tag=>tag[0]===258)[3]=bitsAt;
  tags.find(tag=>tag[0]===339)[3]=formatsAt;
  tags.find(tag=>tag[0]===273)[3]=pixelsAt;
  const bytes=new Uint8Array(pixelsAt+data.byteLength),view=new DataView(bytes.buffer);
  bytes.set([73,73]);view.setUint16(2,42,true);view.setUint32(4,8,true);view.setUint16(8,tags.length,true);
  tags.forEach(([tag,type,count,value],index)=>{
    const at=10+index*12;
    view.setUint16(at,tag,true);view.setUint16(at+2,type,true);view.setUint32(at+4,count,true);
    if(type===3&&count===1)view.setUint16(at+8,value,true);else view.setUint32(at+8,value,true);
  });
  for(let c=0;c<4;c++){
    view.setUint16(bitsAt+c*2,32,true);
    view.setUint16(formatsAt+c*2,3,true);
  }
  for(let i=0;i<data.length;i++)view.setFloat32(pixelsAt+i*4,data[i],true);
  return {pixels,bytes};
}

export function createIccP3Sample() {
  const width=256,height=128,data=new Uint16Array(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const at=(y*width+x)*4;
    data[at]=Math.round(65535*x/(width-1));
    data[at+1]=Math.round(65535*y/(height-1));
    data[at+2]=Math.round(65535*(1-x/(width-1)));
    data[at+3]=65535;
  }
  const pixels=createPixelBuffer({width,height,data,sampleType:'uint16',bitDepth:16,alphaMode:'straight'});
  const iccProfile=new Uint8Array(416),view=new DataView(iccProfile.buffer);
  const ascii=(offset,value)=>{for(let i=0;i<value.length;i++)iccProfile[offset+i]=value.charCodeAt(i);};
  view.setUint32(0,iccProfile.length);
  ascii(4,'IFL ');
  view.setUint32(8,0x04300000);
  ascii(12,'mntr');ascii(16,'RGB ');ascii(20,'XYZ ');ascii(36,'acsp');
  ascii(40,'MSFT');ascii(80,'IFL ');
  for(const [index,value] of [0.9642,1,0.8249].entries())
    view.setInt32(68+index*4,Math.round(value*65536));
  view.setUint32(128,7);
  const names=['rXYZ','gXYZ','bXYZ','rTRC','gTRC','bTRC','wtpt'];
  const matrix=[
    [0.515102,0.241182,-0.001049],
    [0.291965,0.692236,0.041882],
    [0.157153,0.066582,0.784378]
  ];
  for(let index=0;index<names.length;index++){
    const offset=216+(index<3?index*20:index<6?60+(index-3)*40:180);
    const size=index>=3&&index<6?40:20;
    ascii(132+index*12,names[index]);
    view.setUint32(136+index*12,offset);
    view.setUint32(140+index*12,size);
    if(index<3||index===6){
      ascii(offset,'XYZ ');
      const values=index===6?[0.9642,1,0.8249]:matrix[index];
      for(let row=0;row<3;row++)view.setInt32(offset+8+row*4,Math.round(values[row]*65536));
    }else{
      ascii(offset,'para');view.setUint16(offset+8,4);
      const values=[2.4,1/1.055,0.055/1.055,1/12.92,0.04045,0,0];
      for(let part=0;part<values.length;part++)view.setInt32(offset+12+part*4,Math.round(values[part]*65536));
    }
  }
  return {pixels,iccProfile};
}
