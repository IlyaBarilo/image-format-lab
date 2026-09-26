const assert=require('node:assert/strict');
const path=require('node:path');
const {Worker}=require('node:worker_threads');
const {buildSync}=require('../scripts/node_modules/esbuild');
const pako=require('../vendor/pako-2.1.0.min.js');

(async()=>{
  const {createIccP3Sample}=await import('../src/core/reference-samples.mjs');
  const {decodeTiff16}=await import('../src/core/tiff16.mjs');
  const {iccProfile}=createIccP3Sample();
  const source=new Uint16Array([40000,10000,5000,32768,1000,35000,65000,65535]);
  const bundled=buildSync({entryPoints:['src/workers/tiff.worker.mjs'],bundle:true,write:false,
    platform:'browser',format:'iife'}).outputFiles[0].text;
  const script=`const {parentPort}=require('node:worker_threads');
global.self={postMessage:(message,transfers)=>parentPort.postMessage(message,transfers)};
global.pako=require(${JSON.stringify(path.resolve(__dirname,'../vendor/pako-2.1.0.min.js'))});
global.UTIF={decode:{}};
global.ViewerJpegModule=async()=>({_viewer_jpeg_version:()=>0,UTF8ToString:()=> 'test'});
global.ViewerBmpModule=async()=>({});global.ViewerTiffModule=async()=>({});
${bundled}
parentPort.on('message',data=>self.onmessage({data}));`;
  const worker=new Worker(script,{eval:true});
  let id=0;
  const request=(type,properties={})=>new Promise((resolve,reject)=>{
    const next=++id;
    const onMessage=message=>{
      if(type==='init'?message.type!=='ready'&&message.type!=='error':message.id!==next)return;
      worker.off('error',onError);worker.off('message',onMessage);
      if(message.type==='error')reject(new Error(message.message));else resolve(message);
    };
    const onError=error=>{worker.off('message',onMessage);reject(error);};
    worker.on('message',onMessage);worker.once('error',onError);
    worker.postMessage({type,id:next,...properties});
  });
  try {
    const ready=await request('init');assert.equal(ready.type,'ready');
    const encoded=await request('encode',{width:2,height:1,buffer:new Uint8ClampedArray(8).buffer,
      exactBuffer:source.slice().buffer,sampleType:'uint16',bitDepth:16,colorSpace:'unknown',
      options:{tiffDepth:'16',tiffCompression:'deflate',tiffLevel:6,tiffPredictor:true,iccProfile}});
    const direct=decodeTiff16(encoded.buffer,0,pako);
    assert.deepEqual(direct.data,source);
    assert.deepEqual(direct.iccProfile,iccProfile);
    const decoded=await request('decode',{buffer:encoded.buffer.slice(0),page:0});
    assert.equal(decoded.type,'decoded');assert.equal(decoded.buffer,null);
    assert.deepEqual(new Uint16Array(decoded.exactBuffer),source);
    assert.deepEqual(new Uint8Array(decoded.iccProfileBuffer),iccProfile);
    console.log('PASS TIFF Worker transfers exact 16-bit samples and ICC without premature 8-bit preview');
  }finally{await worker.terminate();}
})().catch(error=>{console.error(error);process.exitCode=1;});
