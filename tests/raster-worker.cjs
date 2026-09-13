// Real Worker thread + the application's worker entry; no browser or network.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {Worker}=require('node:worker_threads');
const {buildSync}=require('../scripts/node_modules/esbuild');
const root=path.resolve(__dirname,'..');
const source=buildSync({entryPoints:[path.join(root,'src/workers/tiff.worker.mjs')],bundle:true,write:false,platform:'neutral',format:'iife',logLevel:'silent'}).outputFiles[0].text;
const worker=new Worker(`
  const {parentPort,workerData}=require('node:worker_threads');
  const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
  const env={console,Uint8Array,Uint16Array,Uint32Array,Int8Array,Int16Array,Int32Array,Float32Array,Float64Array,ArrayBuffer,DataView};
  env.self=env;env.window=env;vm.createContext(env);
  for(const name of ['pako-2.1.0.min.js','UTIF-3.1.0.js'])vm.runInContext(fs.readFileSync(path.join(workerData.root,'vendor',name),'utf8'),env);
  const self={postMessage:(data,transfer)=>parentPort.postMessage(data,transfer)};
  new Function('self','ViewerJpegModule','ViewerBmpModule','ViewerTiffModule','UTIF',workerData.source)(self,
    require(path.join(workerData.root,'vendor/jpeg-decoder.js')),require(path.join(workerData.root,'vendor/bmp-decoder.js')),
    require(path.join(workerData.root,'vendor/tiff-codec.js')),env.UTIF);
  parentPort.on('message',data=>self.onmessage({data}));
`,{eval:true,workerData:{root,source}});
let sequence=0;
function request(type,data={},transfer=[]){return new Promise((resolve,reject)=>{
  const id=++sequence,timer=setTimeout(()=>{cleanup();reject(Error('Raster worker timeout'));},30000);
  function cleanup(){clearTimeout(timer);worker.off('message',done);worker.off('error',failed);}
  function failed(error){cleanup();reject(error);}
  function done(reply){if(type==='init'?reply.type!=='ready':reply.id!==id)return;cleanup();resolve(reply);}
  worker.on('message',done);worker.on('error',failed);worker.postMessage({type,id,...data},transfer);
});}
(async()=>{
  try{
    assert.equal((await request('init')).codec,'tiff');
    const image={width:9,height:7,data:Uint8ClampedArray.from({length:9*7*4},(_,i)=>i*13%256)};
    for(const tiffCompression of ['none','deflate','lzw']){
      const pixels=image.data.slice().buffer;
      const encoded=await request('encode',{width:9,height:7,buffer:pixels,options:{tiffCompression,tiffLevel:9,tiffPredictor:false}},[pixels]);
      assert.equal(pixels.byteLength,0);assert.equal(encoded.type,'encoded');
      const decoded=await request('decode',{buffer:encoded.buffer},[encoded.buffer]);
      assert.equal(decoded.type,'decoded');assert.deepEqual(new Uint8ClampedArray(decoded.buffer),image.data);
    }
    const {encodeBmp}=await import('../src/core/bmp.mjs');
    const buffer=await encodeBmp(true,'white',{width:9,height:7,imageData:image},false).blob.arrayBuffer();
    const result=await request('decode-bmp',{buffer},[buffer]);assert.equal(result.type,'decoded');assert.deepEqual(new Uint8ClampedArray(result.buffer),image.data);
    const bad=await request('decode',{buffer:new ArrayBuffer(8)});assert.equal(bad.type,'error');assert.ok(bad.message);
    const file=fs.readFileSync(path.join(root,'tests/fixtures/tiff/baseline.tiff'));
    const jpeg=await request('decode',{buffer:file.buffer.slice(file.byteOffset,file.byteOffset+file.length)});
    assert.equal(jpeg.type,'decoded');assert.equal(jpeg.width,37,'JPEG compatibility after error');
    console.log('PASS actual raster Worker entry: init, three TIFF codecs, BMP alpha, transferred buffers, JPEG fallback and error recovery');
  }finally{await worker.terminate();}
})().catch(error=>{console.error(error);process.exitCode=1;});
