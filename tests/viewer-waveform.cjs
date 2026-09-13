// Begin collapsed so worker-count fixtures explicitly control when analysis starts.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');
const artifacts = require('./support/artifacts.cjs');
const folder = process.env.IMAGE_TEST_LOGS ? artifacts.folder(process.env.IMAGE_TEST_LOGS) : null;
const fixture = { width: 3, height: 2, data: new Uint8ClampedArray([
  255,0,0,255, 0,255,0,255, 0,0,255,255,
  17,40,90,0, 255,0,0,128, 0,0,0,255
]) };
const checks = []; let failures = 0;
async function ready(page) {
  await page.waitForFunction(() => app.source && !app.sourceLoading && app.variants.slice(0, app.layout).every(isVariantReady));
}
async function plots(page, kind) {
  await page.waitForFunction(kind => [...document.querySelectorAll('.analysis-card')].filter(c => !c.hidden)
    .every(c => c.dataset.state === 'ready' && c.querySelector('canvas').dataset.kind === kind), kind);
}
(async () => {
  const { computeWaveform } = await import('../src/core/waveform.mjs');
  const before = fixture.data.slice(), white = computeWaveform(fixture), black = computeWaveform(fixture, 'black');
  assert.deepEqual([...white.columnPixels], [2,2,2]);
  const occupied = bins => [...bins].flatMap((count, i) => count ? [[i, count]] : []);
  // Independent known primary levels: red 54, green 182, blue 18; white/black 255/0.
  assert.deepEqual(occupied(white.channels[3]), [[54,1],[255,1],[256+154,1],[256+182,1],[512,1],[512+18,1]]);
  assert.deepEqual(occupied(black.channels[3]), [[0,1],[54,1],[256+27,1],[256+182,1],[512,1],[512+18,1]]);
  assert.deepEqual(occupied(white.channels[0]), [[255,2],[256,1],[256+255,1],[512,2]]);
  assert.deepEqual(fixture.data, before);
  for (const result of [white, black]) for (const bins of result.channels) assert.equal(bins.reduce((a,b)=>a+b),6);
  // Same histogram, different horizontal layout: spatial counts must preserve the order.
  const left = computeWaveform({width:2,height:1,data:new Uint8ClampedArray([0,0,0,255,255,255,255,255])});
  const right = computeWaveform({width:2,height:1,data:new Uint8ClampedArray([255,255,255,255,0,0,0,255])});
  assert.deepEqual(occupied(left.channels[3]), [[0,1],[511,1]]);
  assert.deepEqual(occupied(right.channels[3]), [[255,1],[256,1]]);
  const wide = computeWaveform({width:513,height:2,data:new Uint8ClampedArray(513*2*4).fill(255)});
  assert.equal(wide.columns,256);
  assert.equal(wide.columnPixels[0],6); assert.equal(wide.columnPixels[255],4);
  assert.equal(wide.columnPixels.reduce((a,b)=>a+b),1026);
  for (let x=0;x<256;x++) assert.equal(wide.channels[3][x*256+255]/wide.columnPixels[x],1);
  assert.equal(wide.channels.reduce((n,c)=>n+c.byteLength,0),1048576);
  const tall = computeWaveform({width:1,height:120000,data:new Uint8ClampedArray(120000*4).fill(255)});
  assert.equal(tall.channels[3][255],120000);
  assert.throws(()=>computeWaveform({...fixture,width:4}));
  assert.throws(()=>computeWaveform({...fixture,width:40000001}));
  assert.throws(()=>computeWaveform(fixture,'checker'));
  checks.push({name:'exact spatial counts, luma, alpha composition, column normalization, bounded arrays and validation',passed:true});
  console.log('PASS exact spatial counts, luma, alpha composition, column normalization, bounded arrays and validation');
  const url = pathToFileURL(require('./support/viewer-path.cjs')()).href;
  const browser = await chromium.launch({headless:true,executablePath:process.env.IMAGE_TEST_BROWSER||undefined});
  async function check(name, fn, options={}) {
    const context = await browser.newContext({viewport:{width:1440,height:1000},...options});
    const page = await context.newPage(), errors=[], requests=[]; page.setDefaultTimeout(20000);
    page.on('pageerror',e=>errors.push(e.message)); page.on('request',r=>{if(/^https?:/.test(r.url()))requests.push(r.url());});
    try {
      await context.setOffline(true); await page.goto(url); await page.locator('#analysisDisplaySeparate').click(); await page.locator('#analysisCollapse').click(); await fn(page);
      assert.deepEqual(errors,[]); assert.deepEqual(requests,[]);
      checks.push({name,passed:true}); console.log('PASS '+name);
    } catch(error) { failures++;checks.push({name,passed:false,error:error.message});console.error('FAIL '+name+': '+error.stack); }
    finally {await context.close();}
  }
  try {
    await check('Worker matches independent reference and retains input pixels',async page=>{
      const result = await page.evaluate(async pixels=>{
        const imageData=new ImageData(new Uint8ClampedArray(pixels),3,2);
        const data=await workerCompute('waveform',{imageData,matte:'white'});
        return {channels:data.channels.map(c=>[...c]),columnPixels:[...data.columnPixels],input:[...imageData.data]};
      },[...fixture.data]);
      assert.deepEqual(result.channels,white.channels.map(c=>[...c]));
      assert.deepEqual(result.columnPixels,[2,2,2]); assert.deepEqual(result.input,[...before]);
    });
    await check('types and mattes cache data without encoding; common levels/density and DPR 2',async page=>{
      await page.locator('#sampleImage').click(); await ready(page);
      const original = await page.evaluate(()=>{
        const worker=workerCompute,encode=encodeOne; window.scopeCalls=[];window.scopeEncodes=0;
        workerCompute=(kind,payload)=>{scopeCalls.push(kind+':'+payload.matte);return worker(kind,payload);};
        encodeOne=(...args)=>{scopeEncodes++;return encode(...args);};
        return {comparison:captureComparison(),batch:JSON.stringify(app.exportConfig),storage:JSON.stringify(Object.fromEntries(Object.entries(localStorage).filter(([key])=>key!=='image-format-viewer.preferences.v1'))),pixels:app.source.imageData.data.byteLength};
      });
      await page.locator('button[data-analysis-size="compact"]').click(); await plots(page,'histogram');
      await page.locator('#analysisChannel').selectOption('alpha');
      await page.locator('#analysisType').selectOption('waveform'); await plots(page,'waveform');
      assert.equal(await page.locator('#analysisMatte').isDisabled(),false);
      assert.equal(await page.locator('#analysisChannel').isVisible(),false);
      assert.equal(await page.locator('#analysisLevel').isVisible(),false);
      assert.equal(await page.locator('.analysis-chart:visible').evaluateAll(cs=>new Set(cs.map(c=>c.dataset.densityMax)).size),1);
      assert.equal(await page.locator('.analysis-chart').first().getAttribute('data-y-max'),'255');
      assert.equal(await page.locator('.analysis-chart').first().evaluate(c=>Math.abs(c.width/c.getBoundingClientRect().width-2)<0.01),true);
      assert.equal(await page.evaluate(()=>scopeCalls.length),4);
      await page.locator('#analysisType').selectOption('parade'); await plots(page,'parade');
      assert.equal(await page.evaluate(()=>scopeCalls.length),4);
      await page.locator('#analysisMatte').selectOption('black'); await plots(page,'parade');
      assert.equal(await page.evaluate(()=>scopeCalls.length),6);
      await page.locator('#analysisMatte').selectOption('white'); await plots(page,'parade');
      await page.locator('#analysisType').selectOption('histogram'); await plots(page,'histogram');
      assert.equal(await page.locator('#analysisMatte').isDisabled(),true);
      assert.equal(await page.locator('#analysisLevel').isVisible(),true);
      assert.equal(await page.evaluate(()=>scopeCalls.length),6);
      assert.deepEqual(await page.evaluate(()=>captureComparison()),original.comparison);
      assert.deepEqual(await page.evaluate(()=>({batch:JSON.stringify(app.exportConfig),storage:JSON.stringify(Object.fromEntries(Object.entries(localStorage).filter(([key])=>key!=='image-format-viewer.preferences.v1'))),pixels:app.source.imageData.data.byteLength})),
        {batch:original.batch,storage:original.storage,pixels:original.pixels});
      assert.equal(await page.evaluate(()=>scopeEncodes),0);
    },{deviceScaleFactor:2});
    await check('first cell, quality, Auto/Apply and 2/4 layouts follow current results',async page=>{
      await page.locator('#sampleImage').click();await ready(page);
      await page.locator('button[data-analysis-size="compact"]').click();await page.locator('#analysisType').selectOption('waveform');await plots(page,'waveform');
      const old=await page.locator('.analysis-chart').first().getAttribute('aria-label');
      await page.locator('#autoApply').uncheck();await page.locator('.cell .format-select').first().selectOption('jpeg');
      assert.equal(await page.locator('.analysis-chart').first().isVisible(),false);
      await page.locator('#applyAll').click();await ready(page);await plots(page,'waveform');
      assert.notEqual(await page.locator('.analysis-chart').first().getAttribute('aria-label'),old);
      await page.locator('#autoApply').check();await page.locator('.cell .quality').first().fill('1');await ready(page);await plots(page,'waveform');
      assert.ok((await page.locator('.analysis-chart').first().getAttribute('aria-label')).includes('качество 1.'));
      await page.locator('#layout4').click();await ready(page);await plots(page,'waveform');
      assert.equal(await page.locator('.analysis-card:visible').count(),4);
      await page.locator('#analysisType').selectOption('parade');await plots(page,'parade');
      await page.locator('.cell .format-select').nth(1).selectOption('ico');await ready(page);await plots(page,'parade');
      assert.ok((await page.locator('#analysisStatus').textContent()).includes('Горизонталь нормирована'));
      assert.equal(await page.locator('.analysis-chart:visible').evaluateAll(cs=>new Set(cs.map(c=>c.dataset.densityMax)).size),1);
      await page.locator('#layout2').click();await ready(page);await plots(page,'parade');
      assert.equal(await page.locator('.analysis-card:visible').count(),2);
      assert.equal(await page.locator('.analysis-chart').nth(3).getAttribute('data-density-max'),null);
    });
    await check('slow requests yield to type, matte and source changes; one job at a time; retry and close',async page=>{
      await page.locator('#sampleImage').click();await ready(page);
      await page.evaluate(()=>{
        const worker=workerCompute;window.scopeActive=0;window.scopeMax=0;window.scopeFail=false;
        workerCompute=async(kind,payload)=>{
          if(!['histogram','waveform'].includes(kind))return worker(kind,payload);
          scopeActive++;scopeMax=Math.max(scopeMax,scopeActive);
          try {await new Promise(r=>setTimeout(r,200));if(scopeFail){scopeFail=false;throw new Error('Проверочная ошибка waveform');}return await worker(kind,payload);}
          finally {scopeActive--;}
        };
      });
      await page.locator('button[data-analysis-size="compact"]').click();await page.waitForFunction(()=>scopeActive>0);
      await page.locator('#analysisType').selectOption('waveform');await page.locator('#analysisMatte').selectOption('black');
      await page.locator('#analysisType').selectOption('parade');await plots(page,'parade');
      assert.ok((await page.locator('.analysis-index').first().getAttribute('title')).includes('чёрном'));
      assert.equal(await page.evaluate(()=>scopeMax),1);
      await page.locator('#analysisMatte').selectOption('white');await page.waitForFunction(()=>scopeActive>0);
      await page.locator('#fileInput').setInputFiles({name:'spatial.svg',mimeType:'image/svg+xml',buffer:Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="3" height="2"><path fill="red" d="M0 0h3v2H0z"/></svg>')});
      await page.locator('.file-select').last().click();await ready(page);await plots(page,'parade');
      assert.ok((await page.locator('.analysis-index').first().getAttribute('title')).includes('3×2'));
      await page.evaluate(()=>{scopeFail=true;});await page.locator('#analysisMatte').selectOption('black');
      await page.waitForFunction(()=>document.querySelector('.analysis-info').textContent.includes('Проверочная ошибка'));
      await page.locator('#analysisCollapse').click();await page.locator('button[data-analysis-size="compact"]').click();await plots(page,'parade');
      await page.locator('#clearFiles').click();assert.equal(await page.locator('.analysis-chart').first().isVisible(),false);
      await page.locator('#sampleImage').click();await ready(page);await page.waitForFunction(()=>scopeActive>0);
      await page.locator('#analysisCollapse').click();await page.waitForFunction(()=>scopeActive===0);
      assert.equal(await page.locator('.analysis-chart').first().getAttribute('data-kind'),null);
    });
    await check('desktop and mobile views, four cells, accessible help and Escape; screenshots',async page=>{
      await page.locator('#sampleImage').click();await ready(page);await page.locator('button[data-analysis-size="compact"]').click();
      await page.waitForFunction(()=>getComputedStyle(document.getElementById('status')).opacity==='0');
      for(const kind of ['waveform','parade']){
        await page.locator('#analysisType').selectOption(kind);await plots(page,kind);
        await page.locator('#analysisHelp').click();assert.ok((await page.locator('#analysisMethod').textContent()).includes('0,2126'));
        await page.keyboard.press('Escape');assert.equal(await page.locator('#analysisHelpContent').isVisible(),false);
        if(folder){fs.mkdirSync(folder,{recursive:true});await page.screenshot({path:path.join(folder,artifacts.runId+'-'+kind+'-desktop.png')});}
      }
      await page.locator('#layout4').click();await ready(page);await plots(page,'parade');
      if(folder)await page.screenshot({path:path.join(folder,artifacts.runId+'-parade-four.png')});
      for(const width of [1080,768,390,320]){
        await page.setViewportSize({width,height:900});
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
        await page.locator('button[data-analysis-size="max"][aria-pressed]').click();
        assert.equal(await page.locator('#analysisPanel').evaluate(d=>d.scrollWidth>d.clientWidth),false);
        await page.locator('#analysisHelp').click();await page.keyboard.press('Escape');
        assert.equal(await page.locator('.stage').getAttribute('data-analysis-size'),'max');
        await page.keyboard.press('Escape');assert.equal(await page.locator('button[data-analysis-size="compact"][aria-pressed]').evaluate(b=>b===document.activeElement),true);
        if(width===390&&folder){await page.locator('button[data-analysis-size="max"][aria-pressed]').click();await page.screenshot({path:path.join(folder,artifacts.runId+'-parade-mobile.png')});await page.keyboard.press('Escape');}
      }
    });
  } finally {
    await browser.close();
    if(folder){fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(folder,artifacts.runId+'-waveform.json'),JSON.stringify({checks,failures},null,2));}
  }
  process.exitCode=failures?1:0;
})().catch(error=>{console.error(error);process.exitCode=1;});
