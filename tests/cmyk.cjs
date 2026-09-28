const assert=require('node:assert/strict');

(async()=>{
  const {createCmykRaster,validateCmykIcc,readCmykJpegHeader,isFourChannelJpegPrefix,
    cmykStatistics,cmykDiagnostic}=await import('../src/core/cmyk.mjs');
  const {encodeCmykJpegPixels}=await import('../src/core/jpeg-encode.mjs');
  const {createJpegDecoder}=await import('../src/core/jpeg.mjs');
  const {encodeCmykTiffPixels,decodeTiffPixels}=await import('../src/core/raster-codecs.mjs');
  const {resolveCmykMode,reportFormatConfig}=await import('../src/core/format-options.mjs');
  const width=31,height=19;
  const pixels=Uint8Array.from({length:width*height*4},(_,i)=>{
    const c=i%4,p=Math.floor(i/4);
    return c===0?p*7%256:c===1?p*13%256:c===2?p*23%256:p*3%200;
  });
  const icc=new Uint8Array(132);new DataView(icc.buffer).setUint32(0,132);
  icc.set(Buffer.from('CMYK'),16);icc.set(Buffer.from('acsp'),36);
  const source=createCmykRaster(width,height,pixels,icc),original=pixels.slice();
  assert.equal(validateCmykIcc(icc),icc);
  assert.throws(()=>validateCmykIcc(new Uint8Array(132)),/CMYK/);
  assert.equal(resolveCmykMode({format:'tiff',colorMode:'source'},{cmyk:source}),true);
  assert.equal(resolveCmykMode({format:'jpeg',colorMode:'rgb'},{cmyk:source}),false);
  assert.throws(()=>resolveCmykMode({format:'jpeg',colorMode:'cmyk'},{}),/исходный CMYK/);
  assert.equal(reportFormatConfig({format:'tiff',colorMode:'cmyk'}).formatMode,'cmyk');
  const tiff=await require('../vendor/tiff-codec.js')({print(){},printErr(){}});
  for(const compression of ['none','deflate','lzw','packbits']){
    const encoded=encodeCmykTiffPixels(tiff,source,{tiffCompression:compression,tiffLevel:6,tiffPredictor:true});
    const decoded=decodeTiffPixels(tiff,encoded);
    assert.deepEqual(new Uint8Array(decoded.cmykBuffer),pixels,`CMYK TIFF ${compression}`);
    assert.deepEqual(new Uint8Array(decoded.iccProfileBuffer),icc);
    assert.equal(decoded.width,width);assert.equal(decoded.height,height);
  }
  const jpeg=await require('../vendor/jpeg-decoder.js')({print(){},printErr(){}});
  for(const progressive of [false,true]){
    const bytes=new Uint8Array(encodeCmykJpegPixels(jpeg,source,{quality:100,jpegProgressive:progressive}));
    assert.equal(isFourChannelJpegPrefix(bytes.subarray(0,1024)),true);
    const header=readCmykJpegHeader(bytes);
    assert.ok(header);assert.deepEqual(header.iccProfile,icc);
    const decoded=createJpegDecoder(jpeg)(bytes);
    assert.equal(decoded.components,4);assert.equal(decoded.adobe,true);
    let maximum=0;
    for(let i=0;i<pixels.length;i++)maximum=Math.max(maximum,Math.abs(255-decoded.samples[i]-pixels[i]));
    assert.ok(maximum<25,`JPEG CMYK Q100 deviation ${maximum}`);
  }
  const exact=cmykStatistics(source,source,300);
  assert.equal(exact.difference.peak,0);
  assert.throws(()=>cmykStatistics(source,null,300,{x:NaN,y:0,width:1,height:1}),/область/);
  assert.ok(exact.tacMaximum>300);assert.ok(exact.tacOverPixels>0);
  const changed=createCmykRaster(width,height,pixels.slice(),icc);
  changed.data[3]=255;
  const compared=cmykDiagnostic(changed,source,300);
  assert.ok(compared.difference.meanAbsolute[3]>0);
  assert.equal(compared.maps.difference[0],255-pixels[3]);
  assert.deepEqual(pixels,original,'analysis and encoders keep source channels');
  console.log('PASS CMYK TIFF/JPEG channels, ICC preservation, numerical analysis and RGB mode isolation');
})().catch(error=>{console.error(error);process.exitCode=1;});
