const assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const pako=require('../vendor/pako-2.1.0.min.js');

(async()=>{
  const {REFERENCE_SAMPLES,SAMPLE_CATALOG,createReferenceSamplePixels,createTiff16SamplePixels,createIccP3Sample}=await import('../src/core/reference-samples.mjs');
  const {prepareIccSdr}=await import('../src/core/icc-sdr.mjs');
  const {encodePng,decodePng}=await import('../src/core/png.mjs');
  const {encodeTiff16,decodeTiff16}=await import('../src/core/tiff16.mjs');
  assert.deepEqual(SAMPLE_CATALOG.map(sample=>sample.id),['canvas','gradient','alpha','palette','tiff16','iccP3']);
  assert.ok(SAMPLE_CATALOG.every(sample=>sample.label&&sample.description&&sample.size&&sample.fileName));
  const hashes={
    gradient:'c28f734486bfd7e44d317d650c536bcc019e07e6ac1e3c7d01f300c5ed41ed5d',
    alpha:'8351788e8b30b14afcba806ed8b0db5afd9dcec9ff2034a22eb9ddcf8b2373bf',
    palette:'03aed313a603614f9e4452338449fdb21f6e79a3da5e13ebf0b462c357675fac'
  };
  for(const id of ['gradient','alpha','palette']){
    const spec=REFERENCE_SAMPLES[id],pixels=createReferenceSamplePixels(id),again=createReferenceSamplePixels(id);
    assert.equal(pixels.width,512);assert.equal(pixels.height,320);
    assert.equal(pixels.bitDepth,8);assert.equal(pixels.colorSpace,'srgb');
    assert.deepEqual(pixels.data,again.data,'pixel formulas are deterministic');
    const blob=encodePng(pixels,8,pako),bytes=new Uint8Array(await blob.arrayBuffer());
    assert.deepEqual(Buffer.from(decodePng(bytes,pako).data),Buffer.from(pixels.data),'generated PNG decodes to the exact samples');
    assert.equal(blob.type,'image/png');assert.match(spec.fileName,/^ifl-[a-z]+-v1\.png$/);
    assert.equal(createHash('sha256').update(pixels.data).digest('hex'),hashes[id]);
  }
  const alpha=createReferenceSamplePixels('alpha').data;
  assert.ok(alpha.some((n,i)=>i%4===3&&n===0));
  assert.ok(alpha.some((n,i)=>i%4===3&&n===128));
  assert.ok(alpha.some((n,i)=>i%4===3&&n===255));
  assert.ok(createReferenceSamplePixels('palette').data.some((n,i)=>i%4!==3&&n>0));
  assert.throws(()=>createReferenceSamplePixels('__proto__'),/Неизвестный/);
  const tiff=createTiff16SamplePixels(),again=createTiff16SamplePixels();
  assert.equal(tiff.width,512);assert.equal(tiff.height,256);assert.equal(tiff.bitDepth,16);
  assert.deepEqual(tiff.data,again.data);
  assert.notEqual(tiff.data[4]%257,0,'TIFF16 retains values unavailable in RGBA8');
  const bytes=encodeTiff16(tiff,{tiffCompression:'deflate',tiffLevel:6,tiffPredictor:true},pako);
  assert.deepEqual(decodeTiff16(bytes,0,pako).data,tiff.data);
  assert.equal(bytes.byteLength,6261);
  const p3=createIccP3Sample(),p3Again=createIccP3Sample();
  assert.equal(p3.pixels.width,256);assert.equal(p3.pixels.height,128);
  assert.equal(p3.pixels.bitDepth,16);
  assert.deepEqual(p3.pixels.data,p3Again.pixels.data);
  assert.deepEqual(p3.iccProfile,p3Again.iccProfile);
  const p3Blob=encodePng(p3.pixels,16,pako,{iccProfile:p3.iccProfile});
  const p3Decoded=decodePng(new Uint8Array(await p3Blob.arrayBuffer()),pako,{withIcc:true});
  assert.deepEqual(p3Decoded.pixels.data,p3.pixels.data);
  assert.deepEqual(p3Decoded.iccProfile,p3.iccProfile);
  const managed=await prepareIccSdr(p3Decoded.pixels,p3Decoded.iccProfile);
  assert.ok(managed.pixelBuffer.data.some((value,index)=>index%4!==3&&value!==p3.pixels.data[index]));
  console.log('PASS six sample definitions, exact PNG8/TIFF16/ICC PNG16 generated pixels: '+JSON.stringify(hashes));
})().catch(error=>{console.error(error);process.exitCode=1;});
