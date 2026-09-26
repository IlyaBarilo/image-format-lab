// Exact integer inputs reach both scopes before their bounded display grids.
const assert = require('node:assert/strict');
const path = require('node:path');
const { Worker } = require('node:worker_threads');
const { buildSync } = require('../scripts/node_modules/esbuild');

(async () => {
  const { computeVectorscope } = await import('../src/core/vectorscope.mjs');
  const { computeDifference, differenceColor } = await import('../src/core/difference.mjs');
  const pixel = (data, sampleType = 'uint16', colorSpace = 'srgb', width = 1) => ({
    width, height: data.length / (width * 4), data,
    sampleType, bitDepth: sampleType === 'uint16' ? 16 : 8, colorSpace, alphaMode: 'straight'
  });
  const source = pixel(Uint16Array.from([32768,32768,32768,65535]));
  const changed = pixel(Uint16Array.from([32769,32768,32768,65535]));
  const original = [...source.data], modified = [...changed.data];
  const vector = computeVectorscope(changed), neutral = computeVectorscope(source);
  assert.equal(vector.bitDepth,16);
  assert.equal(vector.bins.reduce((sum,count) => sum + count,0),1);
  assert.deepEqual([...vector.bins],[...neutral.bins], 'screen bins can coincide while the underlying Cb/Cr means differ');
  assert.ok(vector.meanCr > neutral.meanCr);
  assert.ok(vector.meanCb < neutral.meanCb);
  const difference = computeDifference(changed,source);
  assert.equal(difference.bitDepth.result,16);
  assert.equal(difference.bitDepth.source,16);
  assert.equal(difference.units,'8bit-equivalent');
  assert.equal(difference.maps[0][0],1, 'a one-code change remains visible');
  assert.equal(difference.changed[0],1);
  assert.equal(difference.maxima[0],255/65535);
  assert.equal(difference.means[0],255/65535);
  assert.equal(difference.maps[1][0],0);
  assert.deepEqual(differenceColor(0),[0,0,0]);
  assert.ok(differenceColor(difference.maps[0][0])[1]>=25,'the first nonzero display level is visible');
  const pair16=pixel(Uint16Array.from([32768,32768,32768,65535,32769,32768,32768,65535]),'uint16','srgb',2);
  const region={unit:'pixels',x:1,y:0,width:1,height:1};
  assert.equal(computeVectorscope(pair16,'white',region).meanCr,vector.meanCr);
  assert.equal(computeDifference(pair16,pixel(Uint16Array.from([32768,32768,32768,65535,32768,32768,32768,65535]),'uint16','srgb',2),'white',region).changed[0],1);

  const rgb8=pixel(Uint8Array.from([10,20,30,255,0,0,0,128]),'uint8','srgb',2);
  const base8=pixel(Uint8Array.from([40,20,30,255,0,0,0,255]),'uint8','srgb',2);
  const oldScale=computeDifference(rgb8,base8);
  assert.deepEqual([...oldScale.maps[0]],[30,127]);
  assert.deepEqual(oldScale.maxima,[127,127]);

  const matching8 = pixel(Uint8Array.from([128,128,128,255]),'uint8');
  const matching16 = pixel(Uint16Array.from([32896,32896,32896,65535]));
  assert.deepEqual(computeDifference(matching8,matching16).changed,[0,0], 'equivalent 8/16-bit code values match');
  const alpha16 = pixel(Uint16Array.from([1000,2000,3000,32896]));
  const alpha8 = pixel(Uint8Array.from([4,8,12,128]),'uint8');
  const mixed = computeDifference(alpha8,alpha16);
  assert.equal(mixed.changed[1],0);
  assert.equal(mixed.bitDepth.result,8);
  assert.equal(mixed.bitDepth.source,16);
  const transparent = pixel(Uint16Array.from([65535,0,0,0]));
  const opaque = pixel(Uint16Array.from([65535,0,0,65535]));
  assert.equal(computeVectorscope(transparent,'white').bins[128*257+128],1);
  assert.equal(computeDifference(opaque,transparent,'white').maps[0][0],255);
  assert.equal(computeDifference(opaque,transparent,'black').maps[0][0],255);
  assert.throws(() => computeDifference(changed,pixel(source.data,'uint16','display-p3')),/Цветовые пространства/);
  assert.equal(computeDifference(changed,pixel(source.data,'uint16','unknown')).colorComparison,'unknown-code-values');
  assert.throws(() => computeVectorscope(pixel(new Float32Array([0,0,0,1]),'float32')),/отсчётов/);
  assert.deepEqual([...source.data],original);
  assert.deepEqual([...changed.data],modified);

  const bytes = buildSync({entryPoints:[path.resolve(__dirname,'../src/workers/compute.worker.mjs')],
    bundle:true,write:false,platform:'neutral',format:'iife',logLevel:'silent'}).outputFiles[0].text;
  const worker = new Worker(`
    const {parentPort,workerData}=require('node:worker_threads');
    const self={postMessage:message=>parentPort.postMessage(message)};
    new Function('self',workerData.source)(self);
    parentPort.on('message',data=>self.onmessage({data}));
  `,{eval:true,workerData:{source:bytes}});
  const compute = (kind,payload) => new Promise((resolve,reject) => {
    const timeout=setTimeout(() => reject(new Error(`Таймаут Worker ${kind}.`)),10000);
    worker.once('message',message => {clearTimeout(timeout);resolve(message);});
    worker.once('error',error => {clearTimeout(timeout);reject(error);});
    worker.postMessage({kind,payload});
  });
  try {
    const scope=await compute('vectorscope',{pixelBuffer:changed,matte:'white'});
    assert.equal(scope.error,undefined);
    assert.equal(scope.result.meanCr,vector.meanCr);
    const map=await compute('difference',{pixelBuffer:changed,reference:source,matte:'white'});
    assert.equal(map.error,undefined);
    assert.deepEqual([...map.result.maps[0]],[1]);
    assert.equal(map.result.maxima[0],255/65535);
    assert.deepEqual([...source.data],original);
    assert.deepEqual([...changed.data],modified);
  } finally { await worker.terminate(); }
  console.log('PASS precise RGBA16 vectorscope and difference map, mixed depth and Worker');
})().catch(error => { console.error(error); process.exitCode=1; });
