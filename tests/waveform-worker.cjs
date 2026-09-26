// The bundled compute Worker receives exact integer PixelBuffers without detaching the viewer's copy.
const assert = require('node:assert/strict');
const path = require('node:path');
const { Worker } = require('node:worker_threads');
const { buildSync } = require('../scripts/node_modules/esbuild');

(async () => {
  const source = buildSync({ entryPoints:[path.resolve(__dirname,'../src/workers/compute.worker.mjs')],
    bundle:true,write:false,platform:'neutral',format:'iife',logLevel:'silent' }).outputFiles[0].text;
  const worker = new Worker(`
    const {parentPort,workerData}=require('node:worker_threads');
    const self={postMessage:message=>parentPort.postMessage(message)};
    new Function('self',workerData.source)(self);
    parentPort.on('message',data=>self.onmessage({data}));
  `,{eval:true,workerData:{source}});
  try {
    const pixels=Uint16Array.from([32769,32768,32767,65535]);
    const result=await new Promise((resolve,reject)=>{
      const timeout=setTimeout(()=>reject(new Error('Таймаут Worker Waveform.')),10000);
      worker.once('message',message=>{clearTimeout(timeout);resolve(message);});
      worker.once('error',error=>{clearTimeout(timeout);reject(error);});
      worker.postMessage({kind:'waveform',payload:{pixelBuffer:{width:1,height:1,data:pixels,
        sampleType:'uint16',bitDepth:16,colorSpace:'srgb',alphaMode:'straight'},matte:'white'}});
    });
    assert.equal(result.error,undefined);
    assert.equal(result.result.bitDepth,16);
    assert.equal(result.result.levelBins,1024);
    assert.equal(result.result.channelMax[0],32769);
    assert.equal(result.result.channels[0][512],1);
    assert.deepEqual([...pixels],[32769,32768,32767,65535]);
    console.log('PASS bundled compute Worker preserves native RGBA16 samples and returns bounded Waveform counts');
  } finally { await worker.terminate(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
