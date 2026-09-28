const assert=require('node:assert/strict');

(async()=>{
  const {DEFAULT_PRINT_CHECK_PROFILE,normalizePrintCheckProfile,parsePrintCheckProfile,printCheckProfileText,evaluatePrintCheck}=
    await import('../src/core/print-check-profile.mjs');
  const {createCmykPrintSample,SAMPLE_CATALOG}=await import('../src/core/reference-samples.mjs');
  const {cmykStatistics,cmykDiagnostic,createCmykRaster}=await import('../src/core/cmyk.mjs');
  const {encodeCmykTiffPixels,decodeTiffPixels}=await import('../src/core/raster-codecs.mjs');
  const sample=createCmykPrintSample(),again=createCmykPrintSample();
  assert.deepEqual(sample.data,again.data);
  assert.deepEqual([sample.width,sample.height,sample.iccProfile],[640,360,null]);
  assert.ok(SAMPLE_CATALOG.some(item=>item.id==='cmykPrint'&&item.fileName.endsWith('.tif')));
  const pixel=(raster,x,y)=>Array.from(raster.data.subarray((y*raster.width+x)*4,(y*raster.width+x+1)*4));
  assert.deepEqual(pixel(sample,30,120),[0,0,0,255]);
  assert.deepEqual(pixel(sample,518,120),[230,230,204,255]);
  const full=cmykDiagnostic(sample,sample,300);
  assert.ok(full.tacOverPixels>0&&full.tacOverPixels<full.pixelCount);
  assert.ok(full.tacMaximum>350&&full.firstOverPoint);
  assert.ok(full.kOnly.sourcePixels>0);
  assert.equal(full.kOnly.lostPixels,0);
  assert.deepEqual(evaluatePrintCheck(full,DEFAULT_PRINT_CHECK_PROFILE),{passed:false,tacExceeded:true,kOnlyLost:false});
  const changed=createCmykRaster(sample.width,sample.height,sample.data.slice());
  const at=(120*sample.width+30)*4;
  changed.data[at]=1;
  const region={x:24,y:114,width:104,height:108};
  const checked=cmykDiagnostic(changed,sample,300,region);
  assert.equal(checked.kOnly.lostPixels,1);
  assert.equal(checked.kOnly.sourcePixels,region.width*region.height);
  assert.deepEqual(evaluatePrintCheck(checked,{...DEFAULT_PRINT_CHECK_PROFILE,tacLimit:400}),
    {passed:false,tacExceeded:false,kOnlyLost:true});
  assert.deepEqual(evaluatePrintCheck(checked,{...DEFAULT_PRINT_CHECK_PROFILE,tacLimit:400,preserveKOnly:false}),
    {passed:true,tacExceeded:false,kOnlyLost:false});
  assert.equal(checked.maps.kOnly[Math.floor((120-region.y)/checked.maps.scale)*checked.maps.width+
    Math.floor((30-region.x)/checked.maps.scale)],2);
  assert.deepEqual(cmykStatistics(sample,sample,300,{x:512,y:114,width:104,height:108}).peakTacPoint,{x:512,y:114});
  const text=printCheckProfileText({...DEFAULT_PRINT_CHECK_PROFILE,name:'Печатная машина А',tacLimit:280});
  assert.deepEqual(parsePrintCheckProfile(text),normalizePrintCheckProfile(JSON.parse(text)));
  assert.equal(parsePrintCheckProfile(text).tacLimit,280);
  assert.throws(()=>parsePrintCheckProfile('{'),/JSON/);
  assert.throws(()=>parsePrintCheckProfile(JSON.stringify({...DEFAULT_PRINT_CHECK_PROFILE,tacLimit:401})),/0 до 400/);
  assert.throws(()=>parsePrintCheckProfile(JSON.stringify({...DEFAULT_PRINT_CHECK_PROFILE,name:' '})),/Название/);
  assert.throws(()=>parsePrintCheckProfile(JSON.stringify({...DEFAULT_PRINT_CHECK_PROFILE,version:2})),/не тестовый/);
  const codec=await require('../vendor/tiff-codec.js')({print(){},printErr(){}});
  const encoded=encodeCmykTiffPixels(codec,sample,{tiffCompression:'deflate',tiffLevel:6,tiffPredictor:true});
  const decoded=decodeTiffPixels(codec,encoded);
  assert.deepEqual(new Uint8Array(decoded.cmykBuffer),sample.data);
  assert.equal(decoded.iccProfileBuffer,null);
  console.log('PASS teaching CMYK TIFF sample, K-only loss, TAC location and safe JSON profiles');
})().catch(error=>{console.error(error);process.exitCode=1;});
