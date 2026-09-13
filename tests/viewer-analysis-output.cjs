// Begin collapsed so worker-count fixtures explicitly control when analysis starts.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {pathToFileURL}=require('node:url'),{chromium}=require('playwright');
const artifacts=require('./support/artifacts.cjs'),folder=process.env.IMAGE_TEST_LOGS?artifacts.folder(process.env.IMAGE_TEST_LOGS):null;
const checks=[];let failures=0;
async function ready(page){await page.waitForFunction(()=>app.source&&!app.sourceLoading&&app.variants.slice(0,app.layout).every(isVariantReady));}
async function graph(page,kind,shared=false){await page.waitForFunction(({kind,shared})=>shared?document.getElementById('analysisCombined').dataset.state==='ready'&&document.getElementById('analysisCombinedChart').dataset.kind===kind:[...document.querySelectorAll('.analysis-card')].filter(c=>!c.hidden).every(c=>c.dataset.state==='ready'&&c.querySelector('canvas').dataset.kind===kind),{kind,shared});}
async function start(page,kind='histogram'){await page.locator('#sampleImage').click();await ready(page);await page.locator('button[data-analysis-size="compact"]').click();await page.locator('#analysisType').selectOption(kind);await graph(page,kind,kind==='tradeoff');}
async function download(page,id){const [file]=await Promise.all([page.waitForEvent('download'),page.locator('#'+id).click()]);const chunks=[];for await(const chunk of await file.createReadStream())chunks.push(chunk);return Buffer.concat(chunks);}
async function shot(page,name){if(folder){fs.mkdirSync(folder,{recursive:true});await page.screenshot({path:path.join(folder,artifacts.runId+'-'+name+'.png')});}}
(async()=>{
  const {tradeoffData,analysisMaximum,analysisJSON}=await import('../src/core/analysis-output.mjs');
  const {computeHistogram}=await import('../src/core/histogram.mjs');
  const row=(cell,bytes,value,data={})=>({cell,label:String(cell),data,measurement:{bytes,psnrRGB:value,alphaErrorPercent:0,processingMs:0,width:4,height:1}});
  const model=tradeoffData([row(1,100,Infinity),row(2,50,32),row(3,0,0),row(4,100,null),row(5,100,99,null)],'psnrRGB');
  assert.deepEqual(model.points.map(p=>[p.bytes,p.value]),[[100,Infinity],[50,32],[0,0]]);assert.equal(model.omitted.length,2);assert.equal(model.xMax,108);assert.equal(model.yMax,34.56);assert.equal(model.hasInfinity,true);
  assert.equal(tradeoffData([row(1,100,Infinity)],'psnrRGB').yMax,1.08);
  assert.equal(tradeoffData([row(1,100,1)],'psnrRGB',{width:1,height:4}).points.length,0);
  assert.equal(tradeoffData([row(1,100,1)],'processingMs',{width:1,height:4}).points.length,1);
  assert.throws(()=>tradeoffData([],'unknown'));assert.equal(tradeoffData([row(1,NaN,1),row(2,-1,1),row(3,1,-Infinity)],'psnrRGB').points.length,0);
  const pixel={width:1,height:1,data:new Uint8ClampedArray([255,0,0,255])},hist=computeHistogram(pixel);
  assert.equal(analysisMaximum('histogram',[{data:hist},{data:{...hist,pixelCount:2}}],'r'),100);
  const converted=JSON.parse(analysisJSON({hist,measurement:{psnrRGB:Infinity},missing:null}));assert.ok(Array.isArray(converted.hist.channels[0]));assert.equal(converted.hist.channels[0][255],1);assert.equal(converted.measurement.psnrRGB,'Infinity');assert.equal(converted.missing,null);
  checks.push({name:'metric validity, infinity/zero/missing values, dimensions, shared scale and JSON arrays',passed:true});console.log('PASS '+checks.at(-1).name);
  const url=pathToFileURL(require('./support/viewer-path.cjs')()).href,browser=await chromium.launch({headless:true,executablePath:process.env.IMAGE_TEST_BROWSER||undefined});
  async function check(name,fn,options={}){
    const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true,...options}),page=await context.newPage();
    const errors=[],requests=[];page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/^https?:/.test(r.url()))requests.push(r.url());});
    try{await context.setOffline(true);await page.goto(url);await page.locator('#analysisDisplaySeparate').check();await page.locator('#analysisType').selectOption('profile');await page.locator('#analysisDisplaySeparate').check();await page.locator('#analysisType').selectOption('histogram');await page.locator('#analysisCollapse').click();await fn(page);assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);checks.push({name,passed:true});console.log('PASS '+name);}
    catch(e){failures++;checks.push({name,passed:false,error:e.message});console.error('FAIL '+name+': '+e.stack);}
    finally{await context.close();}
  }
  try{
    await check('scatter uses current measurements, exact match, 2/4, dirty/Apply, sizes and no Worker or encoding',async page=>{
      await start(page);await page.evaluate(()=>{const w=workerCompute,e=encodeOne;window.outputCalls=0;window.outputEncodes=0;workerCompute=(...a)=>{outputCalls++;return w(...a);};encodeOne=(...a)=>{outputEncodes++;return e(...a);};});
      const state=await page.evaluate(()=>({comparison:captureComparison(),batch:app.exportConfig,storage:JSON.stringify(Object.fromEntries(Object.entries(localStorage).filter(([key])=>key!=='image-format-viewer.preferences.v1')))}));
      await page.locator('#analysisType').selectOption('tradeoff');await graph(page,'tradeoff',true);
      let points=JSON.parse(await page.locator('#analysisCombinedChart').getAttribute('data-points'));assert.equal(points[0].value,'Infinity');assert.ok(points[1].value>0);
      for(const m of ['alphaErrorPercent','processingMs','psnrRGB']){await page.locator('#analysisMetric').selectOption(m);points=JSON.parse(await page.locator('#analysisCombinedChart').getAttribute('data-points'));const expected=await page.evaluate(metric=>app.variants.slice(0,2).map(v=>({cell:v.index+1,bytes:v.measurement.bytes,value:v.measurement[metric]===Infinity?'Infinity':v.measurement[metric]})),m);assert.deepEqual(points,expected);}
      assert.equal(await page.evaluate(()=>outputCalls+outputEncodes),0);assert.deepEqual(await page.evaluate(()=>({comparison:captureComparison(),batch:app.exportConfig,storage:JSON.stringify(Object.fromEntries(Object.entries(localStorage).filter(([key])=>key!=='image-format-viewer.preferences.v1')))})),state);
      assert.equal(await page.locator('#analysisScope').isVisible(),false);assert.equal(await page.locator('#analysisMatte').isVisible(),false);
      await page.locator('#layout4').click();await ready(page);await graph(page,'tradeoff',true);assert.equal(JSON.parse(await page.locator('#analysisCombinedChart').getAttribute('data-points')).length,4);
      await page.evaluate(() => holdComparisonRendering());await page.locator('.cell .quality').nth(1).fill('1');
      await page.waitForFunction(()=>JSON.parse(document.getElementById('analysisCombinedChart').dataset.points).every(p=>p.cell!==2));
      const report=JSON.parse((await download(page,'analysisJSON')).toString());assert.equal(report.items[1].measurement,null);assert.equal(report.items[1].data,null);
      await page.evaluate(() => resumeComparisonRendering());await ready(page);await graph(page,'tradeoff',true);assert.equal(JSON.parse(await page.locator('#analysisCombinedChart').getAttribute('data-points')).length,4);
      await page.locator('.cell .format-select').nth(2).selectOption('ico');await ready(page);await graph(page,'tradeoff',true);
      assert.ok((await page.locator('#analysisCombinedInfo').textContent()).includes('Размеры отличаются'));assert.equal(JSON.parse(await page.locator('#analysisCombinedChart').getAttribute('data-points')).length,3);
      await page.locator('#analysisMetric').selectOption('processingMs');assert.equal(JSON.parse(await page.locator('#analysisCombinedChart').getAttribute('data-points')).length,4);
      await page.locator('#clearFiles').click();assert.equal(await page.locator('#analysisPNG').isDisabled(),true);assert.equal(await page.locator('#analysisCombinedChart').isVisible(),false);
    });
    await check('five overlay kinds, pair choices, common scale, no recompute on display/channel/pair, dirty pair and separate map',async page=>{
      await start(page);await page.locator('#layout4').click();await ready(page);await graph(page,'histogram');
      await page.evaluate(()=>{const w=workerCompute,e=encodeOne;window.outputCalls=0;window.outputEncodes=0;workerCompute=(...a)=>{outputCalls++;return w(...a);};encodeOne=(...a)=>{outputEncodes++;return e(...a);};});
      await page.locator('#analysisDisplayOverlay').click();await graph(page,'histogram',true);assert.equal(await page.locator('.analysis-chart:visible').count(),0);
      for(const pair of ['1,3','2,4','1,2'])await page.locator('#analysisPair').selectOption(pair);
      await page.locator('#analysisChannel').selectOption('r');assert.equal(await page.evaluate(()=>outputCalls+outputEncodes),0);
      const expected=await page.evaluate(()=>Math.max(...getAnalysisSnapshot().items.slice(0,2).flatMap(i=>[...i.data.channels[0]].map(n=>n/i.data.pixelCount*100))));
      assert.equal(Number(await page.locator('#analysisCombinedChart').getAttribute('data-y-max')),expected);
      for(const kind of ['waveform','parade','vectorscope','profile','histogram']){await page.locator('#analysisType').selectOption(kind);await page.locator('#analysisDisplayOverlay').click();await graph(page,kind,true);assert.equal(await page.locator('#analysisCombinedLegend span').count(),2);}
      assert.equal(await page.evaluate(()=>outputEncodes),0);
      await page.locator('#analysisPair').selectOption('3,4');await page.locator('#layout2').click();await ready(page);await graph(page,'histogram',true);assert.equal(await page.locator('#analysisPair').inputValue(),'1,2');
      await page.evaluate(() => holdComparisonRendering());await page.locator('.cell .quality').nth(1).fill('7');assert.equal(await page.locator('#analysisCombinedChart').isVisible(),false);assert.equal(await page.locator('#analysisJSON').isDisabled(),true);
      await page.evaluate(() => resumeComparisonRendering());await ready(page);await graph(page,'histogram',true);
      await page.locator('#analysisType').selectOption('difference');await graph(page,'difference');assert.equal(await page.locator('#analysisDisplayField').isVisible(),false);assert.equal(await page.locator('#analysisCombined').isVisible(),false);
    },{deviceScaleFactor:2});
    await check('JSON includes exact arrays, ROI/line/config and infinity; PNG signature/dimensions and screenshots',async page=>{
      await start(page);await page.locator('#analysisScope').selectOption('region');await page.locator('#analysisRegionX').fill('25');await page.locator('#analysisRegionWidth').fill('50');await page.locator('#analysisRegionApply').click();await graph(page,'histogram');
      for(const kind of ['histogram','waveform','parade','difference','vectorscope','profile']){
        await page.locator('#analysisType').selectOption(kind);await graph(page,kind);
        const data=JSON.parse((await download(page,'analysisJSON')).toString());assert.equal(data.settings.type,kind);assert.equal(data.settings.region.x0,250);assert.equal(data.items.length,2);assert.equal(data.items[0].measurement.psnrRGB,'Infinity');assert.equal(data.items[0].config.format,'original');
        assert.equal(data.items[0].data.bounds.width,480);assert.equal('imageData' in data.items[0],false);
        if(kind==='histogram')assert.equal(data.items[0].data.channels[0].reduce((a,b)=>a+b),480*640);
        if(kind==='profile')assert.deepEqual(data.settings.line,{x0:0,y0:500,x1:1000,y1:500});
      }
      await page.locator('#analysisDisplayOverlay').click();await graph(page,'profile',true);
      const blob=await download(page,'analysisPNG');assert.equal(blob.toString('hex',0,8),'89504e470d0a1a0a');assert.equal(blob.readUInt32BE(16),1200);assert.ok(blob.readUInt32BE(20)>400);
      if(folder)fs.writeFileSync(path.join(folder,artifacts.runId+'-export-profile.png'),blob);
      const overlay=JSON.parse((await download(page,'analysisJSON')).toString());assert.equal(overlay.settings.display,'overlay');assert.deepEqual(overlay.settings.pair,[1,2]);
      await page.locator('#analysisScope').selectOption('region');await page.locator('#analysisRegionReset').click();await graph(page,'profile',true);
      await page.waitForFunction(()=>getComputedStyle(document.getElementById('status')).opacity==='0');await shot(page,'overlay-profile-desktop');
      await page.locator('#analysisType').selectOption('vectorscope');await page.locator('#analysisDisplayOverlay').click();await graph(page,'vectorscope',true);await shot(page,'overlay-vectorscope-desktop');
      await page.locator('#analysisType').selectOption('tradeoff');await graph(page,'tradeoff',true);
      const metrics=JSON.parse((await download(page,'analysisJSON')).toString());assert.equal(metrics.settings.region,undefined);assert.equal(metrics.items[0].measurement.psnrRGB,'Infinity');
      await shot(page,'tradeoff-desktop');const png=await download(page,'analysisPNG');if(folder)fs.writeFileSync(path.join(folder,artifacts.runId+'-export-tradeoff.png'),png);
    });
    await check('PNG pending save rejects changed settings/source, failure recovers and slow analysis cannot replace latest view',async page=>{
      await start(page,'profile');
      await page.evaluate(()=>{window.savedAnalysis=[];downloadBlob=(blob,name)=>savedAnalysis.push(name);const original=HTMLCanvasElement.prototype.toBlob;HTMLCanvasElement.prototype.toBlob=function(cb,...args){if(this.width!==1200)return original.call(this,cb,...args);window.releasePNG=()=>original.call(this,cb,...args);};});
      await page.locator('#analysisPNG').click();await page.waitForFunction(()=>typeof releasePNG==='function');await page.locator('#analysisPosition').fill('100');await page.evaluate(()=>releasePNG());await page.waitForFunction(()=>!document.getElementById('analysisPNG').disabled);
      assert.equal(await page.evaluate(()=>savedAnalysis.length),0);assert.ok((await page.locator('#analysisSaveStatus').textContent()).includes('изменился'));
      await page.locator('#analysisPNG').click();await page.locator('#clearFiles').click();await page.evaluate(()=>releasePNG());await page.waitForFunction(()=>document.getElementById('analysisSaveStatus').textContent.includes('изменился'));assert.equal(await page.evaluate(()=>savedAnalysis.length),0);
      await page.locator('#sampleImage').click();await ready(page);await graph(page,'profile');
      await page.evaluate(()=>{HTMLCanvasElement.prototype.toBlob=function(cb){cb(null);};});await page.locator('#analysisPNG').click();await page.waitForFunction(()=>document.getElementById('analysisSaveStatus').textContent.includes('Не удалось'));assert.equal(await page.locator('#analysisPNG').isDisabled(),false);
      await page.evaluate(()=>{const worker=workerCompute;window.scopeKind='';workerCompute=async(kind,payload)=>{scopeKind=kind;await new Promise(r=>setTimeout(r,350));return worker(kind,payload);};});
      await page.locator('#analysisType').selectOption('vectorscope');await page.waitForFunction(()=>scopeKind==='vectorscope');await page.locator('#analysisType').selectOption('tradeoff');await graph(page,'tradeoff',true);assert.equal(await page.locator('.analysis-chart:visible').count(),0);
    });
    await check('responsive 2/4 controls, keyboard dialog and mobile screenshots',async page=>{
      await start(page,'tradeoff');await page.locator('#layout4').click();await ready(page);await graph(page,'tradeoff',true);
      for(const width of [1440,1080,768,390,320]){
        await page.setViewportSize({width,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.locator('button[data-analysis-size="max"][aria-pressed]').click();assert.equal(await page.locator('#analysisPanel').evaluate(d=>d.scrollWidth>d.clientWidth),false);
        if(width===390)await shot(page,'tradeoff-mobile');
        await page.locator('#analysisType').selectOption('histogram');await graph(page,'histogram');await page.locator('#analysisDisplayOverlay').click();await graph(page,'histogram',true);await page.locator('#analysisPair').selectOption('2,4');
        assert.equal(await page.locator('#analysisPanel').evaluate(d=>d.scrollWidth>d.clientWidth),false);if(width===390)await shot(page,'overlay-mobile');
        await page.locator('#analysisHelp').focus();await page.keyboard.press('Enter');assert.equal(await page.locator('#analysisHelpContent').isVisible(),true);await page.keyboard.press('Escape');await page.keyboard.press('Escape');assert.equal(await page.locator('.stage').getAttribute('data-analysis-size'),'compact');
        await page.locator('#analysisDisplaySeparate').click();await page.locator('#analysisType').selectOption('tradeoff');await graph(page,'tradeoff',true);
      }
    },{deviceScaleFactor:2});
  }finally{await browser.close();if(folder){fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(folder,artifacts.runId+'-analysis-output.json'),JSON.stringify({checks,failures},null,2));}}
  process.exitCode=failures?1:0;
})().catch(e=>{console.error(e);process.exitCode=1;});
