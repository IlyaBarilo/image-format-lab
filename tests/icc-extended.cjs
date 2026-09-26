const assert=require('node:assert/strict');
const pako=require('../vendor/pako-2.1.0.min.js');

function chunk(name,data){
  const bytes=new Uint8Array(data.length+12),view=new DataView(bytes.buffer);
  view.setUint32(0,data.length);
  for(let i=0;i<4;i++)bytes[4+i]=name.charCodeAt(i);
  bytes.set(data,8);
  let crc=0xffffffff;
  for(let i=4;i<bytes.length-4;i++){
    crc^=bytes[i];
    for(let bit=0;bit<8;bit++)crc=crc&1?0xedb88320^(crc>>>1):crc>>>1;
  }
  view.setUint32(bytes.length-4,(crc^0xffffffff)>>>0);
  return bytes;
}

(async()=>{
  const {createIccP3Sample}=await import('../src/core/reference-samples.mjs');
  const {createPixelBuffer}=await import('../src/core/pixel-buffer.mjs');
  const {prepareIccSdr}=await import('../src/core/icc-sdr.mjs');
  const {decodePng,encodePng,pngPreview}=await import('../src/core/png.mjs');
  const {decodeTiff16,encodeTiff16}=await import('../src/core/tiff16.mjs');
  const {createPng}=await import('../src/services/png.mjs');
  const {createEncode}=await import('../src/services/encode.mjs');
  const iccProfile=createIccP3Sample().iccProfile;
  const native8=createPixelBuffer({width:2,height:1,sampleType:'uint8',bitDepth:8,colorSpace:'unknown',
    data:new Uint8ClampedArray([200,90,20,180,40,150,230,255])});
  const png8=encodePng(native8,8,pako,{iccProfile});
  const bytes8=new Uint8Array(await png8.arrayBuffer());
  const gamma=chunk('gAMA',Uint8Array.of(0,0,177,143)),chromaticity=chunk('cHRM',new Uint8Array(32));
  const profiledPng8=new Blob([bytes8.subarray(0,33),gamma,chromaticity,bytes8.subarray(33)],{type:'image/png'});
  const previousWindow=global.window,previousImageData=global.ImageData;
  global.window={pako};
  global.ImageData=class ImageData {constructor(data,width,height){Object.assign(this,{data,width,height});}};
  try {
    const {decodePngFile}=createPng({}, {loadScript:async()=>{}});
    assert.equal(await decodePngFile(encodePng(native8,8,pako)),null,'unprofiled PNG8 remains on the browser path');
    const opened=await decodePngFile(profiledPng8);
    assert.deepEqual(opened.nativePixelBuffer.data,native8.data);
    assert.deepEqual(opened.iccProfile,iccProfile);
    assert.equal(opened.pixelBuffer.colorSpace,'srgb');
    assert.equal(opened.colorManagementNote,'ICC→sRGB');
    assert.ok(opened.pixelBuffer.data.some((value,i)=>i%4!==3&&value!==native8.data[i]));
    assert.deepEqual(opened.imageData.data,opened.pixelBuffer.data);
    assert.deepEqual(decodePng(new Uint8Array(await profiledPng8.arrayBuffer()),pako,{withIcc:true}).iccProfile,iccProfile);

    const unsupported=iccProfile.slice();unsupported.set([67,77,89,75],16);
    await assert.rejects(decodePngFile(encodePng(native8,8,pako,{iccProfile:unsupported})),/RGB-профили/);
    const source={...opened,width:2,height:1};
    const calls=[];
    const {encodeOne}=createEncode({}, {
      outputDimensionsForConfig:()=>({width:2,height:1}),outputSourceForConfig:()=>source,
      encodeExactPng:async(pixels,depth,options)=>{calls.push({pixels,depth,options});return encodePng(pixels,depth,pako,options);},
      loadOptionalCodec:async()=>({encode:async(image,options,pixels)=>{
        calls.push({image,options,pixels});return new Blob([encodeTiff16(pixels,options,pako)],{type:'image/tiff'});
      }}),withEncodedMeta:result=>result
    });
    const pngSaved=await encodeOne({format:'png',pngDepth:'8'},source);
    assert.equal(pngSaved.exactPng,true);
    assert.equal(calls[0].pixels,opened.nativePixelBuffer);
    const pngAgain=decodePng(new Uint8Array(await pngSaved.blob.arrayBuffer()),pako,{withIcc:true});
    assert.deepEqual(pngAgain.pixels.data,native8.data);
    assert.deepEqual(pngAgain.iccProfile,iccProfile);

    const tiffSaved=await encodeOne({format:'tiff',tiffDepth:'16'},source);
    assert.equal(calls[1].pixels,opened.nativePixelBuffer);
    assert.deepEqual(calls[1].options.iccProfile,iccProfile);
    const tiffAgain=decodeTiff16(await tiffSaved.blob.arrayBuffer(),0,pako);
    assert.deepEqual(tiffAgain.iccProfile,iccProfile);
    assert.deepEqual([...tiffAgain.data],[...native8.data].map(value=>value*257));

    const native16=createPixelBuffer({width:2,height:1,sampleType:'uint16',bitDepth:16,colorSpace:'unknown',
      data:new Uint16Array([40000,10000,5000,32768,1000,35000,65000,65535])});
    const managed16=await prepareIccSdr(native16,iccProfile);
    const source16={...managed16,width:2,height:1,
      imageData:new ImageData(pngPreview(managed16.pixelBuffer).data,2,1)};
    const codecs=createEncode({}, {
      outputDimensionsForConfig:()=>({width:2,height:1}),outputSourceForConfig:()=>source16,
      encodeExactPng:async(pixels,depth,options)=>encodePng(pixels,depth,pako,options),
      loadOptionalCodec:async()=>({encode:async(image,options,pixels)=>new Blob([encodeTiff16(pixels,options,pako)])}),
      withEncodedMeta:result=>result
    });
    const down8=decodePng(new Uint8Array(await (await codecs.encodeOne({format:'png',pngDepth:'8'},source16)).blob.arrayBuffer()),pako,{withIcc:true});
    assert.deepEqual([...down8.pixels.data],[...native16.data].map(value=>Math.round(value/257)));
    assert.deepEqual(down8.iccProfile,iccProfile);
    const tiff16=decodeTiff16(await (await codecs.encodeOne({format:'tiff',tiffDepth:'16'},source16)).blob.arrayBuffer(),0,pako);
    assert.deepEqual(tiff16.data,native16.data);
    assert.deepEqual(tiff16.iccProfile,iccProfile);
    const visible=await prepareIccSdr(tiff16,tiff16.iccProfile);
    assert.deepEqual(visible.pixelBuffer.data,managed16.pixelBuffer.data);

    const malformed=encodeTiff16(native16,{tiffCompression:'none',iccProfile},pako);
    const view=new DataView(malformed),entryCount=view.getUint16(8,true);
    const tags=new Map();for(let i=0;i<entryCount;i++){const at=10+i*12;tags.set(view.getUint16(at,true),at);}
    assert.equal(view.getUint16(tags.get(34675)+2,true),7);
    assert.equal(view.getUint32(tags.get(34675)+4,true),iccProfile.length);
    const damaged=malformed.slice(),dv=new DataView(damaged);
    dv.setUint32(tags.get(34675)+8,damaged.byteLength-10,true);
    assert.throws(()=>decodeTiff16(damaged,0,pako),/ICC-профиль выходит/);
    const unsupportedLayout=malformed.slice(),uv=new DataView(unsupportedLayout);
    uv.setUint16(tags.get(259)+8,5,true);
    assert.throws(()=>decodeTiff16(unsupportedLayout,0,pako),/ICC-профиль требует точного/);
    const big=new ArrayBuffer(72),bv=new DataView(big);
    bv.setUint16(0,0x4949,true);bv.setUint16(2,43,true);bv.setUint16(4,8,true);
    bv.setBigUint64(8,16n,true);bv.setBigUint64(16,2n,true);
    bv.setUint16(24,258,true);bv.setUint16(26,3,true);bv.setBigUint64(28,1n,true);bv.setUint16(36,16,true);
    bv.setUint16(44,34675,true);bv.setUint16(46,7,true);bv.setBigUint64(48,BigInt(iccProfile.length),true);
    assert.throws(()=>decodeTiff16(big,0,pako),/ICC-профиль BigTIFF16/);
    assert.throws(()=>encodeTiff16({...native16,colorSpace:'srgb'},{iccProfile},pako),/ICC-профиль/);
    console.log('PASS profiled PNG8/TIFF16 SDR conversion, native values, ICC round trips and explicit rejection');
  } finally {global.window=previousWindow;global.ImageData=previousImageData;}
})().catch(error=>{console.error(error);process.exitCode=1;});
