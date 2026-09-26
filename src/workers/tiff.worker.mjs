import { createJpegDecoder } from '../core/jpeg.mjs';
import { encodeJpegPixels } from '../core/jpeg-encode.mjs';
import { installTiffJpeg } from '../core/tiff-jpeg.mjs';
import { decodeLegacyTiff } from '../core/tiff-legacy.mjs';
import { decodeBmpPixels, decodeTiffPixels, encodeTiffPixels } from '../core/raster-codecs.mjs';
import { decodeTiff16, encodeTiff16 } from '../core/tiff16.mjs';
import { decodeTiffFloat } from '../core/tiff-float.mjs';
import { pngPreview } from '../core/png.mjs';

let modulePromise;
function moduleReady() {
  return modulePromise ||= Promise.all([ViewerJpegModule({print(){},printErr(){}}),ViewerBmpModule({print(){},printErr(){}}),ViewerTiffModule({print(){},printErr(){}})]).then(([jpeg,bmp,tiff])=>{
    installTiffJpeg(UTIF,createJpegDecoder(jpeg));return {jpeg,bmp,tiff};
  });
}
self.onmessage=async({data:request})=>{
  const {id,type}=request;
  try {
    const codec=await moduleReady();
    if(type==='init'){self.postMessage({type:'ready',codec:'tiff',jpegVersion:codec.jpeg.UTF8ToString(codec.jpeg._viewer_jpeg_version())});return;}
    if(type==='encode'){
      const buffer=request.exactBuffer
        ? encodeTiff16({width:request.width,height:request.height,
          data:request.sampleType==='uint16'?new Uint16Array(request.exactBuffer):new Uint8Array(request.exactBuffer),
          sampleType:request.sampleType,bitDepth:request.bitDepth,colorSpace:request.colorSpace},request.options,pako)
        : encodeTiffPixels(codec.tiff,{width:request.width,height:request.height,data:new Uint8ClampedArray(request.buffer)},request.options);
      self.postMessage({type:'encoded',id,buffer},[buffer]);return;
    }
    if(type==='encode-jpeg'){
      const buffer=encodeJpegPixels(codec.jpeg,{width:request.width,height:request.height,data:new Uint8ClampedArray(request.buffer)},request.options);
      self.postMessage({type:'encoded',id,buffer},[buffer]);return;
    }
    let result;
    if(type==='decode-bmp')result=decodeBmpPixels(codec.bmp,request.buffer,request.ico);
    else if(type==='decode'){
      const floating=decodeTiffFloat(request.buffer,request.page??0,pako);
      if(floating){
        self.postMessage({type:'decoded',id,width:floating.pixels.width,height:floating.pixels.height,
          pages:floating.pages,buffer:floating.preview.buffer,exactBuffer:floating.pixels.data.buffer,
          sampleType:'float32',floatStats:floating.stats,
          precisionNote:'float32 исходник · SDR-предпросмотр 8 бит (обрезка 0–1)'},
        [floating.preview.buffer,floating.pixels.data.buffer]);return;
      }
      const exact=decodeTiff16(request.buffer,request.page??0,pako);
      if(exact&&!exact.fallback){
        const preview=exact.iccProfile?null:pngPreview(exact);
        const transfers=[exact.data.buffer];
        if(preview)transfers.push(preview.data.buffer);
        if(exact.iccProfile)transfers.push(exact.iccProfile.buffer);
        self.postMessage({type:'decoded',id,width:exact.width,height:exact.height,pages:exact.pages,
          buffer:preview?.data.buffer??null,exactBuffer:exact.data.buffer,
          iccProfileBuffer:exact.iccProfile?.buffer??null},transfers);return;
      }
      try {result=decodeTiffPixels(codec.tiff,request.buffer,request.page??0);}
      catch(nativeError){
        try {result=decodeLegacyTiff(UTIF,request.buffer,request.page??0);}
        catch(legacyError){throw new Error(nativeError.message+'; '+legacyError.message);}
      }
      if(exact?.fallback)result.precisionNote=exact.precisionNote;
    }else throw new Error('Unknown raster operation');
    self.postMessage({type:'decoded',id,...result},[result.buffer]);
  }catch(error){self.postMessage({type:'error',id,message:error?.message||String(error)});}
};
