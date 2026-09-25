const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const zlib=require('node:zlib');
const {Worker}=require('node:worker_threads');
const {buildSync}=require('../scripts/node_modules/esbuild');
const pako=require('../vendor/pako-2.1.0.min.js');

// Independent fixtures use Node zlib and bitwise CRC, never the production writer.
function chunk(type,bytes=Buffer.alloc(0)){
  bytes=Buffer.from(bytes);const out=Buffer.alloc(bytes.length+12);out.writeUInt32BE(bytes.length);out.write(type,4);bytes.copy(out,8);
  let crc=-1;for(const b of out.subarray(4,-4)){crc^=b;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
  out.writeUInt32BE((crc^-1)>>>0,out.length-4);return out;
}
function fixture({width=13,height=11,depth=16,type=6,interlace=0,trns,extra=[],mutate}={}){
  const count={0:1,2:3,4:2,6:4}[type],bytes=depth/8,max=2**depth-1;
  const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=depth;header[9]=type;header[12]=interlace;
  const expected=new (depth===16?Uint16Array:Uint8ClampedArray)(width*height*4);
  const at=(x,y,c)=>((y*width+x)*571+c*257+(x===0?1:0))&max;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const values=Array.from({length:count},(_,c)=>at(x,y,c)),gray=type===0||type===4;
    expected.set([values[0],values[gray?0:1],values[gray?0:2],type===4?values[1]:type===6?values[3]:trns?.every((n,c)=>n===values[c])?0:max],(y*width+x)*4);
  }
  const passes=interlace?[[0,0,8,8],[4,0,8,8],[0,4,4,8],[2,0,4,4],[0,2,2,4],[1,0,2,2],[0,1,1,2]]:[[0,0,1,1]],rows=[];
  for(const [x0,y0,sx,sy] of passes){let previous=null;
    for(let y=y0;y<height;y+=sy){
      const values=[];for(let x=x0;x<width;x+=sx)for(let c=0;c<count;c++)values.push(at(x,y,c));
      if(!values.length)continue;
      const row=Buffer.alloc(values.length*bytes);values.forEach((v,i)=>depth===16?row.writeUInt16BE(v,i*2):row.writeUInt8(v,i));
      const filter=y%5,encoded=Buffer.alloc(row.length+1);encoded[0]=filter;
      for(let i=0;i<row.length;i++){
        const left=i>=count*bytes?row[i-count*bytes]:0,up=previous?.[i]||0,corner=i>=count*bytes?(previous?.[i-count*bytes]||0):0;
        let predictor=0;
        if(filter===1)predictor=left;if(filter===2)predictor=up;if(filter===3)predictor=(left+up)>>1;
        if(filter===4){const n=left+up-corner,dist=[Math.abs(n-left),Math.abs(n-up),Math.abs(n-corner)];predictor=[left,up,corner][dist.indexOf(Math.min(...dist))];}
        encoded[i+1]=(row[i]-predictor+256)%256;
      }
      rows.push(encoded);previous=row;
    }
  }
  let raw=Buffer.concat(rows);if(mutate)raw=mutate(raw);
  const compressed=zlib.deflateSync(raw),parts=[Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),...extra];
  if(trns){const data=Buffer.alloc(trns.length*2);trns.forEach((v,i)=>data.writeUInt16BE(v,i*2));parts.push(chunk('tRNS',data));}
  // Deliberately split inside zlib headers and scanlines.
  for(let i=0;i<compressed.length;i+=7)parts.push(chunk('IDAT',compressed.subarray(i,i+7)));
  parts.push(chunk('IEND'));
  return {bytes:Buffer.concat(parts),expected,width,height};
}

