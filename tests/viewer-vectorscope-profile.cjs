// Begin collapsed so worker-count fixtures explicitly control when analysis starts.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {pathToFileURL}=require('node:url'),{chromium}=require('playwright');
const artifacts=require('./support/artifacts.cjs');
const folder=process.env.IMAGE_TEST_LOGS?artifacts.folder(process.env.IMAGE_TEST_LOGS):null;
const checks=[];let failures=0;
async function ready(page){await page.waitForFunction(()=>app.source&&!app.sourceLoading&&app.variants.slice(0,app.layout).every(isVariantReady));}
async function plots(page,kind){await page.waitForFunction(kind=>[...document.querySelectorAll('.analysis-card')].filter(c=>!c.hidden).every(c=>c.dataset.state==='ready'&&c.querySelector('canvas').dataset.kind===kind),kind);}
async function start(page,kind){await page.locator('#sampleImage').click();await ready(page);await page.locator('button[data-analysis-size="compact"]').click();await page.locator('#analysisType').selectOption(kind);await plots(page,kind);}
async function fields(page,values){for(const [name,value]of Object.entries(values))await page.locator('#analysisRegion'+name).fill(String(value));}
async function screenshot(page,name){if(folder){fs.mkdirSync(folder,{recursive:true});await page.screenshot({path:path.join(folder,artifacts.runId+'-'+name+'.png')});}}
(async()=>{
  const {computeVectorscope,chromaCoordinates}=await import('../src/core/vectorscope.mjs');
  const {computeLineProfile,profileEndpoints,profileBinAt,DEFAULT_ANALYSIS_LINE}=await import('../src/core/line-profile.mjs');
  const sample={width:4,height:1,data:new Uint8ClampedArray([255,0,0,255,0,255,0,255,0,0,255,255,73,73,73,255])};
  const original=sample.data.slice(),vector=computeVectorscope(sample);
  assert.equal(vector.bins[99],1);assert.equal(vector.bins[244*257+29],1);assert.equal(vector.bins[140*257+256],1);assert.equal(vector.bins[128*257+128],1);
  assert.equal(vector.bins.reduce((a,b)=>a+b),4);assert.ok(Math.abs(vector.meanCb)<1e-15);assert.ok(Math.abs(vector.meanCr)<1e-15);
  assert.deepEqual(chromaCoordinates(73,73,73),{cb:0,cr:0});
  assert.equal(chromaCoordinates(255,0,0).cr,0.5);assert.equal(chromaCoordinates(0,0,255).cb,0.5);
  const roi={x0:250,y0:0,x1:750,y1:1000};assert.equal(computeVectorscope(sample,'white',roi).pixelCount,2);
  const alpha={width:2,height:1,data:new Uint8ClampedArray([255,0,0,128,23,99,141,0])};
  const wp=computeLineProfile(alpha),bp=computeLineProfile(alpha,'black');
  assert.deepEqual(wp.channels.map(c=>[...c.mean]),[[255,255],[127,255],[127,255],[128,0],[154,255]]);
  assert.deepEqual(bp.channels.map(c=>[...c.mean]),[[128,0],[0,0],[0,0],[128,0],[27,0]]);
  for(const matte of ['white','black']){const v=computeVectorscope(alpha,matte);assert.equal(v.bins[128*257+128],1);assert.equal(v.pixelCount,2);}
  const large={width:300,height:300,data:new Uint8ClampedArray(300*300*4).fill(255)};assert.equal(computeVectorscope(large).bins[128*257+128],90000);
  const grid={width:4,height:3,data:new Uint8ClampedArray(Array.from({length:12},(_,i)=>[i,i*2,i*3,255]).flat())};
  assert.deepEqual([...computeLineProfile(grid).channels[0].mean],[4,5,6,7]);
  assert.deepEqual([...computeLineProfile(grid,'white',null,{x0:500,y0:0,x1:500,y1:1000}).channels[0].mean],[2,6,10]);
  assert.deepEqual([...computeLineProfile(grid,'white',null,{x0:0,y0:0,x1:1000,y1:1000}).channels[0].mean],[0,5,6,11]);
  assert.deepEqual([...computeLineProfile(grid,'white',null,{x0:1000,y0:1000,x1:0,y1:0}).channels[0].mean],[11,6,5,0]);
  assert.deepEqual(profileEndpoints(grid,roi).points,{x0:1,y0:1,x1:2,y1:1});
  assert.deepEqual([...computeLineProfile(grid,'white',roi).channels[0].mean],[5,6]);
  assert.deepEqual([...computeLineProfile(grid,'white',null,{x0:500,y0:500,x1:500,y1:500}).channels[0].mean],[6]);
  assert.equal(computeLineProfile({width:1,height:1,data:new Uint8ClampedArray([1,2,3,255])}).sampleCount,1);
  const peak={width:2049,height:1,data:new Uint8ClampedArray(2049*4)};
  for(let i=0;i<2049;i++)peak.data[i*4+3]=255;peak.data[1024*4]=255;
  const grouped=computeLineProfile(peak);assert.equal(grouped.bins,1024);assert.equal(grouped.counts.reduce((a,b)=>a+b),2049);
  assert.equal(grouped.channels[0].max[511],255);assert.equal(grouped.channels[0].min[511],0);assert.equal(grouped.channels[0].mean[511],127.5);
  assert.equal(profileBinAt(grouped,0),0);assert.equal(profileBinAt(grouped,1000),1023);assert.equal(profileBinAt(grouped,500),511);
  for(const fn of [computeVectorscope,computeLineProfile]){
    assert.throws(()=>fn(sample,'checker'));assert.throws(()=>fn(sample,'white',{...roi,x0:999}));assert.throws(()=>fn({...sample,data:new Uint8Array(2)}));
  }
  for(const line of [{...DEFAULT_ANALYSIS_LINE,x0:-1},{...DEFAULT_ANALYSIS_LINE,x1:1001},{...DEFAULT_ANALYSIS_LINE,y0:1.5},null])assert.throws(()=>computeLineProfile(sample,'white',null,line));
  assert.deepEqual(sample.data,original);
  checks.push({name:'known Cb/Cr coordinates, neutral/alpha/ROI, 32-bit density, line directions/point/grouped peak and input validation',passed:true});
  console.log('PASS '+checks.at(-1).name);
  const url=pathToFileURL(require('./support/viewer-path.cjs')()).href;
  const browser=await chromium.launch({headless:true,executablePath:process.env.IMAGE_TEST_BROWSER||undefined});
  async function check(name,fn,options={}){
    const context=await browser.newContext({viewport:{width:1440,height:1000},...options}),page=await context.newPage();
    const errors=[],requests=[];page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/^https?:/.test(r.url()))requests.push(r.url());});
    try{await context.setOffline(true);await page.goto(url);await page.locator('#analysisDisplaySeparate').check();await page.locator('#analysisType').selectOption('profile');await page.locator('#analysisDisplaySeparate').check();await page.locator('#analysisType').selectOption('histogram');await page.locator('#analysisCollapse').click();await fn(page);assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);checks.push({name,passed:true});console.log('PASS '+name);}
    catch(e){failures++;checks.push({name,passed:false,error:e.message});console.error('FAIL '+name+': '+e.stack);}
    finally{await context.close();}
  }
  try{
    await check('both Worker operations match core and preserve source buffers',async page=>{
      const data=await page.evaluate(async bytes=>{
        const imageData=new ImageData(new Uint8ClampedArray(bytes),4,1),v=await workerCompute('vectorscope',{imageData,matte:'white'}),p=await workerCompute('profile',{imageData,matte:'white'});
        return {bins:[...v.bins],channels:p.channels.map(c=>[...c.mean]),bytes:[...imageData.data]};
      },[...sample.data]);
      assert.deepEqual(data.bins,[...vector.bins]);assert.deepEqual(data.channels,computeLineProfile(sample).channels.map(c=>[...c.mean]));assert.deepEqual(data.bytes,[...original]);
    });
    await check('current cells including first, automatic quality, shared density and axes, mixed dimensions',async page=>{
      await start(page,'vectorscope');
      assert.equal(await page.locator('.analysis-chart:visible').evaluateAll(cs=>cs.every(c=>c.dataset.yMax==='0.5')&&new Set(cs.map(c=>c.dataset.densityMax)).size===1),true);
      const before=await page.locator('.analysis-chart').first().evaluate(c=>c.toDataURL());
      await page.locator('.cell .format-select').first().selectOption('jpeg');await ready(page);await plots(page,'vectorscope');
      await page.evaluate(() => holdComparisonRendering());await page.locator('.cell .quality').first().fill('1');assert.equal(await page.locator('.analysis-chart').first().isVisible(),false);
      await page.evaluate(() => resumeComparisonRendering());await ready(page);await plots(page,'vectorscope');
      assert.notEqual(await page.locator('.analysis-chart').first().evaluate(c=>c.toDataURL()),before);
      await page.locator('#layout4').click();await ready(page);await plots(page,'vectorscope');assert.equal(await page.locator('.analysis-chart:visible').count(),4);
      await page.locator('.cell .format-select').nth(2).selectOption('ico');await ready(page);await plots(page,'vectorscope');
      assert.ok((await page.locator('#analysisStatus').textContent()).includes('Размеры различаются'));
      assert.equal(await page.locator('.analysis-chart:visible').evaluateAll(cs=>new Set(cs.map(c=>c.dataset.densityMax)).size===1),true);
      await page.locator('#analysisType').selectOption('profile');await plots(page,'profile');
      assert.equal(await page.locator('.analysis-chart:visible').evaluateAll(cs=>cs.every(c=>c.dataset.yMax==='255')),true);
      assert.ok((await page.locator('#analysisStatus').textContent()).includes('число отсчётов различаются'));
      assert.notEqual(await page.locator('.analysis-chart').nth(0).getAttribute('data-profile-samples'),await page.locator('.analysis-chart').nth(2).getAttribute('data-profile-samples'));
    },{deviceScaleFactor:2});
    await check('line draft/cancel/validation/keyboard/presets, ROI, channel and cursor without encoding or state changes',async page=>{
      await start(page,'profile');const original=await page.evaluate(()=>({comparison:captureComparison(),batch:JSON.stringify(app.exportConfig),storage:JSON.stringify(Object.fromEntries(Object.entries(localStorage).filter(([key])=>key!=='image-format-viewer.preferences.v1'))),metrics:app.variants.map(v=>v.metrics)}));
      await page.locator('#analysisLineOpen').click();await fields(page,{X:100,Y:100,Width:0,Height:0});
      assert.deepEqual(await page.evaluate(()=>getAnalysisLine()),DEFAULT_ANALYSIS_LINE);
      await page.locator('#analysisRegionCancel').click();assert.deepEqual(await page.evaluate(()=>getAnalysisLine()),DEFAULT_ANALYSIS_LINE);
      await page.locator('#analysisLineOpen').click();await fields(page,{X:101});await page.locator('#analysisRegionApply').click();assert.equal(await page.locator('#analysisRegionEditor').isVisible(),true);
      assert.ok(await page.locator('#analysisRegionError').textContent());
      await page.locator('[data-line-preset="vertical"]').click();await page.locator('#analysisRegionHeight').press('Enter');await plots(page,'profile');
      assert.deepEqual(await page.evaluate(()=>getAnalysisLine()),{x0:500,y0:0,x1:500,y1:1000});assert.equal(await page.locator('.analysis-chart').first().getAttribute('data-profile-samples'),'640');
      await page.locator('#analysisScope').selectOption('region');await fields(page,{X:25,Y:25,Width:50,Height:50});await page.locator('#analysisRegionApply').click();await plots(page,'profile');
      assert.equal(await page.locator('.analysis-chart').first().getAttribute('data-profile-samples'),'320');
      assert.ok((await page.locator('.analysis-chart').first().getAttribute('aria-label')).includes('A (480, 160) → B (480, 479)'));
      await page.evaluate(()=>{const worker=workerCompute,encode=encodeOne;window.scopeCalls=0;window.scopeEncodes=0;workerCompute=(...args)=>{scopeCalls++;return worker(...args);};encodeOne=(...args)=>{scopeEncodes++;return encode(...args);};});
      for(const channel of ['r','g','b','y','alpha','rgb']){await page.locator('#analysisProfileChannel').selectOption(channel);assert.equal(await page.locator('#analysisMatte').isDisabled(),channel==='alpha');}
      await page.locator('#analysisPosition').fill('1000');assert.equal(await page.locator('#analysisPositionValue').textContent(),'100%');
      assert.equal(await page.evaluate(()=>scopeCalls+scopeEncodes),0);
      assert.deepEqual(await page.evaluate(()=>({comparison:captureComparison(),batch:JSON.stringify(app.exportConfig),storage:JSON.stringify(Object.fromEntries(Object.entries(localStorage).filter(([key])=>key!=='image-format-viewer.preferences.v1'))),metrics:app.variants.map(v=>v.metrics)})),original);
      await page.locator('#analysisType').selectOption('vectorscope');await plots(page,'vectorscope');assert.ok((await page.locator('.analysis-chart').first().getAttribute('aria-label')).includes('480×320'));
      assert.equal(await page.locator('#analysisLineOpen').isVisible(),false);
      await page.locator('#analysisType').selectOption('profile');await plots(page,'profile');await page.locator('#analysisLineOpen').click();await page.locator('#analysisRegionReset').click();await plots(page,'profile');
      assert.deepEqual(await page.evaluate(()=>getAnalysisLine()),DEFAULT_ANALYSIS_LINE);
      await page.locator('#fileInput').setInputFiles({name:'one.svg',mimeType:'image/svg+xml',buffer:Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><path fill="red" d="M0 0h1v1H0z"/></svg>')});
      await page.locator('.file-select').last().click();await ready(page);await plots(page,'profile');
      assert.equal(await page.evaluate(()=>getAnalysisRegion()),null);assert.deepEqual(await page.evaluate(()=>getAnalysisLine()),DEFAULT_ANALYSIS_LINE);assert.equal(await page.locator('.analysis-chart').first().getAttribute('data-profile-samples'),'1');
      assert.ok((await page.locator('.analysis-values').first().textContent()).includes('R 255'));
    });
    await check('stale line/type/matte/source requests, sequential Worker, failure retry and close',async page=>{
      await page.locator('#sampleImage').click();await ready(page);
      await page.evaluate(()=>{const worker=workerCompute;window.scopeActive=0;window.scopeMax=0;window.scopeFail=false;workerCompute=async(kind,payload)=>{
        if(!['histogram','profile','vectorscope'].includes(kind))return worker(kind,payload);scopeActive++;scopeMax=Math.max(scopeMax,scopeActive);
        try{await new Promise(r=>setTimeout(r,250));if(scopeFail){scopeFail=false;throw new Error('Проверочная ошибка профиля');}return await worker(kind,payload);}finally{scopeActive--;}
      };});
      await page.locator('button[data-analysis-size="compact"]').click();await page.locator('#analysisType').selectOption('profile');await page.waitForFunction(()=>scopeActive>0);
      await page.locator('#analysisLineOpen').click();await page.locator('[data-line-preset="vertical"]').click();await page.locator('#analysisRegionApply').click();await plots(page,'profile');
      assert.equal(await page.locator('.analysis-chart').first().getAttribute('data-profile-samples'),'640');
      await page.locator('#analysisMatte').selectOption('black');await page.locator('#analysisType').selectOption('vectorscope');await plots(page,'vectorscope');
      assert.ok((await page.locator('.analysis-chart').first().getAttribute('aria-label')).includes('на чёрном'));assert.equal(await page.evaluate(()=>scopeMax),1);
      await page.locator('#analysisType').selectOption('profile');await page.waitForFunction(()=>scopeActive>0);await page.locator('#clearFiles').click();await page.waitForFunction(()=>scopeActive===0);assert.equal(await page.locator('.analysis-chart').first().isVisible(),false);
      await page.evaluate(()=>{scopeFail=true;});await page.locator('#sampleImage').click();await ready(page);await page.waitForFunction(()=>document.querySelector('.analysis-info').textContent.includes('Проверочная ошибка'));
      await page.locator('#analysisCollapse').click();await page.locator('button[data-analysis-size="compact"]').click();await plots(page,'profile');assert.equal(await page.locator('.analysis-chart').first().getAttribute('data-profile-samples'),'960');
    });
    await check('mouse reverse line, cancelled touch, expanded keyboard editor and responsive scopes',async page=>{
      await start(page,'vectorscope');await page.waitForFunction(()=>getComputedStyle(document.getElementById('status')).opacity==='0');await screenshot(page,'vectorscope-desktop');
      await page.locator('#analysisType').selectOption('profile');await plots(page,'profile');await screenshot(page,'profile-desktop');
      await page.locator('#analysisLineOpen').click();
      const lineCanvas=page.locator('#analysisRegionCanvas');
      // Opening the editor focuses its fields and may scroll the analysis panel.
      // page.mouse uses viewport coordinates and does not scroll clipped canvases.
      await lineCanvas.scrollIntoViewIfNeeded();
      const box=await lineCanvas.boundingBox();assert.ok(box&&box.width>0&&box.height>0);
      assert.equal(await lineCanvas.evaluate((canvas,point)=>document.elementFromPoint(point.x,point.y)===canvas,{x:box.x+box.width*.6,y:box.y+box.height*.7}),true,'reverse drag must start on the visible editor canvas');
      await page.mouse.move(box.x+box.width*.6,box.y+box.height*.7);await page.mouse.down();await page.mouse.move(box.x+box.width*.4,box.y+box.height*.3,{steps:4});await page.mouse.up();
      assert.ok(Number(await page.locator('#analysisRegionX').inputValue())>Number(await page.locator('#analysisRegionWidth').inputValue()));await screenshot(page,'line-desktop');
      const draft=await page.locator('#analysisRegionX').inputValue(),point={clientX:box.x+box.width/2,clientY:box.y+box.height/2,pointerId:11,pointerType:'touch',button:0};
      await page.locator('#analysisRegionCanvas').evaluate(c=>{c.setPointerCapture=()=>{};});await page.locator('#analysisRegionCanvas').dispatchEvent('pointerdown',point);await page.locator('#analysisRegionCanvas').dispatchEvent('pointermove',{...point,clientX:point.clientX+10});await page.locator('#analysisRegionCanvas').dispatchEvent('pointercancel',point);
      assert.equal(await page.locator('#analysisRegionX').inputValue(),draft);await page.locator('#analysisRegionApply').click();await plots(page,'profile');
      assert.ok(await page.evaluate(()=>getAnalysisLine().x0>getAnalysisLine().x1));
      await page.locator('#layout4').click();await ready(page);await plots(page,'profile');
      for(const width of [1440,1080,768,390,320]){
        await page.setViewportSize({width,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
        const stage=page.locator('.stage'),maxButton=page.locator('button[data-analysis-size="max"][aria-pressed]');
        // Max toggles back to the previous size when it is already selected.
        if(await maxButton.getAttribute('aria-pressed')!=='true')await maxButton.click();
        assert.equal(await stage.getAttribute('data-analysis-size'),'max',`${width}px: maximum before opening the editor`);
        await page.locator('#analysisLineOpen').click();
        assert.equal(await page.locator('#analysisRegionEditor').isVisible(),true,`${width}px: line editor opened`);
        assert.equal(await stage.getAttribute('data-analysis-size'),'max',`${width}px: opening the editor preserves maximum`);
        assert.equal(await page.evaluate(()=>document.activeElement?.id),'analysisRegionX',`${width}px: editor focuses its first field`);
        assert.equal(await page.locator('#analysisPanel').evaluate(d=>d.scrollWidth>d.clientWidth),false);
        if(width===390)await screenshot(page,'line-mobile');
        await page.locator('#analysisRegionX').press('Escape');
        assert.equal(await page.locator('#analysisRegionEditor').isVisible(),false,`${width}px: Escape closes the editor`);
        assert.equal(await stage.getAttribute('data-analysis-size'),'max',`${width}px: editor Escape preserves maximum`);
        assert.equal(await page.evaluate(()=>document.activeElement?.id),'analysisLineOpen',`${width}px: editor Escape restores focus`);
        if(width===390)await screenshot(page,'profile-mobile');await page.locator('#analysisType').selectOption('vectorscope');await plots(page,'vectorscope');if(width===390)await screenshot(page,'vectorscope-mobile');
        await page.locator('#analysisType').selectOption('profile');await plots(page,'profile');
        // Switching graph types hides the previously focused line button.
        // Address panel Escape explicitly instead of relying on the remaining focus.
        await page.locator('#analysisLineOpen').press('Escape');
        assert.equal(await stage.getAttribute('data-analysis-size'),'compact',`${width}px: panel Escape restores compact size`);
      }
      await page.locator('#analysisLineOpen').click();await page.locator('#analysisType').selectOption('histogram');await plots(page,'histogram');assert.equal(await page.locator('#analysisRegionEditor').isVisible(),false);
    },{hasTouch:true,deviceScaleFactor:2});
  }finally{await browser.close();if(folder){fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(folder,artifacts.runId+'-vectorscope-profile.json'),JSON.stringify({checks,failures},null,2));}}
  process.exitCode=failures?1:0;
})().catch(e=>{console.error(e);process.exitCode=1;});
