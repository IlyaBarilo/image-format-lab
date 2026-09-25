const assert = require('node:assert/strict');

(async()=>{
  const {computeSSIM}=await import('../src/core/ssim.mjs');
  const {analysisJSON}=await import('../src/core/analysis-output.mjs');
  const pixels=(width,height,values,depth=8,colorSpace='srgb')=>({width,height,
    data:(depth===16?Uint16Array:Uint8Array).from(values.flat()),sampleType:depth===16?'uint16':'uint8',bitDepth:depth,colorSpace});
  const near=(actual,expected,tolerance=1e-10)=>assert.ok(Math.abs(actual-expected)<tolerance,`${actual} ≠ ${expected}`);
  const black=pixels(1,1,[[0,0,0,255]]),white=pixels(1,1,[[255,255,255,255]]);
  const equal=computeSSIM(black,black);
  near(equal.score,1);assert.equal(equal.minimum,1);assert.equal(equal.maximum,1);
  near(computeSSIM(black,white).score,0.0001/1.0001);
  near(computeSSIM(white,black).score,0.0001/1.0001);
  assert.equal(equal.method.window,11);assert.equal(equal.method.sigma,1.5);
  assert.equal(equal.method.border,'reflect-within-region');
  assert.equal(JSON.parse(analysisJSON(equal)).score,1);

  const transparent=pixels(1,1,[[255,0,0,0]]);
  near(computeSSIM(transparent,white,'white').score,1);
  near(computeSSIM(transparent,white,'black').score,0.0001/1.0001);
  const source=pixels(3,1,[[0,0,0,255],[100,100,100,255],[200,200,200,255]]);
  const altered=pixels(3,1,[[255,255,255,255],[100,100,100,255],[200,200,200,255]]);
  near(computeSSIM(altered,source,'white',{unit:'pixels',x:1,y:0,width:2,height:1}).score,1);
  assert.ok(computeSSIM(altered,source).score<1);
  assert.throws(()=>computeSSIM(black,source),/размеров/);
  assert.throws(()=>computeSSIM(pixels(1,1,[[0,0,0,255]],8,'display-p3'),black),/пространства/);
  assert.throws(()=>computeSSIM(black,white,'red'),/подложка/);

  const source16=pixels(1,1,[[32768,32768,32768,65535]],16);
  const altered16=pixels(1,1,[[32769,32769,32769,65535]],16);
  const high=computeSSIM(altered16,source16);
  assert.ok(high.score<1 && high.score>0.999999999);
  assert.equal(high.bitDepth.result,16);

  // Independent direct 11×11 reference on a small grayscale raster checks both separable passes and borders.
  const a=[0,70,140,210,40,90,160,30,255],b=[0,68,142,208,50,100,150,20,250];
  const grid=values=>pixels(3,3,values.map(v=>[v,v,v,255]));
  const observed=computeSSIM(grid(a),grid(b));
  const weights=Array.from({length:11},(_,i)=>Math.exp(-((i-5)**2)/(2*1.5**2)));
  const total=weights.reduce((sum,n)=>sum+n,0);weights.forEach((n,i)=>weights[i]=n/total);
  const reflect=n=>{while(n<0||n>=3)n=n<0?-n:4-n;return n;};
  let expected=0;
  for(let cy=0;cy<3;cy++)for(let cx=0;cx<3;cx++){
    let ma=0,mb=0,aa=0,bb=0,ab=0;
    for(let dy=-5;dy<=5;dy++)for(let dx=-5;dx<=5;dx++){
      const index=reflect(cy+dy)*3+reflect(cx+dx),weight=weights[dy+5]*weights[dx+5];
      const x=a[index]/255,y=b[index]/255;
      ma+=weight*x;mb+=weight*y;aa+=weight*x*x;bb+=weight*y*y;ab+=weight*x*y;
    }
    const va=Math.max(0,aa-ma*ma),vb=Math.max(0,bb-mb*mb),cov=ab-ma*mb;
    expected+=((2*ma*mb+0.0001)*(2*cov+0.0009))/((ma*ma+mb*mb+0.0001)*(va+vb+0.0009));
  }
  near(observed.score,expected/9,1e-12);
  near(observed.score,computeSSIM(grid(b),grid(a)).score,1e-12);
  console.log('PASS single-scale SSIM identity, reference formula, alpha matte, RGBA16, ROI and validation');
})().catch(error=>{console.error(error);process.exitCode=1;});
