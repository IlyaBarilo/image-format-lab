const assert=require('node:assert/strict');

function frame(bytes){
  assert.equal(bytes[0],255);assert.equal(bytes[1],216);
  for(let at=2;at+4<bytes.length;){
    assert.equal(bytes[at++],255);
    while(bytes[at]===255)at++;
    const marker=bytes[at++],length=bytes[at]*256+bytes[at+1];
    if(marker===192||marker===194){
      const count=bytes[at+7];
      return {marker,sampling:Array.from({length:count},(_,i)=>bytes[at+9+i*3])};
    }
    at+=length;
  }
  throw Error('JPEG frame marker missing');
}
(async()=>{
  const {normalizeJpegOptions,encodeJpegPixels}=await import('../src/core/jpeg-encode.mjs');
  const {createJpegDecoder}=await import('../src/core/jpeg.mjs');
  assert.deepEqual(normalizeJpegOptions(),{jpegSubsampling:'420',jpegProgressive:false});
  for(const value of [{jpegSubsampling:'411'},{jpegProgressive:1}])assert.throws(()=>normalizeJpegOptions(value));
  const width=77,height=65,data=Uint8ClampedArray.from({length:width*height*4},(_,i)=>i%4===3?255:(i*17+Math.floor(i/4)*23)%256);
  const image={width,height,data},original=data.slice();
  const codec=await require('../vendor/jpeg-decoder.js')({print(){},printErr(){}});
  const decode=createJpegDecoder(codec);
  let smallest=Infinity;
  for(const [jpegSubsampling,sampling] of [['444',17],['422',33],['420',34]]){
    for(const jpegProgressive of [false,true]){
      const bytes=new Uint8Array(encodeJpegPixels(codec,image,{quality:85,jpegSubsampling,jpegProgressive}));
      const info=frame(bytes);
      assert.equal(info.marker,jpegProgressive?194:192);
      assert.deepEqual(info.sampling,[sampling,17,17]);
      const output=decode(bytes);
      assert.equal(output.width,width);assert.equal(output.height,height);
      assert.equal(output.components,3);
      smallest=Math.min(smallest,bytes.length);
    }
  }
  assert.ok(smallest>100);
  const low=encodeJpegPixels(codec,image,{quality:30,jpegSubsampling:'420'}).byteLength;
  const high=encodeJpegPixels(codec,image,{quality:95,jpegSubsampling:'420'}).byteLength;
  assert.ok(high>low,'JPEG quality changes the actual result');
  assert.deepEqual(data,original,'encoder does not change source pixels');
  for(const value of [{quality:0},{quality:101},{quality:50.5},{quality:85,jpegSubsampling:'411'},
    {quality:85,jpegProgressive:'true'}])assert.throws(()=>encodeJpegPixels(codec,image,value));
  assert.throws(()=>encodeJpegPixels(codec,{width,height,data:data.subarray(1)},{quality:85}));
  assert.ok(encodeJpegPixels(codec,image,{quality:85}).byteLength>100,'failure leaves encoder usable');
  const {createEncode}=await import('../src/services/encode.mjs');
  const {embedJpegPanorama}=await import('../src/core/metadata.mjs');
  const source={width,height,imageData:image,canvas:{},panorama:{ProjectionType:'equirectangular'}};
  const canvas={width,height,getContext:()=>({getImageData:()=>image})};
  let calls=0;
  const deps={
    outputDimensionsForConfig:()=>({width,height}),
    prepareCanvasForFormat:()=>canvas,
    clamp:(value,min,max)=>Math.max(min,Math.min(max,value)),
    loadOptionalCodec:async name=>{assert.equal(name,'utif');return {encodeJpeg:async(pixels,options)=>{
      calls++;return new Blob([encodeJpegPixels(codec,pixels,options)],{type:'image/jpeg'});
    }};},
    withEncodedMeta:encoded=>encoded,
    scaledPanorama:()=>source.panorama,
    embedJpegPanorama,
    validateExportConfig(){},staleRequest:()=>Error('stale')
  };
  const service=createEncode({},deps);deps.encodeOne=service.encodeOne;deps.outputSourceForConfig=service.outputSourceForConfig;
  const config={format:'jpeg',quality:85,jpegSubsampling:'444',jpegProgressive:true,matte:'white',metadataPolicy:'panorama'};
  const result=await service.encodeOne(config,source);
  assert.equal(result.panoramaPreserved,true);assert.equal(result.blob.type,'image/jpeg');
  const saved=new Uint8Array(await result.blob.arrayBuffer());
  assert.equal(frame(saved).marker,194);
  assert.ok(Buffer.from(saved).includes(Buffer.from('GPano:ProjectionType')));
  assert.equal(decode(saved).width,width);
  const plain=await service.encodeOne({...config,metadataPolicy:'none'},source);
  assert.equal(plain.panoramaPreserved,false);
  assert.equal(Buffer.from(await plain.blob.arrayBuffer()).includes(Buffer.from('GPano:')),false);
  const budget=await service.encodeFromSource({...config,metadataPolicy:'none',targetKB:'10',minQuality:40},source);
  assert.ok(budget.blob.size<=10000);assert.ok(budget.selectedQuality<=85);assert.ok(budget.attempts>1);
  assert.ok(calls>3,'normal saving and size search use the same JPEG encoder');
  console.log('PASS JPEG 4:4:4 / 4:2:2 / 4:2:0, baseline/progressive markers, quality, decode, input ownership and recovery');
  console.log('PASS JPEG service routing, GPano preservation/removal and size search');
})().catch(error=>{console.error(error);process.exitCode=1;});
