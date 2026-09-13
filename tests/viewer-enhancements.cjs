const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const {pathToFileURL}=require('node:url');
const {chromium}=require('playwright');
const panoramaFixture=require('./support/panorama-fixture.cjs');
const codecProbe=require('./support/codec-probe.cjs');
const artifacts=require('./support/artifacts.cjs');
const url=pathToFileURL(require('./support/viewer-path.cjs')()).href;
let failures=0;
async function ready(page){await page.waitForFunction(()=>app.source&&!app.sourceLoading&&app.variants.filter(v=>!v.cell.classList.contains('hidden')).every(isVariantReady));}
async function preview(page){await page.waitForFunction(()=>isBatchPreviewReady());}
async function sample(page){await page.locator('#sampleImage').click();await ready(page);}
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.IMAGE_TEST_BROWSER||undefined});
 console.log('Chromium '+browser.version());
 async function check(name,fn,options={}){
  const context=await browser.newContext({viewport:{width:1440,height:1000},...options});
  const page=await context.newPage();page.setDefaultTimeout(15000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
  try{
   await context.route('https://**/*',route=>route.abort());await context.setOffline(true);
   await page.goto(url);
   await page.evaluate(()=>{window.saved=[];downloadBlob=(blob,name)=>saved.push({blob,name});});
   await fn(page,context);assert.deepEqual(errors,[]);console.log('PASS '+name);
  }catch(e){failures++;console.error('FAIL '+name+': '+e.stack);}
  finally{await context.close();}
 }
 try{
  for(const dpr of [1,2])await check('100% is one CSS pixel at DPR '+dpr+'; keyboard, zoom and fit',async page=>{
   await sample(page);await page.locator('#zoom100').click();
   assert.equal(await page.evaluate(()=>comparisonScale()),1);
   await page.locator('#zoomIn').click();assert.equal(await page.evaluate(()=>comparisonScale()),1.25);
   await page.locator('#zoomOut').click();assert.equal(await page.evaluate(()=>comparisonScale()),1);
   await page.locator('.cell canvas').first().focus();await page.keyboard.press('ArrowRight');
   assert.equal(await page.evaluate(()=>app.view.centerX),520);
   await page.keyboard.press('0');assert.equal(await page.evaluate(()=>app.view.absoluteScale),null);
   await page.keyboard.press('1');assert.equal(await page.evaluate(()=>comparisonScale()),1);
   await page.locator('#layout4').click();await ready(page);
   const scales=await page.evaluate(()=>app.variants.map(v=>getDrawScale(v.canvas)*v.canvas.getBoundingClientRect().width/v.canvas.width));
   assert.ok(scales.every(v=>Math.abs(v-1)<1e-9));
  },{deviceScaleFactor:dpr});
  await check('metrics remain visible and study dialog fits narrow screens',async page=>{
   await sample(page);
   for(const width of [1080,768,390,320]){
    await page.setViewportSize({width,height:900});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    assert.equal(await page.locator('.cell').first().locator('.metric').nth(3).isVisible(),true);
    assert.equal(await page.locator('.cell').first().locator('.metric').nth(4).isVisible(),true);
    await page.locator('#studyOpen').click();
    assert.equal(await page.locator('#studyDialog').evaluate(el=>el.scrollWidth>el.clientWidth),false);
    await page.keyboard.press('Escape');assert.equal(await page.locator('#studyOpen').evaluate(el=>el===document.activeElement),true);
   }
  });
  await check('reports contain real numbers, protect CSV cells and omit stale metrics',async page=>{
   await sample(page);
   await page.evaluate(()=>{app.source.name='=formula,"name.png';saveComparisonReport('json');saveComparisonReport('csv');});
   const result=await page.evaluate(async()=>({report:JSON.parse(await saved[0].blob.text()),csv:await saved[1].blob.text(),size:app.variants[1].blob.size}));
   assert.equal(result.report.variants[1].metrics.bytes,result.size);
   assert.equal(result.report.variants[0].metrics.psnrRGB,'Infinity');
   assert.ok(result.csv.includes('"\'=formula,""name.png"'));
   assert.ok(result.report.methodology.time.includes('кодировщика'));
   await page.evaluate(() => holdComparisonRendering());await page.evaluate(()=>{app.variants[1].config.quality=20;markDirty(app.variants[1]);});
   assert.equal(await page.evaluate(()=>comparisonReport().variants[1].metrics),null);
   assert.equal(await page.evaluate(()=>comparisonReport().variants[1].config.quality),20);
   await page.evaluate(() => resumeComparisonRendering());await ready(page);
  });
  await check('experiments and named settings persist separately from batch and reload safely',async(page,context)=>{
   await sample(page);const batch=await page.evaluate(()=>({...app.exportConfig}));
   await page.locator('#studyOpen').click();await page.locator('#experimentSelect').selectOption('palette');await page.locator('#experimentApply').click();
   await ready(page);assert.deepEqual(await page.evaluate(()=>({...app.exportConfig})),batch);
   assert.deepEqual(await page.evaluate(()=>app.variants.map(v=>[v.config.format,v.config.gifColors,v.config.gifDither])),[['original',16,true],['gif',16,false],['gif',16,true],['gif',256,true]]);
   await page.locator('#profileName').fill('Палитра');await page.locator('#profileSave').click();
   const state=await page.evaluate(()=>captureComparison());await page.reload();
   assert.equal(await page.evaluate(()=>app.profiles.length),1);assert.equal(await page.evaluate(()=>app.files.length),0);
   await sample(page);await page.locator('#studyOpen').click();await page.locator('#profileApply').click();await ready(page);
   assert.deepEqual(await page.evaluate(()=>captureComparison()),state);
   const stored=await page.evaluate(()=>localStorage.getItem(PROFILE_KEY));assert.equal(stored.includes('sample-alpha'),false);
   const second=await context.newPage();await second.goto(url);assert.equal(await second.evaluate(()=>app.profiles[0].name),'Палитра');
  });
  await check('import validates whole file, handles duplicate names and unavailable formats explicitly',async page=>{
   await page.addInitScript(codecProbe,{failAll:true});await page.reload();
   await page.waitForFunction(()=>document.getElementById('codecStatus').dataset.state==='error');
   await page.locator('#studyOpen').click();
   const profile=await page.evaluate(()=>({name:'Набор',settings:captureComparison()}));
   profile.settings.variants[1].format='pngUpng';
   const file={name:'profiles.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({version:1,profiles:[profile,profile]}))};
   await page.locator('#profileImport').setInputFiles(file);await page.waitForFunction(()=>app.profiles.length===2);
   assert.equal(await page.evaluate(()=>app.profiles[1].name),'Набор (2)');
   await page.locator('#profileApply').click();assert.equal(await page.evaluate(()=>app.variants[1].config.format),'pngUpng');
   assert.ok((await page.locator('#studyNotice').textContent()).includes('кодек'));
   profile.settings.variants[1].quality=999;
   await page.locator('#profileImport').setInputFiles({...file,buffer:Buffer.from(JSON.stringify({version:1,profiles:[profile]}))});
   await page.waitForFunction(()=>document.getElementById('studyNotice').textContent.includes('Некорректные'));
   assert.equal(await page.evaluate(()=>app.profiles.length),2);
  });
  await check('denied and corrupt profile storage preserves a usable session',async page=>{
   await page.evaluate(()=>localStorage.setItem(PROFILE_KEY,'broken'));await page.reload();
   assert.equal(await page.evaluate(()=>app.profiles.length),0);
   await page.evaluate(()=>{Storage.prototype.setItem=()=>{throw new Error('denied');};});
   await page.locator('#studyOpen').click();await page.locator('#profileName').fill('Сеанс');await page.locator('#profileSave').click();
   assert.equal(await page.evaluate(()=>app.profiles.length),1);assert.ok((await page.locator('#studyNotice').textContent()).includes('Хранилище недоступно'));
  });
  await check('selection and retry use only failed files and the original settings',async page=>{
   await sample(page);
   await page.evaluate(async()=>{const source=app.files[0].file;addFiles([new File([source],'second.png',{type:'image/png'}),new File([source],'third.png',{type:'image/png'})]);app.files[2].batchSelected=false;app.exportConfig.format='png';const real=encodeFromSource;let once=true;encodeFromSource=async(...args)=>{if(args[1].name==='second.png'&&once){once=false;throw new Error('temporary');}return real(...args);};await convertAllFiles();});
   assert.deepEqual(await page.evaluate(()=>saved.map(s=>s.name)),['sample-alpha-lines.png']);
   assert.equal(await page.evaluate(()=>app.batchRun.failed),1);
   await page.evaluate(()=>{app.exportConfig.format='jpeg';});await page.locator('#retryBatch').click();await page.waitForFunction(()=>!app.batchRun.running);
   assert.deepEqual(await page.evaluate(()=>saved.map(s=>s.name)),['sample-alpha-lines.png','second.png']);
   assert.equal(await page.evaluate(()=>app.batchRun.config.format),'png');assert.equal(await page.evaluate(()=>app.files.length),3);
  });
  await check('ZIP contains only verified successes with UTF-8 unique names and valid CRC',async page=>{
   await page.evaluate(async()=>{
    const c=document.createElement('canvas');c.width=32;c.height=16;const ctx=c.getContext('2d');ctx.fillStyle='red';ctx.fillRect(0,0,32,16);
    const blob=await new Promise(r=>c.toBlob(r));addFiles([new File([blob],'тест.png',{type:'image/png'}),new File([blob],'ТЕСТ.png',{type:'image/png'}),new File(['bad'],'broken.png',{type:'image/png'})]);
   });await ready(page);
   await page.evaluate(async()=>{app.exportConfig.format='png';app.exportConfig.delivery='zip';await convertAllFiles();});
   assert.equal(await page.evaluate(()=>saved.length),1);assert.equal(await page.evaluate(()=>saved[0].name),'converted-partial.zip');
   const bytes=await page.evaluate(async()=>Array.from(new Uint8Array(await saved[0].blob.arrayBuffer())));
   const python=spawnSync(process.env.IMAGE_TEST_PYTHON||'python',['-c',"import sys,io,zipfile; from PIL import Image; z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())); assert z.testzip() is None; assert len(z.namelist())==2 and len(set(z.namelist()))==2; assert all(Image.open(io.BytesIO(z.read(n))).size==(32,16) for n in z.namelist()); print('ZIP CRC, Unicode names, pixels decoded: OK')"],{input:Buffer.from(bytes),encoding:'utf8'});
   assert.equal(python.status,0,python.stderr);console.log(python.stdout.trim());
   assert.equal(await page.evaluate(()=>app.batchRun.sent),2);
  });
  await check('cancelled ZIP delivers the completed part and releases file references',async page=>{
   await sample(page);await page.evaluate(async()=>{const f=app.files[0].file;addFiles([new File([f],'second.png',{type:'image/png'})]);app.exportConfig.delivery='zip';app.exportConfig.format='png';const real=encodeFromSource;encodeFromSource=async(...args)=>{const result=await real(...args);cancelBatch();return result;};await convertAllFiles();});
   assert.equal(await page.evaluate(()=>saved[0].name),'converted-partial.zip');
   assert.equal(await page.evaluate(()=>app.batchRun.sent),1);assert.equal(await page.evaluate(()=>app.batchRun.cancelled),true);
   assert.ok(await page.evaluate(()=>app.batchRun.entries.every(e=>e.file===null)));
  });
  await check('budget searches actual JPEG bytes without altering the source or stored draft',async page=>{
   await sample(page);const target=await page.evaluate(async()=>{const c={...DEFAULT_EXPORT_CONFIG};const a=await encodeFromSource({...c,quality:40},app.source);const b=await encodeFromSource({...c,quality:85},app.source);return String(Math.floor((a.blob.size+b.blob.size)/2000));});
   await page.locator('#convertAll').click();await page.locator('#batchTargetKB').fill(target);await preview(page);
   assert.ok(await page.evaluate(()=>app.batchPreview.blob.size<=Number(document.getElementById('batchTargetKB').value)*1000));
   assert.ok((await page.locator('#batchPreviewStatus').textContent()).includes('подобрано качество'));
   assert.equal(await page.evaluate(()=>app.exportConfig.targetKB),'');
   assert.equal(await page.evaluate(()=>app.source.width),960);
   await page.locator('#batchTargetKB').fill('1');await page.waitForFunction(()=>document.getElementById('batchPreviewStatus').textContent.includes('Не удалось уложиться'));
   assert.equal(await page.locator('#batchPreviewDownload').isDisabled(),true);
  });
  await check('budget supersession never publishes an older result and caps the number of probes',async page=>{
   await sample(page);
   const result=await page.evaluate(async()=>{
    const real=encodeOne;let active=0,maxActive=0,calls=0;
    encodeOne=async(...args)=>{active++;maxActive=Math.max(maxActive,active);calls++;await new Promise(r=>setTimeout(r,2));try{return await real(...args);}finally{active--;}};
    const encoded=await encodeFromSource({...DEFAULT_EXPORT_CONFIG,targetKB:'1000',minQuality:1,quality:100},app.source);
    let cancelled=false,current=true;const old=encodeFromSource({...DEFAULT_EXPORT_CONFIG,targetKB:'1000',minQuality:1},app.source,()=>current).catch(()=>{cancelled=true;});current=false;await old;
    return {attempts:encoded.attempts,maxActive,cancelled};
   });assert.ok(result.attempts<=21);assert.equal(result.maxActive,1);assert.equal(result.cancelled,true);
  });
  await check('new batch fields persist and budget resize preserves original GPano geometry',async page=>{
   await sample(page);await page.locator('#convertAll').click();await page.locator('#batchDelivery').selectOption('zip');
   await page.locator('#batchTargetKB').fill('100');await page.locator('#batchMinQuality').fill('30');await page.locator('#batchSaveSettings').click();
   await page.reload();assert.deepEqual(await page.evaluate(()=>[app.exportConfig.delivery,app.exportConfig.targetKB,app.exportConfig.minQuality]),['zip','100',30]);
   await page.locator('#fileInput').setInputFiles(await panoramaFixture(page,{partial:true}));await ready(page);
   assert.deepEqual(await page.evaluate(()=>[app.source.width,app.source.height,
    app.source.panorama.FullPanoWidthPixels,app.source.panorama.CroppedAreaLeftPixels]),[1280,640,'2560','256']);
   const result=await page.evaluate(async()=>{
    const old=JSON.stringify(app.source.panorama);
    const encoded=await encodeFromSource({...DEFAULT_EXPORT_CONFIG,resizeWidth:'320',targetKB:'1000'},app.source);
    const metadata=parseJpegPanorama(new Uint8Array(await encoded.blob.arrayBuffer()));
    return {unchanged:JSON.stringify(app.source.panorama)===old,width:encoded.width,height:encoded.height,metadata};
   });assert.equal(result.unchanged,true);assert.equal(result.width,320);assert.equal(result.height,160);
   assert.equal(Number(result.metadata.CroppedAreaImageWidthPixels),320);
   assert.equal(Number(result.metadata.CroppedAreaImageHeightPixels),160);
   assert.equal(Number(result.metadata.FullPanoWidthPixels),640);
   assert.equal(Number(result.metadata.FullPanoHeightPixels),320);
   assert.equal(Number(result.metadata.CroppedAreaLeftPixels),64);
   assert.equal(Number(result.metadata.CroppedAreaTopPixels),32);
  });
  await check('all embedded codecs load with the network disabled; real PNG/GIF/TIFF work',async page=>{
   await page.waitForFunction(()=>document.getElementById('codecStatus').dataset.state==='ready');
   assert.equal(await page.locator('#loadCodecs').count(),0);
   assert.equal(await page.locator('#retryCodecs').isVisible(),false);
   await sample(page);
   for(const format of ['pngUpng','gifenc']){
    await page.evaluate(async format=>{const v=app.variants[1];v.config.format=format;await renderVariant(v);},format);
    assert.equal(await page.evaluate(()=>isVariantReady(app.variants[1])),true);
   }
   const decoded=await page.evaluate(async bytes=>{
    const source=await decodeSourceFile(new File([new Uint8Array(bytes)],'fixture.tiff',{type:'image/tiff'}));
    return {width:source.width,height:source.height,pixel:Array.from(source.imageData.data.slice(0,4))};
   },[...fs.readFileSync(path.join(__dirname,'fixtures/tiff/uncompressed.tiff'))]);assert.deepEqual(decoded,{width:37,height:23,pixel:[0,0,220,255]});
  });
  await check('Worker GIF/BMP bytes match the independently covered core encoders',async page=>{
   await sample(page);
   const results=await page.evaluate(async()=>{
    const output=[];
    for(const format of ['gif','bmp24','bmp32']){
     const config={...DEFAULT_EXPORT_CONFIG,format};const actual=await encodeFromSource(config,app.source);
     const expected=format==='gif'?encodeGif(config.gifColors,config.gifDither,app.source):encodeBmp(format==='bmp32',config.matte,app.source);
     const a=new Uint8Array(await actual.blob.arrayBuffer()),b=new Uint8Array(await expected.blob.arrayBuffer());
     output.push(a.length===b.length&&a.every((v,i)=>v===b[i]));
    }return output;
   });assert.deepEqual(results,[true,true,true]);
  });
  await check('oversized decoded sources release their bitmap before allocating the main buffers',async page=>{
   const result=await page.evaluate(async()=>{
    const real=decodeImageBlobOrOptional;let closed=false,error='';
    decodeImageBlobOrOptional=async()=>({width:10000,height:4001,close:()=>{closed=true;}});
    try{await decodeSourceFile(new File(['fixture'],'large.png'));}catch(e){error=e.message;}finally{decodeImageBlobOrOptional=real;}
    return {closed,error};
   });assert.equal(result.closed,true);assert.ok(result.error.includes('40 мегапикселей'));
  });
  if(process.env.IMAGE_TEST_HEIC) await check('external HEIC fixture decodes through the local codec with no network',async page=>{
   const fixture=path.resolve(process.env.IMAGE_TEST_HEIC);
   assert.ok(!/[\\/]local[\\/]arh(?:[\\/]|$)/i.test(fixture),'user archives are excluded');
   await page.locator('#fileInput').setInputFiles(fixture);await ready(page);
   assert.ok(await page.evaluate(()=>app.source.width>0 && app.source.height>0));
   assert.ok(await page.evaluate(()=>Boolean(app.codecs.heic)));
  });
  if(process.env.IMAGE_TEST_SCREENSHOTS){
   const page=await browser.newPage({viewport:{width:1440,height:1000}});await page.goto(url);await sample(page);await page.locator('#layout4').click();await ready(page);
   const out=artifacts.folder(process.env.IMAGE_TEST_SCREENSHOTS);fs.mkdirSync(out,{recursive:true});
   await page.screenshot({path:path.join(out,artifacts.runId+'-enhanced-desktop.png')});
   await page.setViewportSize({width:390,height:900});await page.screenshot({path:path.join(out,artifacts.runId+'-enhanced-mobile.png'),fullPage:true});
   await page.setViewportSize({width:1440,height:1000});await page.locator('#studyOpen').click();await page.screenshot({path:path.join(out,artifacts.runId+'-experiments.png')});await page.keyboard.press('Escape');
   await page.locator('#convertAll').click();await preview(page);await page.screenshot({path:path.join(out,artifacts.runId+'-budget-dialog.png')});await page.close();
  }
 }finally{await browser.close();}
 process.exitCode=failures?1:0;
})().catch(e=>{console.error(e);process.exitCode=1;});
