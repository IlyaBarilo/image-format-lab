const assert=require('node:assert/strict');

(async()=>{
  const {analysisGuideGeometry}=await import('../src/core/analysis-guides.mjs');
  const {analysisRegionBounds}=await import('../src/core/analysis-region.mjs');
  const {profileEndpoints}=await import('../src/core/line-profile.mjs');
  const image={width:13,height:9,data:new Uint8ClampedArray(13*9*4)};
  const region={x0:125,y0:200,x1:825,y1:800};
  const line={x0:0,y0:1000,x1:1000,y1:0};
  const expected=analysisRegionBounds(image.width,image.height,region);
  const fixed=analysisGuideGeometry(image.width,image.height,{scope:'region',region,type:'histogram'});
  assert.deepEqual(fixed,{region:expected,line:null});
  const profile=analysisGuideGeometry(image.width,image.height,{scope:'region',region,type:'profile',line});
  assert.deepEqual(profile.region,expected);
  assert.deepEqual(profile.line,profileEndpoints(image,region,line).points,'guide must follow sampled pixel centers');
  const viewport={unit:'pixels',x:3,y:2,width:5,height:4};
  const visible=analysisGuideGeometry(image.width,image.height,{scope:'viewport',viewport,type:'profile',line});
  assert.equal(visible.region,null);
  assert.deepEqual(visible.line,profileEndpoints(image,viewport,line).points);
  assert.equal(analysisGuideGeometry(image.width,image.height,{scope:'viewport',type:'profile',line}),null);
  assert.equal(analysisGuideGeometry(image.width,image.height,{scope:'viewport',type:'histogram'}),null);
  assert.equal(analysisGuideGeometry(image.width,image.height,{scope:'full',type:'histogram'}),null);
  assert.equal(analysisGuideGeometry(image.width,image.height,{scope:'region',region,type:'tradeoff'}),null);
  assert.deepEqual(analysisGuideGeometry(image.width,image.height,{scope:'full',type:'profile',line}).line,
    profileEndpoints(image,null,line).points);
  console.log('PASS analysis guide bounds match sampled region and profile pixels');
})().catch(error=>{console.error(error);process.exitCode=1;});
