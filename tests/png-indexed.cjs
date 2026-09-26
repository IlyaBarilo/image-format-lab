const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const pako=require('../vendor/pako-2.1.0.min.js');

function chunks(bytes){
  const result=[];
  for(let at=8;at<bytes.length;){
    const size=bytes.readUInt32BE(at),name=bytes.toString('ascii',at+4,at+8);
    result.push({name,data:bytes.subarray(at+8,at+8+size)});
    at+=12+size;
  }
  return result;
}

(async()=>{
  const {encodeIndexedPng}=await import('../src/core/png.mjs');
  const {encodeGif,indexedPalette}=await import('../src/core/gif.mjs');
  const {inspectFile}=await import('../src/core/file-passport.mjs');
  const scope={window:{pako},console};
  vm.runInNewContext(fs.readFileSync('vendor/UPNG-2.1.0.js','utf8'),scope);
  const UPNG=scope.window.UPNG;
  const width=17,height=5,data=new Uint8ClampedArray(width*height*4);
  for(let i=0;i<width*height;i++){
    const offset=i*4;
    data.set([(i*37)%256,(i*83)%256,(i*11)%256,i%7===0?0:255],offset);
  }
  const source={width,height,hasAlpha:true,imageData:{width,height,data}};
  const original=data.slice();
  for(const colors of [2,4,16,256])for(const dither of [false,true]){
    const expected=indexedPalette(colors,dither,source);
    assert.equal(expected.paletteInfo.entries.reduce((sum,entry)=>sum+entry.pixels,0),width*height);
    assert.equal(expected.paletteInfo.entries.filter(entry=>entry.pixels>0).length,expected.paletteInfo.usedEntries);
    const png=encodeIndexedPng(source,colors,dither,pako);
    const gif=encodeGif(colors,dither,source,false);
    assert.equal(gif.paletteInfo.entries.length,gif.paletteInfo.storedEntries);
    assert.equal(gif.paletteInfo.entries.reduce((sum,entry)=>sum+entry.pixels,0),width*height);
    const bytes=Buffer.from(await png.blob.arrayBuffer()),parts=chunks(bytes);
    const depth=colors<=2?1:colors<=4?2:colors<=16?4:8;
    assert.equal(bytes.toString('hex',0,8),'89504e470d0a1a0a');
    assert.deepEqual(parts.map(part=>part.name),['IHDR','PLTE','tRNS','IDAT','IEND']);
    assert.equal(parts[0].data[8],Math.max(depth,png.paletteInfo.indexDepth));
    assert.equal(parts[0].data[9],3);
    assert.deepEqual([...parts[2].data],[0]);
    assert.equal(parts[1].data.length/3,png.paletteInfo.storedEntries);
    assert.equal(png.paletteInfo.usedEntries,new Set(expected.indexed).size);
    assert.equal(gif.paletteInfo.usedEntries,png.paletteInfo.usedEntries);
    const gifBytes=Buffer.from(await gif.blob.arrayBuffer());
    assert.deepEqual([...gifBytes.subarray(13,13+parts[1].data.length)],[...parts[1].data],
      'GIF and PNG must use the same RGB palette in the same order');
    const decoded=UPNG.decode(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.length));
    assert.equal(decoded.ctype,3);
    const passport=await inspectFile(png.blob);
    assert.equal(passport.status,'ok');
    assert.equal(passport.paletteEntries,png.paletteInfo.storedEntries);
    assert.equal(passport.colorType,3);
    const rgba=new Uint8Array(UPNG.toRGBA8(decoded)[0]);
    for(let i=0;i<expected.indexed.length;i++){
      const at=i*4,index=expected.indexed[i],color=expected.palette[index];
      assert.deepEqual([...rgba.subarray(at,at+4)],
        index===expected.transparentIndex?[0,0,0,0]:[color.r,color.g,color.b,255]);
    }
    assert.deepEqual(data,original,'encoding never mutates source pixels');
  }
  const opaque={width:3,height:1,hasAlpha:false,imageData:{data:Uint8ClampedArray.of(
    255,0,0,255,0,255,0,255,0,0,255,255)}};
  const noAlpha=encodeIndexedPng(opaque,4,false,pako);
  for(const pngFilter of ['adaptive','none','sub','up','average','paeth']){
    const filtered=encodeIndexedPng(source,16,false,pako,{pngFilter,pngLevel:9});
    const parsed=UPNG.decode(await filtered.blob.arrayBuffer());
    assert.equal(parsed.width,width);assert.equal(parsed.height,height);
    assert.deepEqual([...new Uint8Array(UPNG.toRGBA8(parsed)[0])],[...new Uint8Array(UPNG.toRGBA8(UPNG.decode(await encodeIndexedPng(source,16,false,pako).blob.arrayBuffer()))[0])]);
  }
  assert.ok(!chunks(Buffer.from(await noAlpha.blob.arrayBuffer())).some(part=>part.name==='tRNS'));
  assert.throws(()=>encodeIndexedPng(source,1,false,pako),/2 до 256/);
  assert.throws(()=>encodeIndexedPng(source,257,false,pako),/2 до 256/);
  const {createPng}=await import('../src/services/png.mjs');
  const {createEncode}=await import('../src/services/encode.mjs');
  global.window={pako};
  const pngService=createPng({}, {loadScript:async()=>{}});
  const deps={encodePalettePng:pngService.encodePalettePng,
    outputDimensionsForConfig:(_,image)=>({width:image.width,height:image.height})};
  const encoder=createEncode({},deps);
  deps.outputSourceForConfig=encoder.outputSourceForConfig;
  deps.withEncodedMeta=encoder.withEncodedMeta;
  const integrated=await encoder.encodeOne({format:'pngIndexed',gifColors:16,gifDither:false},source);
  assert.equal(integrated.blob.type,'image/png');
  assert.equal(integrated.paletteInfo.requestedColors,16);
  assert.equal(integrated.sourcePixelBuffer.bitDepth,8);
  const {createReports}=await import('../src/ui/reports.mjs');
  const variant={index:0,cell:{classList:{contains:()=>false}},config:{format:'pngIndexed',gifColors:16,gifDither:false},
    resultConfig:{format:'pngIndexed',gifColors:16,gifDither:false},paletteInfo:integrated.paletteInfo,
    measurement:{bytes:integrated.blob.size,psnrRGB:Infinity}};
  const reportApp={source:{name:'test.png',width,height,size:100,pixelBuffer:{bitDepth:8,colorSpace:'unknown'}},
    sourceLoading:false,variants:[variant]};
  let saved=null;
  const reportDeps={isVariantReady:()=>true,downloadBlob:(blob)=>{saved=blob;}};
  const reports=createReports({app:reportApp,els:{metadataPolicy:{value:'none'}}},reportDeps);
  reportDeps.codecLabel=reports.codecLabel;
  reportDeps.comparisonReport=reports.comparisonReport;
  reportDeps.csvCell=reports.csvCell;
  const observation=reports.comparisonReport().variants[0];
  assert.deepEqual(observation.palette,integrated.paletteInfo);
  assert.equal(observation.config.format,'png');
  assert.equal(observation.config.formatMode,'palette');
  assert.equal(observation.config.gifColors,16);
  reports.saveComparisonReport('csv');
  const csv=await saved.text();
  assert.match(csv,/palette_used_entries/);
  assert.match(csv,/"format","format_mode"/);
  assert.match(csv,/"png","palette"/);
  assert.match(csv,/png_index_depth/);
  assert.match(csv,new RegExp(String(integrated.paletteInfo.usedEntries)));
  console.log('PASS indexed PNG bit depths, PLTE/tRNS, independent decoding, shared GIF palette and source ownership');
})().catch(error=>{console.error(error);process.exitCode=1;});
