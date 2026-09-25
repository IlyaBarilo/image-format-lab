import { pngHeader, decodePng, encodePng, encodeIndexedPng, pngPreview, checkPngSize, PNG_MAX_FILE_BYTES } from '../core/png.mjs';

export function createPng({},deps){
  const exactSourceFiles=new WeakSet();
  async function pngCodec(){await deps.loadScript('vendor/pako-2.1.0.min.js');return window.pako;}
  async function decodePngFile(file,exact=false){
    const requireExact=exact||exactSourceFiles.has(file);
    const header=pngHeader(new Uint8Array(await file.slice(0,33).arrayBuffer()));
    if(!header){if(requireExact)throw new Error('Ожидался сохранённый PNG.');return null;}
    if(header.depth!==16&&!requireExact)return null;
    checkPngSize(header.width,header.height);
    if(file.size>PNG_MAX_FILE_BYTES)throw new Error('PNG: точное чтение ограничено файлом 128 МиБ.');
    const pixelBuffer=decodePng(new Uint8Array(await file.arrayBuffer()),await pngCodec());
    const preview=pngPreview(pixelBuffer);
    const imageData=new ImageData(preview.data,preview.width,preview.height);
    return {width:pixelBuffer.width,height:pixelBuffer.height,pixelBuffer,imageData};
  }
  async function encodeExactPng(pixels,depth){return encodePng(pixels,depth,await pngCodec());}
  async function encodePalettePng(source,colors,dither){return encodeIndexedPng(source,colors,dither,await pngCodec());}
  function registerExactPngFile(file){exactSourceFiles.add(file);}
  return {decodePngFile,encodeExactPng,encodePalettePng,registerExactPngFile};
}
