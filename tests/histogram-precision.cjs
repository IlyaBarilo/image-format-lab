const assert = require('node:assert/strict');
const { Worker } = require('node:worker_threads');
const { buildSync } = require('../scripts/node_modules/esbuild');
const { makeSnapshot, exportReport } = require('./analysis-report.cjs');

(async () => {
  const { createPixelBuffer } = await import('../src/core/pixel-buffer.mjs');
  const { computeHistogram } = await import('../src/core/histogram.mjs');
  const { histogramView, histogramBinAt, histogramInterval, histogramSummary, groupHistogramDelta } = await import('../src/core/histogram-view.mjs');
  const { analysisDelta } = await import('../src/core/analysis-delta.mjs');
  const wrap = (data, extra = {}) => createPixelBuffer({ width: data.length / 4, height: 1, data, colorSpace: 'srgb',
    sampleType: data instanceof Uint16Array ? 'uint16' : data instanceof Float32Array ? 'float32' : 'uint8', ...extra });
  const sum = values => values.reduce((s, n) => s + n, 0);
  const pair = (a,b) => [{cell:1,label:'Первый',data:a},{cell:2,label:'Второй',data:b}];
  const settings = {type:'histogram',channel:'rgb',level:128};
  const data = new Uint16Array(65536 * 4);
  for (let i=0;i<65536;i++) data.set([i,65535-i,i,65535],i*4);
  const pixels=wrap(data,{width:256,height:256}),original=data.slice();
  const h=computeHistogram(pixels);
  assert.equal(h.channels[0].length,65536);
  assert.ok(h.channels.slice(0,3).every(c=>c.every(n=>n===1)));
  assert.equal(h.channels[3][65535],65536);assert.deepEqual([...h.means],[32767.5,32767.5,32767.5,65535]);
  assert.deepEqual(data,original);
  const roi=computeHistogram(pixels,'black',{unit:'pixels',x:254,y:0,width:2,height:2});
  assert.deepEqual([...roi.channels[0].entries()].filter(([,n])=>n),[[254,1],[255,1],[510,1],[511,1]]);
  assert.deepEqual(roi.channels,computeHistogram(pixels,'black',{x0:993,y0:0,x1:1000,y1:7}).channels);
  for(const depth of [1,4,8,10,12,16]){
    const peak=2**depth-1,a=computeHistogram(wrap(new Uint16Array([0,0,0,peak,1,1,1,peak]),{bitDepth:depth}));
    assert.equal(a.channels[0].length,peak+1);assert.equal(a.channels[0][0],1);assert.equal(a.channels[0][1],1);
  }
  const partial=wrap(new Uint16Array([65535,0,1234,32768]));
  assert.equal(computeHistogram(partial,'white').channels[1][32767],1);
  assert.equal(computeHistogram(partial,'black').channels[0][32768],1);
  const straight=wrap(new Uint16Array([65535,0,0,32768])),premultiplied=wrap(new Uint16Array([32768,0,0,32768]),{alphaMode:'premultiplied'});
  for(const matte of ['white','black'])assert.deepEqual(computeHistogram(straight,matte).channels,computeHistogram(premultiplied,matte).channels);
  const badPremult=computeHistogram(wrap(new Uint16Array([65535,0,0,0]),{alphaMode:'premultiplied'}));
  assert.equal(badPremult.overflow[0],1,'No silent clipping of inconsistent premultiplied samples');

  // Legacy RGBA8 composition is independently retained for every alpha code and both mattes.
  const bytes=Uint8ClampedArray.from({length:256*4},(_,i)=>[37,182,255,Math.floor(i/4)][i%4]);
  for(const matte of ['white','black']){
    const expected=Array.from({length:4},()=>new Uint32Array(256)),bg=matte==='white'?255:0;
    for(let i=0;i<bytes.length;i+=4){for(let c=0;c<3;c++)expected[c][Math.round((bytes[i+c]*bytes[i+3]+bg*(255-bytes[i+3]))/255)]++;expected[3][bytes[i+3]]++;}
    const result=computeHistogram({width:256,height:1,data:bytes},matte);
    assert.deepEqual(result.channels,expected);
    result.means.forEach((mean,c)=>assert.equal(mean,expected[c].reduce((s,n,i)=>s+n*i,0)/256));
  }
  console.log('PASS all 65536 integer levels, low bits, alpha/matte, ROI and unchanged RGBA8 counts');

  const options={range:[-1,1],bins:4,floatPeak:1};
  const f=wrap(Float32Array.from([-2,-1,-.5,0,.5,1,2].flatMap(v=>[v,v,v,1])));
  const hf=computeHistogram(f,'black',null,options);
  assert.deepEqual([...hf.channels[0]],[1,1,1,2]);
  assert.deepEqual([...hf.underflow],[1,1,1,0]);assert.deepEqual([...hf.overflow],[1,1,1,0]);
  assert.equal(hf.means[0],0);assert.equal(hf.channels[3][3],7);
  assert.match(histogramSummary(hf),/ниже 1, выше 1/);
  assert.match(histogramInterval(histogramView(pair(hf,hf),'rgb').scale,255),/\]$/);
  const fa=computeHistogram(wrap(new Float32Array([2,2,2,.25,2,2,2,.75])),'white',null,{range:[0,2],bins:4,floatPeak:2});
  assert.deepEqual([...fa.channels[3]],[0,1,0,1]);assert.equal(fa.channels[0][3],2);
  for(const samples of [[NaN,0,0,0],[Infinity,0,0,1],[0,0,0,-.1],[0,0,0,1.1]])assert.throws(()=>computeHistogram(wrap(new Float32Array(samples)),'white',null,options));
  for(const config of [undefined,{},null,{...options,bins:0},{...options,bins:65537},{...options,range:[1,1]},{...options,floatPeak:0},{...options,range:[0,Infinity]}])assert.throws(()=>computeHistogram(f,'white',null,config));
  assert.throws(()=>computeHistogram(wrap(new Uint16Array([1024,0,0,1023]),{bitDepth:10})));
  assert.throws(()=>computeHistogram(pixels,'white',null,options));
  assert.throws(()=>computeHistogram({...pixels,width:1}));
  assert.throws(()=>computeHistogram(pixels,'white',{unit:'pixels',x:256,y:0,width:1,height:1}));
  console.log('PASS explicit float bins, endpoints, out-of-range counts, independent alpha scale and validation');

  const eight=computeHistogram(wrap(new Uint8Array([0,128,255,255,1,2,3,255])));
  const sixteen=computeHistogram(wrap(Uint16Array.from([0,128,255,255,1,2,3,255],v=>v*257)));
  assert.equal(analysisDelta(pair(eight,sixteen),settings).maximum,0);
  assert.equal(histogramView(pair(eight,sixteen)).scale.normalized,true);
  const a=computeHistogram(wrap(new Uint16Array([100,100,100,65535]))),b=computeHistogram(wrap(new Uint16Array([101,101,101,65535])));
  const delta=analysisDelta(pair(a,b),settings);
  assert.equal(delta.channels[0].values[100],-100);assert.equal(delta.channels[0].values[101],100);
  assert.equal(groupHistogramDelta(delta,256).maximum,0,'Within-group cancellation is separate from exact JSON differences');
  for(const bins of [256,300,494,1078,65536]){
    const view=histogramView(pair(h,h),'rgb',bins);
    assert.equal(view.scale.bins,bins);
    for(const item of view.items)for(const channel of item.data.channels)assert.equal(sum(channel),65536);
    assert.equal(histogramBinAt(view.scale,255),bins-1);assert.equal(histogramBinAt(view.scale,0),0);
    assert.equal(view.items[0].data.channels[0][0],Math.ceil(65536/bins));
  }
  assert.deepEqual(data,original);
  assert.throws(()=>histogramView(pair(h,{...h,colorSpace:'display-p3'})),/пространства/);
  assert.throws(()=>histogramView(pair({...h,colorSpace:'unknown'},h)),/пространства/);
  assert.ok(histogramView(pair({...h,colorSpace:'unknown'},h),'rgb',256,{allowUnknownColorSpace:true}));
  assert.throws(()=>histogramView(pair(h,hf)),/диапазоны/);
  assert.throws(()=>histogramView(pair(hf,{...hf,scale:{...hf.scale,bins:8}})),/диапазоны/);
  assert.throws(()=>histogramView(pair(h,{...h,matte:'black'})),/Подложки/);
  const outDelta=analysisDelta(pair(hf,{...hf,underflow:new Uint32Array([0,0,0,0])}),settings);
  assert.ok(Math.abs(outDelta.outside[0].below+100/7)<1e-12);
  console.log('PASS compatible scales, exact deltas, common grouping, conservation and explicit incompatibility');

  const source=buildSync({entryPoints:['src/workers/compute.worker.mjs'],bundle:true,write:false,format:'iife',logLevel:'silent'}).outputFiles[0].text;
  const worker=new Worker(`const {parentPort,workerData}=require('node:worker_threads');const self={postMessage:value=>parentPort.postMessage(value)};new Function('self',workerData)(self);parentPort.on('message',data=>self.onmessage({data}));`,{eval:true,workerData:source});
  const run=payload=>new Promise((resolve,reject)=>{worker.once('message',resolve);worker.once('error',reject);worker.postMessage({kind:'histogram',payload});});
  try{
    assert.deepEqual((await run({pixelBuffer:pixels,matte:'white'})).result,h);
    assert.deepEqual((await run({pixelBuffer:f,matte:'black',options})).result,hf);
    assert.deepEqual((await run({imageData:{width:256,height:1,data:bytes},matte:'black'})).result,computeHistogram({width:256,height:1,data:bytes},'black'));
    assert.match((await run({pixelBuffer:f})).error,/float32/);
    assert.deepEqual(data,original);assert.equal(f.data.byteLength,112);
  }finally{await worker.terminate();}
  console.log('PASS actual bundled Worker, legacy payload, errors and retained input arrays');

  for(const input of [pair(h,b),pair(hf,hf),pair(eight,sixteen)])for(const display of ['separate','overlay','delta']){
    const snapshot=await makeSnapshot('histogram',display);
    snapshot.items=input;snapshot.settings.scope='full';snapshot.settings.channel='rgb';
    const before=structuredClone(snapshot);
    const short=await exportReport(snapshot,{height:80,width:1400,dpr:2,includeJSON:true});
    const tall=await exportReport(snapshot,{height:700,width:320,dpr:1});
    short.report.images.forEach((chart,i)=>{
      assert.deepEqual(chart.ops,tall.report.images[i].ops,'Report redraw and grouping depend only on report size');
      assert.ok(Number(chart.dataset.bins)<=1152,'Report drawing does not emit 65536 path points');
    });
    assert.deepEqual(short.json.items[0].data.channels[0],[...input[0].data.channels[0]],'JSON preserves every original bin');
    assert.deepEqual(short.json.items[0].data.scale,input[0].data.scale);
    assert.deepEqual(short.json.items[0].data.underflow,[...input[0].data.underflow]);
    if(display==='delta')assert.deepEqual(short.json.delta.channels[0].values,[...analysisDelta(input,settings).channels[0].values]);
    assert.deepEqual(snapshot,before);
  }
  console.log('PASS integer/float/mixed-depth PNG and JSON in all views, report-sized grouping, exact source counts and immutable snapshots');
})().catch(error=>{console.error(error);process.exitCode=1;});
