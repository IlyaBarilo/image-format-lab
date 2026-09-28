const assert=require('node:assert/strict');
const pako=require('../vendor/pako-2.1.0.min.js');

(async()=>{
  const {createPixelBuffer}=await import('../src/core/pixel-buffer.mjs');
  const {cropSourcePixels,croppedSourceName}=await import('../src/core/crop-source.mjs');
  const {encodePng,decodePng}=await import('../src/core/png.mjs');
  const {createPng}=await import('../src/services/png.mjs');
  for(const [sampleType,depth,ArrayType] of [['uint8',8,Uint8ClampedArray],['uint16',16,Uint16Array]]){
    const data=new ArrayType(4*3*4),peak=2**depth-1;
    for(let y=0;y<3;y++)for(let x=0;x<4;x++){
      const at=(y*4+x)*4;
      data.set([x*157+y*13,x*71+y*19,x*47+y*37,(x+y)%2?peak:0].map(n=>n&peak),at);
    }
    data[(1*4+1)*4]=depth===16?12345:117; // Hidden RGB must survive transparent pixels.
    const source=createPixelBuffer({width:4,height:3,data,sampleType,colorSpace:'srgb'});
    const original=data.slice();
    const {bounds,pixels}=cropSourcePixels(source,{x0:250,y0:0,x1:750,y1:1000});
    assert.deepEqual(bounds,{x:1,y:0,width:2,height:3});
    assert.equal(pixels.bitDepth,depth);
    for(let y=0;y<3;y++)assert.deepEqual([...pixels.data.subarray(y*8,y*8+8)],
      [...data.subarray((y*4+1)*4,(y*4+3)*4)]);
    pixels.data[0]^=1;
    assert.deepEqual(data,original,'crop must own its samples');
    pixels.data[0]^=1;
    const blob=encodePng(pixels,depth,pako);
    const decoded=decodePng(new Uint8Array(await blob.arrayBuffer()),pako);
    assert.deepEqual(decoded.data,pixels.data,'generated PNG must preserve every stored sample');
    assert.equal(decoded.colorSpace,'srgb');
    assert.equal(croppedSourceName('photo.jpg',bounds),'photo-area-x1-y0-2x3.png');
    if(depth===8){
      global.window={pako};
      const png=createPng({}, {loadScript:async()=>{}});
      assert.equal(await png.decodePngFile(blob),null,'ordinary PNG8 keeps the browser path');
      png.registerExactPngFile(blob);
      global.ImageData=class {constructor(values,width,height){Object.assign(this,{data:values,width,height});}};
      assert.deepEqual((await png.decodePngFile(blob)).pixelBuffer.data,pixels.data,
        'new cropped PNG8 must use the exact source decoder');
    }
    const pixelRegion={unit:'pixels',x:1,y:1,width:2,height:2,referenceWidth:4,referenceHeight:3};
    const exact=cropSourcePixels(source,pixelRegion);
    assert.deepEqual(exact.bounds,{x:1,y:1,width:2,height:2});
    assert.deepEqual([...exact.pixels.data.subarray(0,8)],[...source.data.subarray((4+1)*4,(4+3)*4)]);
    assert.deepEqual((await import('../src/core/analysis-region.mjs')).analysisRegionBounds(2,2,pixelRegion),
      {x:0,y:0,width:2,height:2},'resized results use the same proportional source area');
  }
  const minimal=createPixelBuffer({width:1,height:1,data:new Uint8ClampedArray([1,2,3,4])});
  assert.throws(()=>cropSourcePixels(minimal,null),/примените/);
  assert.throws(()=>cropSourcePixels(minimal,{x0:100,y0:0,x1:100,y1:1000}),/область/);
  assert.throws(()=>cropSourcePixels({...minimal,colorSpace:'display-p3'},{x0:0,y0:0,x1:1000,y1:1000}),/не поддерживается/);
  const {createIccP3Sample}=await import('../src/core/reference-samples.mjs');
  const iccProfile=createIccP3Sample().iccProfile;
  const raw=createPixelBuffer({width:2,height:1,sampleType:'uint16',bitDepth:16,colorSpace:'unknown',
    data:new Uint16Array([40000,10000,5000,32768,1000,35000,65000,65535])});
  const iccCrop=cropSourcePixels(raw,{unit:'pixels',x:1,y:0,width:1,height:1,referenceWidth:2,referenceHeight:1});
  const profiled=decodePng(new Uint8Array(await encodePng(iccCrop.pixels,16,pako,{iccProfile}).arrayBuffer()),pako,{withIcc:true});
  assert.deepEqual(profiled.pixels.data,raw.data.subarray(4));
  assert.deepEqual(profiled.iccProfile,iccProfile,'profiled crop retains both original codes and ICC');
  console.log('PASS cropped RGBA8/16 samples, exact PNG readback and source ownership');
})().catch(error=>{console.error(error);process.exitCode=1;});
