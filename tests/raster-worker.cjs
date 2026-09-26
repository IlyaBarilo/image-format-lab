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
  new Function('self','ViewerJpegModule','ViewerBmpModule','ViewerTiffModule','UTIF','pako',workerData.source)(self,
    require(path.join(workerData.root,'vendor/jpeg-decoder.js')),require(path.join(workerData.root,'vendor/bmp-decoder.js')),
    require(path.join(workerData.root,'vendor/tiff-codec.js')),env.UTIF,env.pako);
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
    const jpegInput=image.data.slice().buffer;
    const encodedJpeg=await request('encode-jpeg',{width:9,height:7,buffer:jpegInput,options:{quality:85,jpegSubsampling:'444',jpegProgressive:true}},[jpegInput]);
    assert.equal(jpegInput.byteLength,0);assert.equal(encodedJpeg.type,'encoded');
    const jpegBytes=new Uint8Array(encodedJpeg.buffer);
    assert.equal(jpegBytes[0],255);assert.equal(jpegBytes[1],216);
    const {createJpegDecoder}=await import('../src/core/jpeg.mjs');
    const jpegCodec=await require('../vendor/jpeg-decoder.js')({print(){},printErr(){}});
    assert.equal(createJpegDecoder(jpegCodec)(jpegBytes).width,9);
    for(const tiffCompression of ['none','deflate','lzw']){
      const pixels=image.data.slice().buffer;
      const encoded=await request('encode',{width:9,height:7,buffer:pixels,options:{tiffCompression,tiffLevel:9,tiffPredictor:false}},[pixels]);
      assert.equal(pixels.byteLength,0);assert.equal(encoded.type,'encoded');
      const decoded=await request('decode',{buffer:encoded.buffer},[encoded.buffer]);
      assert.equal(decoded.type,'decoded');assert.deepEqual(new Uint8ClampedArray(decoded.buffer),image.data);
    }
    const exact=Uint16Array.from({length:9*7*4},(_,i)=>i%4===3?65535:(i*997+1)&65535);
    const encoded16=await request('encode',{width:9,height:7,buffer:image.data.slice().buffer,
      exactBuffer:exact.slice().buffer,sampleType:'uint16',bitDepth:16,
      options:{tiffDepth:'16',tiffCompression:'deflate',tiffLevel:6,tiffPredictor:true}});
    assert.equal(encoded16.type,'encoded');
    const decoded16=await request('decode',{buffer:encoded16.buffer});
    assert.equal(decoded16.type,'decoded');
    assert.deepEqual(new Uint16Array(decoded16.exactBuffer),exact);
    assert.equal(new Uint8ClampedArray(decoded16.buffer)[0],0);
    const {encodeBmp}=await import('../src/core/bmp.mjs');
    const buffer=await encodeBmp(true,'white',{width:9,height:7,imageData:image},false).blob.arrayBuffer();
    const result=await request('decode-bmp',{buffer},[buffer]);assert.equal(result.type,'decoded');assert.deepEqual(new Uint8ClampedArray(result.buffer),image.data);
    const bad=await request('decode',{buffer:new ArrayBuffer(8)});assert.equal(bad.type,'error');assert.ok(bad.message);
    const file=fs.readFileSync(path.join(root,'tests/fixtures/tiff/baseline.tiff'));
    const jpeg=await request('decode',{buffer:file.buffer.slice(file.byteOffset,file.byteOffset+file.length)});
    assert.equal(jpeg.type,'decoded');assert.equal(jpeg.width,37,'JPEG compatibility after error');
    const legacy16=fs.readFileSync(path.join(root,'tests/fixtures/tiff/lossless16-p1.tiff'));
    const fallback=await request('decode',{buffer:legacy16.buffer.slice(legacy16.byteOffset,legacy16.byteOffset+legacy16.length)});
    assert.equal(fallback.type,'decoded');assert.match(fallback.precisionNote,/8 бит/);
    console.log('PASS actual raster Worker entry: JPEG encoding, three TIFF codecs, BMP alpha, transferred buffers, JPEG fallback and error recovery');
  }finally{await worker.terminate();}
})().catch(error=>{console.error(error);process.exitCode=1;});
