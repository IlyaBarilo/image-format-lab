const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {Worker} = require('node:worker_threads');
const {buildSync} = require('../scripts/node_modules/esbuild');

(async () => {
  const { createPixelBuffer } = await import('../src/core/pixel-buffer.mjs');
  const { srgbToXyzD65, xyzChromaticity, srgbToLabD50, deltaE00,
    computeCieXy, computeCieIcc, computeDeltaE00, xyzD50ToD65, mapCieReferenceRegion, CIE_GRID_SIZE } = await import('../src/core/color-sdr.mjs');
  const {createIccP3Sample} = await import('../src/core/reference-samples.mjs');
  const near = (actual, expected, tolerance = 0.0002) => assert.ok(Math.abs(actual - expected) <= tolerance,
    `${actual} differs from ${expected} by more than ${tolerance}`);

  for (const [rgb, xy] of [
    [[1, 0, 0], [0.64, 0.33]], [[0, 1, 0], [0.3, 0.6]],
    [[0, 0, 1], [0.15, 0.06]], [[1, 1, 1], [0.3127, 0.329]]
  ]) xyzChromaticity(srgbToXyzD65(...rgb)).forEach((value, i) => near(value, xy[i]));
  assert.equal(xyzChromaticity(srgbToXyzD65(0, 0, 0)), null);
  const white = srgbToLabD50(1, 1, 1);
  near(white[0], 100, 0.001); near(white[1], 0, 0.01); near(white[2], 0, 0.01);

  // Independent published CIEDE2000 supplementary pairs: Sharma, Wu, Dalal (2005), Table I.
  const pairs = [
    [[50, 2.6772, -79.7751], [50, 0, -82.7485], 2.0425],
    [[50, 3.1571, -77.2803], [50, 0, -82.7485], 2.8615],
    [[50, 2.8361, -74.0200], [50, 0, -82.7485], 3.4412],
    [[50, -1.3802, -84.2814], [50, 0, -82.7485], 1.0000],
    [[50, 0, 0], [50, -1, 2], 2.3669],
    [[50, 2.49, -0.001], [50, -2.49, 0.0009], 7.1792],
    [[50, 2.5, 0], [73, 25, -18], 27.1492],
    [[60.2574, -34.0099, 36.2677], [60.4626, -34.1751, 39.4387], 1.2644]
  ];
  for (const [a, b, expected] of pairs) {
    near(deltaE00(a, b), expected, 0.00005);
    near(deltaE00(b, a), expected, 0.00005);
    near(deltaE00(a, a), 0, 1e-12);
  }
  assert.throws(() => deltaE00([NaN, 0, 0], [0, 0, 0]), /конечные/);

  const rgba8 = (width, height, values, colorSpace = 'srgb') => createPixelBuffer({width, height,
    sampleType:'uint8',bitDepth:8,colorSpace,data:Uint8Array.from(values)});
  const rgba16 = (width, height, values, colorSpace = 'srgb') => createPixelBuffer({width, height,
    sampleType:'uint16',bitDepth:16,colorSpace,data:Uint16Array.from(values)});
  const sample = rgba8(2, 2, [255,0,0,255, 0,0,0,255, 20,30,40,0, 255,255,255,255]);
  const cieWhite = computeCieXy(sample, 'white');
  assert.equal(cieWhite.pixelCount, 4);assert.equal(cieWhite.sampleCount, 4);
  assert.equal(cieWhite.blackCount, 1);assert.equal(cieWhite.occupiedBins, 2);
  assert.equal(cieWhite.bins.reduce((sum, n) => sum + n, 0), 3);
  const cieBlack = computeCieXy(sample, 'black');
  assert.equal(cieBlack.blackCount, 2);
  const roi = computeCieXy(sample, 'white', {unit:'pixels',x:0,y:0,width:1,height:2});
  assert.equal(roi.pixelCount, 2);assert.equal(roi.sampleCount, 2);
  assert.equal(roi.bins.length, CIE_GRID_SIZE ** 2);
  assert.equal(computeCieXy(sample, 'white', null, 2).sampleCount, 2);

  const reference = rgba8(2, 1, [255,0,0,255, 10,20,30,0]);
  const same16 = rgba16(2, 1, [65535,0,0,65535, 2570,5140,7710,0]);
  const equal = computeDeltaE00(same16, reference, 'white');
  near(equal.mean, 0, 1e-12);near(equal.maximum, 0, 1e-12);
  const lowBits = computeDeltaE00(rgba16(1, 1, [32769, 32768, 32768, 65535]),
    rgba16(1, 1, [32768, 32768, 32768, 65535]), 'white');
  assert.ok(lowBits.mean > 0 && lowBits.mean < 0.01, '16-bit differences are not reduced to 8 bits');
  const altered = rgba8(2, 1, [0,255,0,255, 10,20,30,0]);
  const difference = computeDeltaE00(altered, reference, 'white');
  assert.ok(difference.mean > 20 && difference.maximum > difference.mean);
  assert.equal(difference.changed, 1);
  const sampled = computeDeltaE00(rgba8(4, 1, [255,0,0,255, 0,255,0,255, 255,0,0,255, 0,255,0,255]),
    rgba8(4, 1, [255,0,0,255, 255,0,0,255, 255,0,0,255, 255,0,0,255]), 'white', null, 2);
  assert.equal(sampled.sampleCount, 2);assert.equal(sampled.exact, false);assert.equal(sampled.changed, 2);
  assert.throws(() => computeDeltaE00(sample, reference), /одинаковых размеров/);
  assert.throws(() => computeCieXy(rgba8(1, 1, [255,0,0,255], 'display-p3')), /SDR sRGB/);
  assert.equal(computeCieXy(rgba8(1, 1, [255,0,0,255], 'unknown')).colorAssumption, 'srgb-assumed');
  assert.throws(() => computeCieXy(sample, 'white', null, 500001), /предел/);
  xyzD50ToD65([0.9642,1,0.8249]).forEach((value,i)=>near(value,[0.9504,1,1.0889][i],0.002));
  const {pixels:p3Pixels,iccProfile:p3Profile}=createIccP3Sample();
  const p3Red=rgba16(1,1,[65535,0,0,65535]);
  const nativeRed=computeCieIcc(p3Red,p3Profile);
  assert.equal(computeCieIcc(rgba16(1,1,[65535,0,0,65535],'display-p3'),p3Profile).outOfSrgbCount,1);
  assert.deepEqual(mapCieReferenceRegion({unit:'pixels',x:3,y:2,width:5,height:4},10,10,20,20),{unit:'pixels',x:6,y:4,width:10,height:8});
  assert.deepEqual(mapCieReferenceRegion({unit:'pixels',x:1,y:1,width:2,height:2},3,3,5,5),{unit:'pixels',x:1,y:1,width:4,height:4});
  assert.deepEqual(mapCieReferenceRegion({x0:100,y0:100,x1:900,y1:900},10,10,20,20),{x0:100,y0:100,x1:900,y1:900});
  near(nativeRed.primaries[0][0],0.68,0.005);near(nativeRed.primaries[0][1],0.32,0.005);
  assert.equal(nativeRed.outOfSrgbCount,1);
  assert.equal(nativeRed.outOfSrgbPercent,100);
  const srgbProfile=new Uint8Array(fs.readFileSync(path.join(__dirname,'fixtures/srgb-test.icc')));
  assert.equal(computeCieIcc(rgba8(1,1,[255,0,0,255]),srgbProfile).outOfSrgbCount,0);
  const transparent=rgba16(2,1,[65535,0,0,0,65535,0,0,65535]);
  assert.equal(computeCieIcc(transparent,p3Profile,'black').blackCount,1);
  assert.equal(computeCieIcc(transparent,p3Profile,'white',{unit:'pixels',x:0,y:0,width:1,height:1}).outOfSrgbCount,0);
  assert.equal(computeCieIcc(p3Pixels,p3Profile,'white',null,1000).sampleCount,1000);
  assert.throws(()=>computeCieIcc(p3Red,new Uint8Array(8)),/профил/);
  const bundled = buildSync({entryPoints:['src/workers/compute.worker.mjs'],bundle:true,write:false,format:'iife',logLevel:'silent'}).outputFiles[0].text;
  const worker = new Worker(`const {parentPort,workerData}=require('node:worker_threads');const self={postMessage:value=>parentPort.postMessage(value)};new Function('self',workerData)(self);parentPort.on('message',data=>self.onmessage({data}));`,{eval:true,workerData:bundled});
  const run = (kind,payload) => new Promise((resolve,reject)=>{worker.once('message',resolve);worker.once('error',reject);worker.postMessage({kind,payload});});
  const original = same16.data.slice();
  try {
    assert.deepEqual((await run('cieXy',{pixelBuffer:same16,matte:'white'})).result, computeCieXy(same16));
    assert.deepEqual((await run('deltaE',{pixelBuffer:same16,reference,matte:'white'})).result, equal);
    assert.deepEqual((await run('cieIcc',{pixelBuffer:p3Red,iccProfile:p3Profile,matte:'white'})).result,nativeRed);
    assert.deepEqual(same16.data,original);
  } finally { await worker.terminate(); }
  console.log('PASS CIE xy D65, D50 Lab, published CIEDE2000 vectors, alpha/ROI, precision and bounded sampling');
})().catch(error => { console.error(error); process.exitCode = 1; });
