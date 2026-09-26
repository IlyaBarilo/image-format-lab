const assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const pako=require('../vendor/pako-2.1.0.min.js');

(async()=>{
  const {REFERENCE_SAMPLES,SAMPLE_CATALOG,createReferenceSamplePixels,createTiff16SamplePixels}=await import('../src/core/reference-samples.mjs');
  const {encodePng,decodePng}=await import('../src/core/png.mjs');
  const {encodeTiff16,decodeTiff16}=await import('../src/core/tiff16.mjs');
  assert.deepEqual(SAMPLE_CATALOG.map(sample=>sample.id),['canvas','gradient','alpha','palette','tiff16']);
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
  console.log('PASS five sample definitions, exact PNG8 and TIFF16 generated pixels: '+JSON.stringify(hashes));
})().catch(error=>{console.error(error);process.exitCode=1;});
