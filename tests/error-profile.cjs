// Exact per-pixel line errors and native histogram boundary counts. No browser.
const assert = require('node:assert/strict');

(async()=>{
  const {computeErrorProfile}=await import('../src/core/error-profile.mjs');
  const {computeHistogram}=await import('../src/core/histogram.mjs');
  const {histogramSummary}=await import('../src/core/histogram-view.mjs');
  const {profileBinAt}=await import('../src/core/line-profile.mjs');
  const {analysisMaximum,analysisJSON}=await import('../src/core/analysis-output.mjs');
  const near=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-10,`${actual} ≠ ${expected}`);
  const pixels=(values,sampleType='uint8',colorSpace='srgb')=>({width:values.length,height:1,data:(sampleType==='uint16'?Uint16Array:Uint8Array).from(values.flat()),sampleType,bitDepth:sampleType==='uint16'?16:8,colorSpace});
  const source=pixels([[100,100,100,255],[100,100,100,255],[100,100,100,255]]);
  const result=pixels([[99,100,100,255],[101,100,100,255],[100,100,100,255]]);
  const before=structuredClone(result.data);
  const profile=computeErrorProfile(result,source);
  assert.equal(profile.sampleCount,3);assert.equal(profile.bins,3);
  near(profile.channels[0].mean[0],100/255);
  near(profile.channels[0].mean[1],100/255);
  assert.equal(profile.channels[0].mean[2],0);
  assert.equal(profile.channels[1].mean[0],0);
  assert.equal(profileBinAt(profile,500),1);
  assert.equal(profile.unit,'percent-of-full-range');
  near(analysisMaximum('errorProfile',[{data:profile}],'rgb'),100/255);
  near(JSON.parse(analysisJSON(profile)).channels[0].mean[1],100/255);
  assert.deepEqual(result.data,before,'input samples remain untouched');

  const area={unit:'pixels',x:1,y:0,width:1,height:1};
  const cropped=computeErrorProfile(result,source,'white',area);
  assert.equal(cropped.sampleCount,1);assert.equal(cropped.points.x0,1);near(cropped.channels[0].mean[0],100/255);
  const reversed=computeErrorProfile(result,source,'white',null,{x0:1000,y0:0,x1:0,y1:0});
  assert.deepEqual([...reversed.channels[0].mean],[...profile.channels[0].mean].reverse());

  const source16=pixels([[32768,32768,32768,65535],[32768,32768,32768,65535]],'uint16');
  const result16=pixels([[32769,32768,32768,65535],[32767,32768,32768,65534]],'uint16');
  const precise=computeErrorProfile(result16,source16,'black');
  near(precise.channels[0].mean[0],100/65535);
  near(precise.channels[0].mean[1],100/65535);
  assert.equal(precise.channels[1].mean[0],0);
  near(precise.channels[1].mean[1],100/65535);
  assert.equal(precise.bitDepth.result,16);
  const transparentSource=pixels([[255,0,0,0]]),transparentResult=pixels([[0,0,255,0]]);
  for(const matte of ['white','black'])assert.equal(computeErrorProfile(transparentResult,transparentSource,matte).channels[0].mean[0],0);
  assert.throws(()=>computeErrorProfile(pixels([[0,0,0,255]]),source),/размеров/);
  assert.throws(()=>computeErrorProfile(pixels([[0,0,0,255]],'uint8','display-p3'),pixels([[0,0,0,255]])),/пространства/);
  assert.throws(()=>computeErrorProfile(result,source,'invalid'),/подложка/);

  const longSource=pixels(Array.from({length:2048},()=>[100,100,100,255]));
  const longResult=pixels(Array.from({length:2048},(_,i)=>[i===0?99:i===1?101:100,100,100,255]));
  const grouped=computeErrorProfile(longResult,longSource);
  assert.equal(grouped.bins,1024);assert.equal(grouped.counts[0],2);
  near(grouped.channels[0].mean[0],100/255); // Opposite signed deviations cannot cancel before grouping.

  const histogram=computeHistogram(pixels([[0,255,64,0],[255,0,64,255],[128,0,64,255]]));
  assert.deepEqual(histogram.boundaryCounts,{low:[0,2,0,1],high:[2,1,1,2]});
  const summary=histogramSummary(histogram,'r');
  assert.match(summary,/На границе диапазона/);assert.match(summary,/R 0: 0/);assert.match(summary,/255: 2/);assert.match(summary,/не доказательство клиппинга/);
  const highHistogram=computeHistogram(source16);
  assert.equal(highHistogram.boundaryCounts.high[3],2);
  assert.match(histogramSummary(highHistogram,'alpha'),/65535: 2/);
  console.log('PASS exact RGB/alpha line errors, native RGBA16 bits, ROI, grouping, validation and boundary counts');
})().catch(error=>{console.error(error);process.exitCode=1;});
