const assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const pako=require('../vendor/pako-2.1.0.min.js');

(async()=>{
  const {REFERENCE_SAMPLES,SAMPLE_CATALOG,createReferenceSamplePixels,createTiff16SamplePixels,createIccP3Sample}=await import('../src/core/reference-samples.mjs');
  const {prepareIccSdr}=await import('../src/core/icc-sdr.mjs');
  const {encodePng,decodePng}=await import('../src/core/png.mjs');
  const {encodeTiff16,decodeTiff16}=await import('../src/core/tiff16.mjs');
  assert.deepEqual(SAMPLE_CATALOG.map(sample=>sample.id),['canvas','photo','gradient','alpha','palette','tiff16','iccP3','tiffFloat','cmykPrint']);
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
  const photo=fs.readFileSync(path.join(__dirname,'../src/samples/ifl-photo-still-life-v1.webp'));
  assert.equal(photo.toString('ascii',0,4),'RIFF');
  assert.equal(photo.toString('ascii',8,16),'WEBPVP8L','one lossless payload without metadata');
  assert.equal(photo.readUInt32LE(4)+8,photo.length);
  assert.equal(20+photo.readUInt32LE(16)+(photo.readUInt32LE(16)&1),photo.length);
  const codec=await require('../vendor/modern-codecs.js')({print(){},printErr(){}});
  const at=codec._malloc(photo.length);
  try{
    assert.ok(at);codec.HEAPU8.set(photo,at);
    assert.equal(codec._viewer_modern_decode(at,photo.length,1),0,codec.UTF8ToString(codec._viewer_modern_error()));
    assert.equal(codec._viewer_modern_width(),1536);assert.equal(codec._viewer_modern_height(),1024);
    assert.equal(codec._viewer_modern_output_size(),1536*1024*4);
    const rgba=codec.HEAPU8.subarray(codec._viewer_modern_output(),codec._viewer_modern_output()+1536*1024*4);
    const rgb=Buffer.alloc(1536*1024*3);
    for(let i=0,j=0;i<rgba.length;i+=4,j+=3){rgb.set(rgba.subarray(i,i+3),j);assert.equal(rgba[i+3],255);}
    assert.equal(createHash('sha256').update(rgb).digest('hex'),'64c893bd0e2d33d953e8d4dc45c30dca7f2d8edcf243b08e932f63b9cfa23e3d','every pixel matches the reference raster');
  }finally{codec._viewer_modern_clear();codec._free(at);}
  const {createSource}=await import('../src/ui/source.mjs');
  const previousDocument=global.document;
  try{
    global.document={getElementById:id=>id==='embedded-samples'?{textContent:JSON.stringify({photo:photo.toString('base64')})}:null};
    const file=await createSource({app:{},els:{}},{}).createSampleFile('photo');
    assert.equal(file.name,'ifl-photo-still-life-v1.webp');assert.equal(file.type,'image/webp');
    assert.deepEqual(Buffer.from(await file.arrayBuffer()),photo);
    global.document={getElementById:()=>null};
    await assert.rejects(createSource({app:{},els:{}},{}).createSampleFile('photo'),/образец отсутствует/);
  }finally{if(previousDocument===undefined)delete global.document;else global.document=previousDocument;}
  console.log('PASS nine sample definitions, exact generated pixels and embedded lossless WebP raster: '+JSON.stringify(hashes));
})().catch(error=>{console.error(error);process.exitCode=1;});
