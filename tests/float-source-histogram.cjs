const assert = require('node:assert/strict');
const { Worker } = require('node:worker_threads');
const { buildSync } = require('../scripts/node_modules/esbuild');

(async () => {
  const { createPixelBuffer } = await import('../src/core/pixel-buffer.mjs');
  const { computeHistogram } = await import('../src/core/histogram.mjs');
  const { floatHistogramRange } = await import('../src/core/float-histogram.mjs');
  const { histogramSummary } = await import('../src/core/histogram-view.mjs');
  const { analysisJSON } = await import('../src/core/analysis-output.mjs');
  const data = Float32Array.from([
    -0.25,0.5,2,0,
    2,0.5,0,0.5,
    0.25,1,0.75,1
  ]);
  const pixels = createPixelBuffer({ width:3,height:1,data,sampleType:'float32',bitDepth:32,colorSpace:'unknown',alphaMode:'straight' });
  const original = data.slice(), stats = {min:[-0.25,0.5,0,0],max:[2,1,2,1]};
  assert.deepEqual(floatHistogramRange('unit',stats),[0,1]);
  assert.deepEqual(floatHistogramRange('auto',stats),[-0.25,2]);
  assert.deepEqual(floatHistogramRange('manual',stats,'-0.5','2.5'),[-0.5,2.5]);
  for(const [low,high] of [['2','1'],['','1'],['0','Infinity'],['x','2']])
    assert.throws(()=>floatHistogramRange('manual',stats,low,high),/границы/);
  const options={range:[0,1],bins:256,floatPeak:1,rawRgb:true};
  const exact=computeHistogram(pixels,'white',null,options);
  assert.deepEqual([...exact.underflow],[1,0,0,0]);
  assert.deepEqual([...exact.overflow],[1,0,1,0]);
  assert.equal(exact.channels[0][64],1);
  assert.equal(exact.channels[2][0],1);
  assert.equal(exact.channels[3][0],1);
  assert.equal(exact.channels[3][128],1);
  assert.equal(exact.channels[3][255],1);
  assert.notDeepEqual(exact.channels[0],computeHistogram(pixels,'white',null,{range:[0,1],bins:256,floatPeak:1}).channels[0],
    'Transparent RGB remains raw, independent of the preview matte');
  assert.match(histogramSummary(exact,'g',{alwaysOutside:true}),/ниже 0, выше 0/);
  const expanded=computeHistogram(pixels,'white',null,{...options,range:floatHistogramRange('auto',stats)});
  assert.deepEqual([...expanded.underflow],[0,0,0,0]);
  assert.deepEqual([...expanded.overflow],[0,0,0,0]);
  const snapshot={version:1,settings:{type:'floatSource',display:'separate',scope:'full',rangeMode:'unit',range:[0,1],bins:256,rawRgb:true},items:[{cell:1,label:'Точный исходник',data:exact}]};
  const exported=JSON.parse(analysisJSON(snapshot));
  assert.deepEqual(exported.settings.range,[0,1]);
  assert.deepEqual(exported.items[0].data.underflow,[1,0,0,0]);
  assert.equal(exported.items[0].data.channels[0].length,256);
  assert.deepEqual(data,original);

  const source=buildSync({entryPoints:['src/workers/compute.worker.mjs'],bundle:true,write:false,format:'iife',logLevel:'silent'}).outputFiles[0].text;
  const worker=new Worker(`const {parentPort,workerData}=require('node:worker_threads');const self={postMessage:value=>parentPort.postMessage(value)};new Function('self',workerData)(self);parentPort.on('message',data=>self.onmessage({data}));`,{eval:true,workerData:source});
  try {
    const received=await new Promise((resolve,reject)=>{worker.once('message',resolve);worker.once('error',reject);worker.postMessage({kind:'histogram',payload:{pixelBuffer:pixels,matte:'white',options}});});
    assert.deepEqual(received.result,exact);
    assert.deepEqual(data,original);
  } finally {await worker.terminate();}
  console.log('PASS exact float32 source bins, transparent RGB, alpha, ranges, JSON and Worker ownership');
})().catch(error=>{console.error(error);process.exitCode=1;});
