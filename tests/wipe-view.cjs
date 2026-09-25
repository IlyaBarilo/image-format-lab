const assert=require('node:assert/strict');

(async()=>{
  const {wipePair,visibleGridLines}=await import('../src/core/wipe-view.mjs');
  const first={bitmap:{width:960,height:640}},second={bitmap:{width:960,height:640}};
  assert.deepEqual(wipePair(first,second,()=>true),{width:960,height:640});
  assert.match(wipePair(first,second,variant=>variant!==second).message,/готовности/);
  assert.match(wipePair(first,{bitmap:{width:480,height:320}},()=>true).message,/одинаковые размеры/);
  assert.deepEqual(visibleGridLines(-16,16,100,80,16),{first:1,last:6});
  assert.equal(visibleGridLines(-16,16,100,80,7),null,'grid remains hidden below eight CSS pixels');
  assert.equal(visibleGridLines(0,8,1000,4000,8),null,'line budget prevents excessive drawing');
  assert.equal(visibleGridLines(-1000,8,10,100,8),null,'off-screen image has no grid lines');
  const {createComparison}=await import('../src/ui/comparison.mjs');
  const variants=[0,1,2].map(index=>({index,ready:index<2,processing:false,
    cell:{classList:{contains:()=>index===2}}}));
  const app={variants,sourceGeneration:1},encoded=[];
  const comparison=createComparison({app,els:{}},{isVariantReady:variant=>variant.ready,
    renderVariant:async variant=>{encoded.push(variant.index);variant.ready=true;}});
  await comparison.renderVisibleVariants();
  assert.deepEqual(encoded,[],'switching to an aligned view must reuse ready outputs');
  variants[1].ready=false;
  await comparison.renderVisibleVariants();
  assert.deepEqual(encoded,[1],'only an invalidated visible output is encoded');
  console.log('PASS wipe pair readiness, exact alignment and bounded pixel grid');
})().catch(error=>{console.error(error);process.exitCode=1;});