(async()=>{
  const {decodePng,encodePng,pngPreview,pngHeader}=await import('../src/core/png.mjs');
  const {createPixelBuffer}=await import('../src/core/pixel-buffer.mjs');
  const {computePixelMetrics}=await import('../src/core/metrics.mjs');
  const {computeHistogram}=await import('../src/core/histogram.mjs');
  for(const depth of [8,16])for(const type of [0,2,4,6])for(const interlace of [0,1])for(const [width,height] of [[13,11],[1,1],[1,7],[7,1]]){
    const f=fixture({depth,type,interlace,width,height}),before=Buffer.from(f.bytes),decoded=decodePng(f.bytes,pako);
    assert.deepEqual(decoded.data,f.expected,`${depth}/${type}/${interlace}/${width}x${height}`);assert.deepEqual(f.bytes,before);
    assert.equal(decoded.colorSpace,'unknown');
  }
  for(const type of [0,2]){const f=fixture({type,trns:type===0?[1]:[1,258,515]});assert.deepEqual(decodePng(f.bytes,pako).data,f.expected);assert.equal(f.expected[3],0);}
  console.log('PASS independent PNG fixtures: gray/RGB/gray-alpha/RGBA, 8/16, all filters, Adam7, tiny passes, tRNS and split IDAT');
  const scope={window:{pako},console};vm.runInNewContext(fs.readFileSync('vendor/UPNG-2.1.0.js','utf8'),scope);
  const data=new Uint16Array(65536*4);for(let i=0;i<65536;i++)data.set([i,65535-i,(i*17)&65535,i],i*4);
  const pixels=createPixelBuffer({width:256,height:256,data,sampleType:'uint16'}),copy=data.slice();
  const encoded=await encodePng(pixels,16,pako).arrayBuffer(),decoded=decodePng(new Uint8Array(encoded),pako);
  assert.deepEqual(decoded.data,data);assert.deepEqual(data,copy);
  // A second decoder examines its original 16-bit bytes, never toRGBA8.
  const independent=scope.window.UPNG.decode(encoded);
  assert.equal(independent.depth,16);assert.equal(independent.ctype,6);
  const samples=new DataView(independent.data.buffer,independent.data.byteOffset,independent.data.byteLength);
  for(let i=0;i<data.length;i++)assert.equal(samples.getUint16(i*2),data[i]);
  assert.deepEqual(computePixelMetrics(pixels,decoded,{allowUnknownColorSpace:true}),{psnr:Infinity,alpha:0});
  const changed=createPixelBuffer({...decoded,data:decoded.data.slice()});changed.data[65535*4]--;
  assert.ok(Number.isFinite(computePixelMetrics(pixels,changed,{allowUnknownColorSpace:true}).psnr));
  assert.notDeepEqual(computeHistogram(pixels).channels[0],computeHistogram(changed).channels[0]);
  const reduced=decodePng(new Uint8Array(await encodePng(pixels,8,pako).arrayBuffer()),pako);
  assert.deepEqual([...reduced.data],[...data].map(n=>Math.round(n/257)));
  const expanded=decodePng(new Uint8Array(await encodePng(reduced,16,pako).arrayBuffer()),pako);
  assert.deepEqual([...expanded.data],[...reduced.data].map(n=>n*257));
  const preview=pngPreview(pixels);assert.deepEqual(preview.data,reduced.data);assert.notEqual(preview.data.buffer,data.buffer);
  console.log('PASS 65536-level round trip, independent UPNG verification, hidden RGB/alpha, lower-bit metrics/histograms, explicit 16→8 and 8→16');

  const valid=fixture().bytes,badCrc=Buffer.from(valid);badCrc[29]^=1;
  assert.throws(()=>decodePng(badCrc,pako),/контрольной/);
  assert.throws(()=>decodePng(valid.subarray(0,-1),pako),/блок/);
  assert.throws(()=>decodePng(Buffer.concat([valid,Buffer.from([0])]),pako),/конец/);
  for(const mutate of [raw=>raw.subarray(0,-1),raw=>Buffer.concat([raw,Buffer.alloc(100000)]),raw=>{raw[0]=5;return raw;}])assert.throws(()=>decodePng(fixture({mutate}).bytes,pako));
  const giantHeader=Buffer.from(valid.subarray(16,29));giantHeader.writeUInt32BE(8000001);giantHeader.writeUInt32BE(1,4);
  assert.throws(()=>decodePng(Buffer.concat([valid.subarray(0,8),chunk('IHDR',giantHeader),chunk('IDAT',Buffer.alloc(0)),chunk('IEND')]),{get Inflate(){throw new Error('Inflate must not be reached');}}),/8 мегапикселями/);
  for(const name of ['iCCP','gAMA','cHRM','cICP'])assert.throws(()=>decodePng(fixture({extra:[chunk(name,Buffer.alloc(4))]}).bytes,pako),/цветового/);
  assert.equal(decodePng(fixture({extra:[chunk('sRGB',Buffer.from([0]))]}).bytes,pako).colorSpace,'srgb');
  assert.throws(()=>decodePng(fixture({extra:[chunk('ABCD')]}).bytes,pako),/обязательный/);
  assert.throws(()=>decodePng(fixture({extra:[chunk('tRNS',Buffer.alloc(2))]}).bytes,pako),/прозрачности/);
  assert.throws(()=>encodePng({...pixels,colorSpace:'display-p3'},16,pako),/пространства/);
  const srgb=createPixelBuffer({...pixels,colorSpace:'srgb'});
  assert.equal(decodePng(new Uint8Array(await encodePng(srgb,16,pako).arrayBuffer()),pako).colorSpace,'srgb');
  assert.equal(pngHeader(new Uint8Array([1,2,3])),null);
  console.log('PASS container checks, CRC, truncated/oversized inflate, pre-allocation pixel limit and explicit color-profile restrictions');

  class ImageDataModel {constructor(data,width,height){Object.assign(this,{data,width,height,colorSpace:'srgb'});}}
  global.ImageData=ImageDataModel;global.window={pako};
  global.document={createElement(tag){assert.equal(tag,'canvas');const canvas={width:0,height:0};canvas.getContext=()=>({putImageData(image){canvas.image=image;},getImageData(){return canvas.image;}});return canvas;}};
  global.createImageBitmap=async image=>({width:image.width,height:image.height,close(){}});
  const {createPng}=await import('../src/services/png.mjs'),{createDecode}=await import('../src/services/decode.mjs'),{createEncode}=await import('../src/services/encode.mjs');
  const settings=await import('../src/core/settings.mjs');
  const deps={...settings,loadScript:async path=>assert.equal(path,'vendor/pako-2.1.0.min.js'),readPanoramaMetadata:async()=>({}),detectAlpha:a=>a.some((n,i)=>i%4===3&&n!==255),cloneImageData:i=>new ImageDataModel(i.data.slice(),i.width,i.height)};
  Object.assign(deps,createPng({},deps),createDecode({},deps),createEncode({},deps));
  const file=Object.assign(new Blob([encoded],{type:'application/octet-stream'}),{name:'misleading.jpg'});
  const source=await deps.decodeSourceFile(file);assert.deepEqual(source.pixelBuffer.data,data);assert.equal(source.hasAlpha,true);
  const before=source.pixelBuffer.data.slice();
  for(const depth of ['auto','16','8']){
    const output=await deps.encodeFromSource({format:'png',pngDepth:depth},source),preview=await deps.decodeVariantForPreview(output.blob,output.exactPng);
    assert.equal(preview.pixelBuffer.bitDepth,depth==='8'?8:16);assert.equal(output.sourcePixelBuffer,source.pixelBuffer);
    assert.deepEqual(preview.pixelBuffer.data,depth==='8'?reduced.data:data);preview.bitmap.close();
  }
  const original=await deps.encodeFromSource({format:'original'},source);
  assert.equal(original.blob,file);assert.equal(original.sourcePixelBuffer,source.pixelBuffer);
  assert.deepEqual((await deps.imageDataToPreview(original.previewImageData,original.sourcePixelBuffer)).pixelBuffer.data,data);
  await assert.rejects(deps.encodeFromSource({format:'png',pngDepth:'auto',resizeWidth:'128'},source),/исходном размере/);
  await assert.rejects(deps.encodeFromSource({format:'png',pngDepth:'32'},source),/выберите/);
  assert.deepEqual(source.pixelBuffer.data,before);
  assert.equal(await deps.decodePngFile(new Blob([new Uint8Array(await encodePng(reduced,8,pako).arrayBuffer())])),null,'Ordinary PNG8 keeps the existing browser path');
  console.log('PASS source decode, misleading extension, separate preview, original bytes, exact saved-file readback, both depths and resize rejection');

  const nearOpaque=createPixelBuffer({width:1,height:1,data:new Uint16Array([100,200,300,65534]),sampleType:'uint16'});
  const nearly=await deps.decodeSourceFile(encodePng(nearOpaque,16,pako));
  assert.equal(nearly.hasAlpha,true);assert.equal(nearly.imageData.data[3],255,'Preview rounding cannot hide source transparency');
  const {createComparison}=await import('../src/ui/comparison.mjs'),{createReports}=await import('../src/ui/reports.mjs');
  if(!global.navigator)global.navigator={userAgent:'PNG test'};
  const variant={index:0,generation:0,config:{format:'original'},cell:{classList:{contains:()=>false}}};
  const app={source,sourceGeneration:1,variants:[variant]};const els={metadataPolicy:{value:'none'}};
  Object.assign(deps,{formatUnavailableReason:()=>'',outputFormatLabel:f=>f,updateMetrics(){},drawAll(){},
    showStatus(text,error){if(error)throw new Error(text);},formatBytes:String,alphaLabel:()=>'',
    measurePixels:async(a,b,options)=>computePixelMetrics(a,b,options),isVariantReady:v=>!!v.blob&&!v.dirty});
  Object.assign(deps,createComparison({app,els},deps));
  await deps.renderVariant(variant);assert.deepEqual(variant.pixelBuffer.data,data);assert.equal(variant.measurement.bitDepth,16);assert.equal(variant.measurement.psnrRGB,Infinity);
  variant.config={format:'png',pngDepth:'16'};await deps.renderVariant(variant);
  assert.deepEqual(variant.pixelBuffer.data,data);assert.equal(variant.measurement.psnrRGB,Infinity);
  variant.config.pngDepth='8';await deps.renderVariant(variant);
  assert.equal(variant.pixelBuffer.bitDepth,8);assert.ok(Number.isFinite(variant.measurement.psnrRGB));assert.match(variant.measurement.precisionNote,/из 16/);
  Object.assign(deps,createReports({app,els},deps));
  const report=deps.comparisonReport();assert.equal(report.source.bitDepth,16);assert.equal(report.variants[0].metrics.bitDepth,8);
  assert.equal(report.variants[0].config.pngDepth,'8');assert.match(report.variants[0].codec,/Собственный PNG/);assert.match(report.methodology.alpha,/полного диапазона/);
  let csv;deps.downloadBlob=blob=>{csv=blob;};deps.saveComparisonReport('csv');
  assert.match(await csv.text(),/"png_depth","source_bit_depth","result_bit_depth","precision_note"/);
  deps.disposeVariantOutput(variant);assert.equal(variant.pixelBuffer,null);
  const huge=Buffer.from(valid.subarray(0,33));huge.writeUInt32BE(8000001,16);huge.writeUInt32BE(1,20);
  await assert.rejects(deps.decodePngFile({size:128*1024*1024,slice:()=>new Blob([huge]),arrayBuffer(){throw new Error('Must not read the large file');}}),/8 мегапикселями/);
  console.log('PASS real comparison/controller/report paths, original uint16, explicit quantization, depth metadata and precision notices');

  const bundled=buildSync({entryPoints:['src/workers/compute.worker.mjs'],bundle:true,write:false,platform:'browser',format:'iife'}).outputFiles[0].text;
  const worker=new Worker(`const {parentPort}=require('node:worker_threads');global.self={postMessage:m=>parentPort.postMessage(m)};${bundled};parentPort.on('message',data=>self.onmessage({data}));`,{eval:true});
  const request=(kind,payload)=>new Promise((resolve,reject)=>{worker.once('message',m=>m.error?reject(new Error(m.error)):resolve(m.result));worker.once('error',reject);worker.postMessage({kind,payload});});
  try{
    assert.deepEqual(await request('metrics',{a:pixels,b:changed,options:{allowUnknownColorSpace:true}}),computePixelMetrics(pixels,changed,{allowUnknownColorSpace:true}));
    assert.deepEqual(await request('histogram',{pixelBuffer:decoded,matte:'black'}),computeHistogram(decoded,'black'));
    assert.deepEqual(data,copy);
  }finally{await worker.terminate();}
  console.log('PASS real compute Worker receives decoded uint16 pixels and retains source ownership');
})().catch(error=>{console.error(error);process.exitCode=1;});
