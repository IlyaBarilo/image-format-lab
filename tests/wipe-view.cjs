const assert=require('node:assert/strict');

(async()=>{
  const {wipePair,visibleGridLines,visibleJpegBlockLines,jpegBlockSize}=await import('../src/core/wipe-view.mjs');
  const first={bitmap:{width:960,height:640}},second={bitmap:{width:960,height:640}};
  assert.deepEqual(wipePair(first,second,()=>true),{width:960,height:640});
  assert.match(wipePair(first,second,variant=>variant!==second).message,/готовности/);
  assert.match(wipePair(first,{bitmap:{width:480,height:320}},()=>true).message,/одинаковые размеры/);
  assert.deepEqual(visibleGridLines(-16,16,100,80,16),{first:1,last:6});
  assert.equal(visibleGridLines(-16,16,100,80,7),null,'grid remains hidden below eight CSS pixels');
  assert.equal(visibleGridLines(0,8,1000,4000,8),null,'line budget prevents excessive drawing');
  assert.equal(visibleGridLines(-1000,8,10,100,8),null,'off-screen image has no grid lines');
  assert.deepEqual(jpegBlockSize('444'),{width:8,height:8});
  assert.deepEqual(jpegBlockSize('422'),{width:16,height:8});
  assert.deepEqual(jpegBlockSize('420'),{width:16,height:16});
  assert.equal(visibleJpegBlockLines(0,2.9,960,600,2.9),null,'block lines remain hidden until readable');
  assert.deepEqual(visibleJpegBlockLines(-16,3,100,100,3),{first:1,last:4},'block lines stay anchored to image coordinates after panning');
  assert.equal(visibleJpegBlockLines(0,3,4000,12000,3),null,'very dense block views have a line budget');
  const {createCanvas}=await import('../src/ui/canvas.mjs');
  const strokes=[],segments=[];
  const context={save(){},restore(){},beginPath(){segments.length=0;},rect(){},clip(){},drawImage(){},
    moveTo(x,y){segments.push(['move',x,y]);},lineTo(x,y){segments.push(['line',x,y]);},
    stroke(){strokes.push({width:this.lineWidth,segments:segments.map(part=>[...part])});}};
  const preview={width:256,height:256,getBoundingClientRect:()=>({width:256,height:256})};
  const result={index:1,canvas:preview,ctx:context,bitmap:{width:32,height:32},resultConfig:{format:'jpeg',jpegSubsampling:'422'}};
  const gridApp={source:{width:32,height:32},view:{centerX:16,centerY:16},gridMode:'jpeg-blocks',pixelGrid:true};
  const drawing=createCanvas({app:gridApp,els:{}},{drawBackground(){},drawImageFrame(){},getDrawScale:()=>4,isVariantReady:()=>true});
  drawing.drawVariant(result);
  assert.equal(strokes.length,2,'JPEG grid has fine DCT lines and stronger MCU lines');
  assert.ok(strokes[0].segments.some(part=>part[0]==='move'&&part[1]===96.5),'first 8-pixel line uses the output origin');
  assert.ok(strokes[1].segments.some(part=>part[0]==='move'&&part[1]===128.5),'4:2:2 MCU has a 16-pixel horizontal period');
  assert.ok(strokes[1].segments.some(part=>part[0]==='move'&&part[2]===96.5),'4:2:2 MCU has an 8-pixel vertical period');
  strokes.length=0;result.resultConfig={format:'png'};drawing.drawVariant(result);
  assert.equal(strokes.length,0,'other formats do not receive a JPEG grid');
  result.resultConfig={format:'jpeg',jpegSubsampling:'420'};
  const notReady=createCanvas({app:gridApp,els:{}},{drawBackground(){},drawImageFrame(){},getDrawScale:()=>4,isVariantReady:()=>false});
  notReady.drawVariant(result);
  assert.equal(strokes.length,0,'stale JPEG output does not receive a grid');
  const handle={style:{},attrs:{},setAttribute(key,value){this.attrs[key]=String(value);}};
  const modeApp={wipe:{active:false,position:.5,previousLayout:null},layout:4,source:null};
  const layouts=[];
  const canvas=createCanvas({app:modeApp,els:{wipeOverlay:{},wipeHandle:handle}},
    {clamp:(value,min,max)=>Math.max(min,Math.min(max,value)),updateLayout:count=>layouts.push(count)});
  canvas.setWipeMode(true);
  assert.equal(modeApp.wipe.active,true,'combined view can be selected before a file is opened');
  assert.deepEqual(layouts,[2]);
  canvas.setWipePosition(.37123);
  assert.equal(handle.style.left,'37.123%','visual boundary must keep the fractional position');
  assert.equal(handle.attrs['aria-valuenow'],'37','screen-reader value can remain rounded');
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
  console.log('PASS wipe pair readiness, precise divider, empty-state selection and bounded pixel/JPEG grids');
})().catch(error=>{console.error(error);process.exitCode=1;});
