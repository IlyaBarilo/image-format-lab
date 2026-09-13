// Begin collapsed so worker-count fixtures explicitly control when analysis starts.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {chromium} = require('playwright');
const artifacts = require('./support/artifacts.cjs');
const folder = process.env.IMAGE_TEST_LOGS ? artifacts.folder(process.env.IMAGE_TEST_LOGS) : null;
let failures=0;const checks=[];
const reference={width:4,height:1,data:new Uint8ClampedArray([0,0,0,255,255,0,0,128,17,40,90,0,100,100,100,255])};
const changed={width:4,height:1,data:new Uint8ClampedArray([10,20,30,255,255,0,0,255,255,255,255,255,101,99,100,255])};
const middle={x0:250,y0:0,x1:750,y1:1000};
async function ready(page){await page.waitForFunction(()=>app.source&&!app.sourceLoading&&app.variants.slice(0,app.layout).every(isVariantReady));}
async function plots(page,kind='difference'){await page.waitForFunction(kind=>[...document.querySelectorAll('.analysis-card')].filter(c=>!c.hidden).every(c=>c.dataset.state==='ready'&&c.querySelector('canvas').dataset.kind===kind),kind);}
async function edit(page,values){await page.locator('#analysisScope').selectOption('region');for(const [name,value]of Object.entries(values))await page.locator('#analysisRegion'+name).fill(String(value));}
(async()=>{
  const {computeDifference,differenceColor}=await import('../src/core/difference.mjs');
  const {analysisBounds}=await import('../src/core/analysis-region.mjs');
  const {computeHistogram}=await import('../src/core/histogram.mjs');
  const {computeWaveform}=await import('../src/core/waveform.mjs');
  const before=reference.data.slice(),after=changed.data.slice();
  const white=computeDifference(changed,reference),black=computeDifference(changed,reference,'black');
  assert.deepEqual([...white.maps[0]],[30,127,0,1]);assert.deepEqual([...white.maps[1]],[0,127,255,0]);
  assert.deepEqual([...black.maps[0]],[30,127,255,1]);
  assert.deepEqual(white.means,[39.5,95.5]);assert.deepEqual(white.maxima,[127,255]);assert.deepEqual(white.changed,[3,2]);
  assert.deepEqual([...computeDifference(reference,reference).maps[0]],[0,0,0,0]);
  const region=computeDifference(changed,reference,'white',middle);
  assert.equal(region.pixelCount,2);assert.deepEqual([...region.maps[0]],[127,0]);assert.equal(region.means[0],63.5);
  const h=computeHistogram(changed,'white',middle),wave=computeWaveform(changed,'white',middle);
  assert.equal(h.pixelCount,2);assert.equal(h.channels[0][255],2);assert.equal(h.channels[1][0],1);assert.equal(h.channels[1][255],1);
  assert.deepEqual([...wave.columnPixels],[1,1]);assert.equal(wave.channels[3][54],1);assert.equal(wave.channels[3][256+255],1);
  assert.deepEqual(analysisBounds({width:3,height:2,data:new Uint8Array(24)},middle),{x:0,y:0,width:3,height:2});
  assert.throws(()=>computeDifference(changed,{width:2,height:2,data:new Uint8Array(16)}),/одинаковых/);
  for(const bad of [{x0:0,y0:0,x1:0,y1:1000},{...middle,x1:1001},{...middle,x0:0.5},{...middle,y0:-1}]){
    assert.throws(()=>computeHistogram(changed,'white',bad));assert.throws(()=>computeWaveform(changed,'white',bad));assert.throws(()=>computeDifference(changed,reference,'white',bad));
  }
  assert.throws(()=>computeDifference(changed,reference,'checker'));
  assert.deepEqual(reference.data,before);assert.deepEqual(changed.data,after);
  const large={width:1024,height:512,data:new Uint8ClampedArray(1024*512*4).fill(255)},one={...large,data:large.data.slice()};
  one.data[(511*1024+1023)*4]=254;
  const reduced=computeDifference(one,large);
  assert.equal(reduced.mapWidth,512);assert.equal(reduced.mapHeight,256);assert.equal(reduced.maps[0].at(-1),1);
  assert.equal(reduced.changed[0],1);assert.equal(reduced.means[0],1/(1024*512));
  assert.deepEqual(differenceColor(0,64),[0,0,0]);assert.deepEqual(differenceColor(255),[255,48,64]);
  assert.deepEqual(differenceColor(64,4),[255,48,64]);
  checks.push({name:'exact RGB/alpha, matte, ROI bounds, all scopes, identity and preserved single-pixel peaks',passed:true});
  console.log('PASS exact RGB/alpha, matte, ROI bounds, all scopes, identity and preserved single-pixel peaks');
  const url=pathToFileURL(require('./support/viewer-path.cjs')()).href;
  const browser=await chromium.launch({headless:true,executablePath:process.env.IMAGE_TEST_BROWSER||undefined});
  async function check(name,fn,options={}){
    const context=await browser.newContext({viewport:{width:1440,height:1000},...options}),page=await context.newPage();
    const errors=[],requests=[];page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/^https?:/.test(r.url()))requests.push(r.url());});
    try{await context.setOffline(true);await page.goto(url);await page.locator('#analysisDisplaySeparate').click();await page.locator('#analysisCollapse').click();await fn(page);assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);checks.push({name,passed:true});console.log('PASS '+name);}
    catch(e){failures++;checks.push({name,passed:false,error:e.message});console.error('FAIL '+name+': '+e.stack);}
    finally{await context.close();}
  }
  try{
    await check('Worker retains both inputs and matches exact differences/region',async page=>{
      const result=await page.evaluate(async ({a,b,region})=>{
        const imageData=new ImageData(new Uint8ClampedArray(a),4,1),reference=new ImageData(new Uint8ClampedArray(b),4,1);
        const r=await workerCompute('difference',{imageData,reference,region,matte:'white'});
        return {maps:r.maps.map(c=>[...c]),means:r.means,a:[...imageData.data],b:[...reference.data]};
      },{a:[...changed.data],b:[...reference.data],region:middle});
      assert.deepEqual(result.maps,region.maps.map(c=>[...c]));assert.deepEqual(result.means,region.means);
      assert.deepEqual(result.a,[...after]);assert.deepEqual(result.b,[...before]);
    });
    await check('each cell vs original; gain/alpha redraw without recompute; pixel colors and unequal dimensions',async page=>{
      await page.locator('#sampleImage').click();await ready(page);await page.locator('button[data-analysis-size="compact"]').click();
      await page.locator('#analysisType').selectOption('difference');await plots(page);
      assert.equal(await page.locator('.analysis-chart').first().getAttribute('data-mean'),'0');
      assert.ok(Number(await page.locator('.analysis-chart').nth(1).getAttribute('data-mean'))>0);
      // Zero-difference map must be black, independently of the canvas matte.
      assert.deepEqual(await page.locator('.analysis-chart').first().evaluate(c=>[...c.getContext('2d').getImageData(Math.floor(c.width/2),Math.floor(c.height/2),1,1).data]),[0,0,0,255]);
      const original=await page.evaluate(()=>{
        const compute=workerCompute,encode=encodeOne;window.diffCalls=0;window.diffEncodes=0;
        workerCompute=(...args)=>{diffCalls++;return compute(...args);};encodeOne=(...args)=>{diffEncodes++;return encode(...args);};
        return {comparison:captureComparison(),batch:JSON.stringify(app.exportConfig),storage:JSON.stringify(Object.fromEntries(Object.entries(localStorage).filter(([key])=>key!=='image-format-viewer.preferences.v1')))};
      });
      await page.locator('#analysisGain').selectOption('64');await page.locator('#analysisDifferenceChannel').selectOption('alpha');
      assert.equal(await page.locator('#analysisMatte').isDisabled(),true);
      assert.equal(await page.evaluate(()=>diffCalls+diffEncodes),0);
      assert.deepEqual(await page.evaluate(()=>captureComparison()),original.comparison);
      assert.equal(await page.evaluate(()=>JSON.stringify(app.exportConfig)),original.batch);assert.equal(await page.evaluate(()=>JSON.stringify(Object.fromEntries(Object.entries(localStorage).filter(([key])=>key!=='image-format-viewer.preferences.v1')))),original.storage);
      await page.locator('#analysisDifferenceChannel').selectOption('rgb');
      await page.locator('.cell .format-select').first().selectOption('jpeg');await ready(page);await plots(page);
      assert.ok(Number(await page.locator('.analysis-chart').first().getAttribute('data-mean'))>0);
      await page.locator('#autoApply').uncheck();await page.locator('.cell .quality').first().fill('1');
      assert.equal(await page.locator('.analysis-chart').first().isVisible(),false);
      await page.locator('#applyAll').click();await ready(page);await plots(page);
      await page.locator('#layout4').click();await ready(page);await plots(page);
      assert.equal(await page.locator('.analysis-chart:visible').count(),4);
      assert.equal(await page.locator('.analysis-chart:visible').evaluateAll(cs=>cs.every(c=>c.dataset.gain==='64')),true);
      await page.locator('.cell .format-select').nth(2).selectOption('ico');await page.locator('#applyAll').click();await ready(page);
      await page.waitForFunction(()=>document.querySelectorAll('.analysis-info')[2].textContent.includes('одинаковых размеров'));
      assert.equal(await page.locator('.analysis-chart').nth(2).isVisible(),false);
    },{deviceScaleFactor:2});
    await check('region draft, cancel, validation, keyboard apply, all graph kinds and source reset',async page=>{
      await page.locator('#sampleImage').click();await ready(page);await page.locator('button[data-analysis-size="compact"]').click();await plots(page,'histogram');
      const original=await page.evaluate(()=>({comparison:captureComparison(),batch:JSON.stringify(app.exportConfig),storage:JSON.stringify(Object.fromEntries(Object.entries(localStorage).filter(([key])=>key!=='image-format-viewer.preferences.v1'))),metrics:app.variants.map(v=>v.metrics)}));
      await edit(page,{X:25,Y:25,Width:50,Height:50});
      assert.equal(await page.evaluate(()=>getAnalysisRegion()),null);
      await page.locator('#analysisRegionCancel').click();assert.equal(await page.evaluate(()=>getAnalysisRegion()),null);
      await edit(page,{X:90,Width:50});await page.locator('#analysisRegionApply').click();
      assert.equal(await page.locator('#analysisRegionEditor').isVisible(),true);assert.ok(await page.locator('#analysisRegionError').textContent());
      await page.locator('#analysisRegionX').fill('25');await page.locator('#analysisRegionY').fill('25');await page.locator('#analysisRegionHeight').fill('50');
      await page.locator('#analysisRegionHeight').press('Enter');await plots(page,'histogram');
      assert.deepEqual(await page.evaluate(()=>getAnalysisRegion()),{x0:250,y0:250,x1:750,y1:750});
      assert.ok((await page.locator('.analysis-chart').first().getAttribute('aria-label')).includes('480×320'));
      for(const kind of ['waveform','parade','difference']){
        await page.locator('#analysisType').selectOption(kind);await plots(page,kind);
        assert.ok((await page.locator('.analysis-chart').first().getAttribute('aria-label')).includes('480×320'));
      }
      assert.deepEqual(await page.evaluate(()=>({comparison:captureComparison(),batch:JSON.stringify(app.exportConfig),storage:JSON.stringify(Object.fromEntries(Object.entries(localStorage).filter(([key])=>key!=='image-format-viewer.preferences.v1'))),metrics:app.variants.map(v=>v.metrics)})),original);
      await page.locator('button[data-analysis-size="max"][aria-pressed]').click();await page.locator('#analysisScope').selectOption('region');await page.keyboard.press('Escape');
      assert.equal(await page.locator('#analysisRegionEditor').isVisible(),false);assert.equal(await page.locator('.stage').getAttribute('data-analysis-size'),'max');
      await page.keyboard.press('Escape');await page.locator('#analysisScope').selectOption('region');await page.locator('#analysisRegionReset').click();await plots(page);
      assert.equal(await page.evaluate(()=>getAnalysisRegion()),null);
      await edit(page,{X:25,Width:50});await page.locator('#analysisRegionApply').click();await plots(page);
      await page.locator('#fileInput').setInputFiles({name:'replacement.svg',mimeType:'image/svg+xml',buffer:Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="12" height="8"><path fill="red" d="M0 0h12v8H0z"/></svg>')});
      await page.locator('.file-select').last().click();await ready(page);await plots(page);
      assert.equal(await page.evaluate(()=>getAnalysisRegion()),null);assert.ok((await page.locator('.analysis-chart').first().getAttribute('aria-label')).includes('12×8'));
    });
    await check('slow old regions cannot poison cache; source changes, errors, close and retry',async page=>{
      await page.locator('#sampleImage').click();await ready(page);
      await page.evaluate(()=>{
        const worker=workerCompute;window.diffActive=0;window.diffMax=0;window.diffFail=false;
        workerCompute=async(kind,payload)=>{
          if(!['histogram','waveform','difference'].includes(kind))return worker(kind,payload);
          diffActive++;diffMax=Math.max(diffMax,diffActive);
          try{await new Promise(r=>setTimeout(r,200));if(diffFail){diffFail=false;throw new Error('Проверочная ошибка карты');}return await worker(kind,payload);}finally{diffActive--;}
        };
      });
      await page.locator('button[data-analysis-size="compact"]').click();await page.locator('#analysisType').selectOption('difference');await page.waitForFunction(()=>diffActive>0);
      await edit(page,{X:25,Y:25,Width:50,Height:50});await page.locator('#analysisRegionApply').click();await plots(page);
      assert.ok((await page.locator('.analysis-chart').first().getAttribute('aria-label')).includes('480×320'));assert.equal(await page.evaluate(()=>diffMax),1);
      await page.locator('#analysisScope').selectOption('region');await page.locator('#analysisRegionReset').click();await page.waitForFunction(()=>diffActive>0);
      await page.locator('#clearFiles').click();await page.waitForFunction(()=>diffActive===0);assert.equal(await page.locator('.analysis-chart').first().isVisible(),false);
      await page.evaluate(()=>{diffFail=true;});await page.locator('#sampleImage').click();await ready(page);
      await page.waitForFunction(()=>document.querySelector('.analysis-info').textContent.includes('Проверочная ошибка'));
      await page.locator('#analysisCollapse').click();await page.locator('button[data-analysis-size="compact"]').click();await plots(page);
      assert.equal(await page.locator('.analysis-chart').first().getAttribute('data-mean'),'0');
    });
    await check('pointer selection, touch cancellation, responsive editor and map screenshots',async page=>{
      await page.locator('#sampleImage').click();await ready(page);await page.locator('button[data-analysis-size="compact"]').click();await page.locator('#analysisType').selectOption('difference');await plots(page);
      await page.locator('.cell .quality').nth(1).fill('10');await ready(page);await plots(page);
      await page.waitForFunction(()=>getComputedStyle(document.getElementById('status')).opacity==='0');
      if(folder){fs.mkdirSync(folder,{recursive:true});await page.screenshot({path:path.join(folder,artifacts.runId+'-difference-desktop.png')});}
      await page.locator('#analysisScope').selectOption('region');
      const box=await page.locator('#analysisRegionCanvas').boundingBox();
      await page.mouse.move(box.x+box.width*0.4,box.y+box.height*0.25);await page.mouse.down();await page.mouse.move(box.x+box.width*0.6,box.y+box.height*0.75,{steps:4});await page.mouse.up();
      assert.equal(await page.evaluate(()=>getAnalysisRegion()),null);
      assert.ok(Number(await page.locator('#analysisRegionWidth').inputValue())<100);
      if(folder)await page.screenshot({path:path.join(folder,artifacts.runId+'-region-desktop.png')});
      await page.locator('#analysisRegionApply').click();await plots(page);
      assert.ok(await page.evaluate(()=>getAnalysisRegion()!==null));
      await page.locator('#analysisScope').selectOption('region');const draft=await page.locator('#analysisRegionWidth').inputValue();
      const point={clientX:box.x+box.width/2,clientY:box.y+box.height/2,pointerId:11,pointerType:'touch',button:0};
      // Synthetic cancellation exercises restoration; real mouse selection above uses capture.
      await page.locator('#analysisRegionCanvas').evaluate(c=>{c.setPointerCapture=()=>{};});
      await page.locator('#analysisRegionCanvas').dispatchEvent('pointerdown',point);
      await page.locator('#analysisRegionCanvas').dispatchEvent('pointermove',{...point,clientX:point.clientX+10});
      await page.locator('#analysisRegionCanvas').dispatchEvent('pointercancel',point);
      assert.equal(await page.locator('#analysisRegionWidth').inputValue(),draft);await page.locator('#analysisRegionCancel').click();
      await page.locator('#layout4').click();await ready(page);await plots(page);
      for(const width of [1080,768,390,320]){
        await page.setViewportSize({width,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
        await page.locator('button[data-analysis-size="max"][aria-pressed]').click();await page.locator('#analysisScope').selectOption('region');
        assert.equal(await page.locator('#analysisPanel').evaluate(d=>d.scrollWidth>d.clientWidth),false);
        if(width===390&&folder)await page.screenshot({path:path.join(folder,artifacts.runId+'-region-mobile.png')});
        await page.keyboard.press('Escape');assert.equal(await page.locator('#analysisRegionEditor').isVisible(),false);
        if(width===390&&folder)await page.screenshot({path:path.join(folder,artifacts.runId+'-difference-mobile.png')});
        await page.keyboard.press('Escape');
      }
    },{hasTouch:true});
  }finally{await browser.close();if(folder){fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(folder,artifacts.runId+'-difference.json'),JSON.stringify({checks,failures},null,2));}}
  process.exitCode=failures?1:0;
})().catch(e=>{console.error(e);process.exitCode=1;});
