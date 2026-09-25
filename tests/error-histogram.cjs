const assert=require('node:assert/strict');
const {Worker}=require('node:worker_threads');
const {buildSync}=require('../scripts/node_modules/esbuild');
const {makeSnapshot,exportReport}=require('./analysis-report.cjs');

(async()=>{
  const {computeErrorHistogram,errorBinInterval}=await import('../src/core/error-histogram.mjs');
  const {computeHistogram}=await import('../src/core/histogram.mjs');
  const {createPixelBuffer}=await import('../src/core/pixel-buffer.mjs');
  const {analysisJSON,analysisMaximum}=await import('../src/core/analysis-output.mjs');
  const wrap=(data,extra={})=>createPixelBuffer({width:data.length/4,height:1,data,sampleType:data instanceof Uint16Array?'uint16':'uint8',colorSpace:'srgb',...extra});
  const a=wrap(new Uint8Array([0,0,0,255,255,255,255,255]));
  const b=wrap(new Uint8Array([255,255,255,255,0,0,0,255]));
  const unchanged=computeErrorHistogram(a,a);
  assert.equal(unchanged.channels[0][0],2);assert.equal(unchanged.channels[1][0],2);
  assert.deepEqual(Object.values(unchanged.metrics),[0,0,0,0,0,0,0,0,0]);
  assert.deepEqual(computeHistogram(a).channels,computeHistogram(b).channels,'ordinary histograms are identical after pixel permutation');
  const swapped=computeErrorHistogram(b,a);
  assert.equal(swapped.channels[0][255],2);assert.equal(swapped.channels[0][0],0);
  assert.equal(swapped.metrics.maeRGB,100);assert.equal(swapped.metrics.rmseRGB,100);
  assert.equal(swapped.metrics.changedRGB,2);
  assert.equal(swapped.channels[1][0],2);
  assert.equal(errorBinInterval(0),'0% (точное совпадение)');assert.match(errorBinInterval(1),/^\(0\.000%; 0\.392%\]$/);

  const ref16=wrap(new Uint16Array([1000,1000,1000,65535]));
  const low16=wrap(new Uint16Array([1001,1000,1000,65535]));
  const low=computeErrorHistogram(low16,ref16);
  assert.equal(low.channels[0][1],1,'one low bit is retained');
  assert.ok(Math.abs(low.metrics.maeRGB-100/(3*65535))<1e-12);
  assert.ok(Math.abs(low.metrics.rmseRGB-100/(Math.sqrt(3)*65535))<1e-12);
  assert.ok(Math.abs(low.metrics.meanMaxRGB-100/65535)<1e-12);
  const ref8=wrap(new Uint8Array([1,128,255,255]));
  const same16=wrap(new Uint16Array([257,128*257,65535,65535]));
  assert.equal(computeErrorHistogram(same16,ref8).channels[0][0],1,'equivalent 8/16 code values are exact matches');
  const originalA=ref16.data.slice(),originalB=low16.data.slice();
  assert.deepEqual(ref16.data,originalA);assert.deepEqual(low16.data,originalB);

  const transparent=wrap(new Uint8Array([255,0,0,0]));
  const opaque=wrap(new Uint8Array([255,255,255,255]));
  const alpha=computeErrorHistogram(transparent,opaque,'white');
  assert.equal(alpha.channels[0][0],1,'hidden RGB is ignored after composition');
  assert.equal(alpha.channels[1][255],1);assert.equal(alpha.metrics.maeAlpha,100);
  assert.equal(computeErrorHistogram(transparent,opaque,'black').channels[0][255],1);
  const roi=computeErrorHistogram(b,a,'white',{unit:'pixels',x:0,y:0,width:1,height:1});
  assert.equal(roi.pixelCount,1);assert.equal(roi.channels[0][255],1);
  assert.throws(()=>computeErrorHistogram(a,{...a,width:1}),/Длина|размер/);
  assert.throws(()=>computeErrorHistogram(wrap(new Uint8Array([0,0,0,255])),a),/одинаковых размеров/);
  assert.throws(()=>computeErrorHistogram({...a,colorSpace:'display-p3'},a),/пространства/);
  assert.equal(computeErrorHistogram({...a,colorSpace:'unknown'},a).colorComparison,'unknown-code-values');
  assert.throws(()=>computeErrorHistogram({...a,alphaMode:'premultiplied'},a),/прямую прозрачность/);
  assert.throws(()=>computeErrorHistogram(a,a,'checker'),/подложка/);
  assert.throws(()=>computeErrorHistogram(a,a,'white',{unit:'pixels',x:2,y:0,width:1,height:1}),/область/);
  assert.throws(()=>computeErrorHistogram(wrap(new Uint16Array([1,1,1,1023]),{bitDepth:10}),ref16),/RGBA8 и RGBA16/);
  assert.equal(analysisMaximum('errorHistogram',[{data:low}],'rgb'),100);
  const parsed=JSON.parse(analysisJSON({data:low}));assert.equal(parsed.data.channels[0][1],1);assert.ok(parsed.data.metrics.maeRGB>0);
  console.log('PASS exact identity, pixel permutation, low 16-bit differences, mixed depth, alpha, matte, ROI and validation');

  const bundled=buildSync({entryPoints:['src/workers/compute.worker.mjs'],bundle:true,write:false,format:'iife',logLevel:'silent'}).outputFiles[0].text;
  const worker=new Worker(`const {parentPort,workerData}=require('node:worker_threads');const self={postMessage:value=>parentPort.postMessage(value)};new Function('self',workerData)(self);parentPort.on('message',data=>self.onmessage({data}));`,{eval:true,workerData:bundled});
  const run=payload=>new Promise((resolve,reject)=>{worker.once('message',resolve);worker.once('error',reject);worker.postMessage({kind:'errorHistogram',payload});});
  try{assert.deepEqual((await run({pixelBuffer:low16,reference:ref16,matte:'white'})).result,low);assert.deepEqual(low16.data,originalB);assert.deepEqual(ref16.data,originalA);}
  finally{await worker.terminate();}
  console.log('PASS bundled Worker agrees with core and retains source pixels');

  for(const display of ['separate','overlay']){
    const snapshot=await makeSnapshot('errorHistogram',display),before=structuredClone(snapshot);
    const {report,json}=await exportReport(snapshot,{includeJSON:true});
    assert.equal(report.images.length,display==='separate'?2:1);
    assert.equal(json.settings.type,'errorHistogram');assert.equal(json.items[0].data.channels[0][0],snapshot.items[0].data.pixelCount);
    assert.ok(report.ops.some(op=>op[0]==='fillText'&&String(op[1]).includes('MAE RGB')),'PNG names metrics');
    assert.deepEqual(snapshot,before);
  }
  console.log('PASS separate/overlay PNG and JSON report exact bins, units and MAE/RMSE');
})().catch(error=>{console.error(error);process.exitCode=1;});
