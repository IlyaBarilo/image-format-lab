const assert = require('node:assert/strict');
const path = require('node:path');
const {Worker} = require('node:worker_threads');
const {buildSync} = require('../scripts/node_modules/esbuild');

(async () => {
  const {computeBoundaryMap,BOUNDARY_COLORS} = await import('../src/core/boundary-map.mjs');
  const pixel = (values,bitDepth=16,width=values.length/4) => ({width,height:values.length/(width*4),data:bitDepth===16?Uint16Array.from(values):Uint8Array.from(values),sampleType:bitDepth===16?'uint16':'uint8',bitDepth,colorSpace:'srgb',alphaMode:'straight'});
  const input=pixel([0,100,65535,65535,1,65534,32000,32768,65535,65535,65535,0,32768,32768,32768,65535],16,2);
  const original=[...input.data];
  const white=computeBoundaryMap(input,'white');
  assert.equal(white.bitDepth,16);
  assert.deepEqual([...white.maps[0]],[3,0,2,0]);
  assert.deepEqual([...white.maps[1]],[2,0,1,2]);
  assert.deepEqual(white.counts[0],{low:1,high:2,both:1,any:2});
  assert.deepEqual(white.counts[1],{low:1,high:2,both:0,any:3});
  assert.deepEqual(BOUNDARY_COLORS[3],[210,107,236]);
  const black=computeBoundaryMap(input,'black');
  assert.deepEqual([...black.maps[0]],[3,0,1,0]);
  assert.deepEqual(black.counts[0],{low:2,high:1,both:1,any:2});
  const roi=computeBoundaryMap(input,'white',{unit:'pixels',x:0,y:1,width:1,height:1});
  assert.equal(roi.pixelCount,1);
  assert.deepEqual(roi.counts[0],{low:0,high:1,both:0,any:1});
  const eight=computeBoundaryMap(pixel([0,255,1,255,20,30,40,0],8));
  assert.equal(eight.scaleMax,255);
  assert.deepEqual(eight.counts[0],{low:1,high:2,both:1,any:2});
  assert.deepEqual(eight.counts[1],{low:1,high:1,both:0,any:2});
  const grouped=pixel(Array.from({length:1024*4},(_,i)=>i%4===3?65535:i<4?0:i>=4&&i<8?65535:32768),16,1024);
  const map=computeBoundaryMap(grouped,'black');
  assert.equal(map.mapWidth,512);
  assert.equal(map.maps[0][0],3,'different pixels keep both boundaries in one reduced map cell');
  assert.equal(map.counts[0].both,0,'exact counts remain pixel based');
  assert.throws(()=>computeBoundaryMap({...input,sampleType:'float32',bitDepth:32,data:Float32Array.from(input.data)}),/RGBA8\/16/);
  assert.deepEqual([...input.data],original);

  const bytes=buildSync({entryPoints:[path.resolve(__dirname,'../src/workers/compute.worker.mjs')],bundle:true,write:false,platform:'neutral',format:'iife',logLevel:'silent'}).outputFiles[0].text;
  const worker=new Worker(`const {parentPort,workerData}=require('node:worker_threads');const self={postMessage:m=>parentPort.postMessage(m)};new Function('self',workerData.source)(self);parentPort.on('message',data=>self.onmessage({data}));`,{eval:true,workerData:{source:bytes}});
  try{
    const response=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Таймаут Worker boundaryMap.')),10000);worker.once('message',m=>{clearTimeout(timer);resolve(m)});worker.once('error',reject);worker.postMessage({kind:'boundaryMap',payload:{pixelBuffer:input,matte:'white'}});});
    assert.equal(response.error,undefined);
    assert.deepEqual(response.result.counts,white.counts);
    assert.deepEqual([...response.result.maps[0]],[...white.maps[0]]);
    assert.deepEqual([...input.data],original);
  }finally{await worker.terminate();}
  console.log('PASS exact RGBA8/16 boundary map, matte, ROI, reduction, validation and Worker');
})().catch(error=>{console.error(error);process.exitCode=1;});
