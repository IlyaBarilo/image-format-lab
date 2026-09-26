import { pngHeader, decodePng, encodePng, encodeIndexedPng, pngPreview, checkPngSize, PNG_MAX_FILE_BYTES } from '../core/png.mjs';
import { prepareIccSdr } from '../core/icc-sdr.mjs';

export function createPng({},deps){
  const exactSourceFiles=new WeakSet();
  async function pngCodec(){await deps.loadScript('vendor/pako-2.1.0.min.js');return window.pako;}
  async function hasEmbeddedIcc(file){
    let at=33;
    for(let count=0;at+8<=file.size&&count<4096;count++){
      const header=new Uint8Array(await file.slice(at,at+8).arrayBuffer());
      if(header.length!==8)throw new Error('PNG: обрезан заголовок блока.');
      const size=new DataView(header.buffer,header.byteOffset,8).getUint32(0);
      const end=at+12+size;
      if(size>0x7fffffff||end>file.size)throw new Error('PNG: неверная длина блока.');
      const name=String.fromCharCode(...header.subarray(4));
      if(name==='iCCP')return true;
      if(name==='IDAT'||name==='IEND')return false;
      at=end;
    }
    throw new Error('PNG: слишком много блоков или отсутствуют данные изображения.');
  }
  async function decodePngFile(file,exact=false){
    const requireExact=exact||exactSourceFiles.has(file);
    const header=pngHeader(new Uint8Array(await file.slice(0,33).arrayBuffer()));
    if(!header){if(requireExact)throw new Error('Ожидался сохранённый PNG.');return null;}
    if(header.depth!==16&&!requireExact&&!await hasEmbeddedIcc(file))return null;
    checkPngSize(header.width,header.height);
    if(file.size>PNG_MAX_FILE_BYTES)throw new Error('PNG: точное чтение ограничено файлом 128 МиБ.');
    const {pixels,iccProfile}=decodePng(new Uint8Array(await file.arrayBuffer()),await pngCodec(),{withIcc:true});
    const prepared=await prepareIccSdr(pixels,iccProfile);
    const pixelBuffer=prepared.pixelBuffer;
    const preview=pngPreview(pixelBuffer);
    const imageData=new ImageData(preview.data,preview.width,preview.height);
    return {width:pixelBuffer.width,height:pixelBuffer.height,...prepared,imageData,
      colorManagementNote:iccProfile?'ICC→sRGB':''};
  }
  async function encodeExactPng(pixels,depth,options){return encodePng(pixels,depth,await pngCodec(),options);}
  async function encodePalettePng(source,colors,dither,options){return encodeIndexedPng(source,colors,dither,await pngCodec(),options);}
  function registerExactPngFile(file){exactSourceFiles.add(file);}
  return {decodePngFile,encodeExactPng,encodePalettePng,registerExactPngFile};
}
