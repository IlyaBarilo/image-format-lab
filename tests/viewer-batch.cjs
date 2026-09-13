const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');
const panoramaFixture = require('./support/panorama-fixture.cjs');

const url = pathToFileURL(require('./support/viewer-path.cjs')()).href;
let failures = 0;
async function ready(page) {
  await page.waitForFunction(() => app.source && !app.sourceLoading &&
    app.variants.filter(v => !v.cell.classList.contains('hidden')).every(isVariantReady));
}
async function settings(page, {format='jpeg', width='', height='', metadata='panorama'} = {}) {
  await page.locator('#convertAll').click();
  await page.locator('#batchFormat').selectOption(format);
  await page.locator('#batchResizeMode').selectOption(width || height ? 'limit' : 'original');
  if(width || height) {
    await page.locator('#batchDialogWidth').fill(width);
    await page.locator('#batchDialogHeight').fill(height);
  }
  await page.locator('#batchAdvanced').evaluate(el=>el.open=true);
  await page.locator('#batchMetadata').selectOption(metadata);
  await page.locator('#batchSaveSettings').click();
  await page.locator('#batchDialogCancel').click();
}
async function startBatch(page) { await page.locator('#convertAll').click(); await page.locator('#batchStart').click(); }
async function batch(page) {
  await startBatch(page);
  await page.waitForFunction(() => app.batchRun && !app.batchRun.running);
  await page.evaluate(()=>Promise.all(downloadChecks));
}

(async () => {
  const browser = await chromium.launch({headless:true,
    ...(process.env.IMAGE_TEST_BROWSER ? {executablePath:process.env.IMAGE_TEST_BROWSER} : {})});
  console.log('Chromium '+browser.version());
  try {
    const fixturePage=await browser.newPage();
    const bytes=await fixturePage.evaluate(()=>[[240,120],[120,240],[20,10]].map(([w,h])=>{
      const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;
      const ctx=canvas.getContext('2d');ctx.fillStyle='#086f9e';ctx.fillRect(0,0,w/2,h);
      return canvas.toDataURL().split(',')[1];
    }));
    await fixturePage.close();
    const files=bytes.map((buffer,i)=>({name:['wide.png','tall.png','small.png'][i],mimeType:'image/png',buffer:Buffer.from(buffer,'base64')}));

    async function check(name,run) {
      const page=await browser.newPage({viewport:{width:1440,height:1000},acceptDownloads:false});
      page.setDefaultTimeout(10000);
      const errors=[];page.on('pageerror',error=>errors.push(error.message));
      try {
        await page.goto(url);
        await page.evaluate(()=>{
          window.downloads=[];window.downloadChecks=[];
          HTMLAnchorElement.prototype.click=function(){
            const name=this.download,href=this.href;
            downloadChecks.push((async()=>{
              const blob=await fetch(href).then(r=>r.blob());const decoded=await decodeImageBlob(blob);
              try {downloads.push({name,type:blob.type,width:decoded.width,height:decoded.height});}
              finally {decoded.close?.();}
            })());
          };
        });
        await run(page);
        await page.evaluate(()=>Promise.all(downloadChecks));
        assert.deepEqual(errors,[]);
        console.log('PASS '+name);
      } catch(error) {failures++;console.error('FAIL '+name+': '+error.stack);}
      finally {await page.close();}
    }

    await check('PNG batch resizes every list item without upscaling or changing the selected source',async page=>{
      await page.locator('#fileInput').setInputFiles(files);await ready(page);
      await settings(page,{format:'png',width:'100',height:'100'});
      await batch(page);
      assert.deepEqual(await page.evaluate(()=>downloads.map(d=>[d.name,d.width,d.height])),
        [['wide.png',100,50],['tall.png',50,100],['small.png',20,10]]);
      assert.equal(await page.evaluate(()=>app.source.name),'wide.png');
      assert.match(await page.locator('#batchSummary').textContent(),/Передано браузеру: 3; ошибок: 0/);
    });

    await check('built-in formats share the resized encoding path with the dialog preview',async page=>{
      await page.locator('#fileInput').setInputFiles(files[0]);await ready(page);
      for(const [format,mime] of [['jpeg','image/jpeg'],['png','image/png'],['gif','image/gif'],['bmp24','image/bmp'],['bmp32','image/bmp'],['webp','image/webp']]) {
        if(format==='webp'&&!await page.evaluate(()=>app.support.get('image/webp')))continue;
        await settings(page,{format,height:'30'});
        await page.locator('#convertAll').click();
        await page.waitForFunction(()=>isBatchPreviewReady());
        assert.deepEqual(await page.evaluate(()=>[app.batchPreview.width,app.batchPreview.height]),[60,30]);
        await page.locator('#batchStart').click();
        await page.waitForFunction(()=>app.batchRun&&!app.batchRun.running);
        await page.evaluate(()=>Promise.all(downloadChecks));
        const output=await page.evaluate(()=>downloads.at(-1));
        assert.equal(output.type,mime);assert.equal(output.width,60);assert.equal(output.height,30);
      }
    });

    await check('running batch freezes settings and allows independent source and comparison changes',async page=>{
      await page.locator('#fileInput').setInputFiles(files);await ready(page);
      await settings(page,{format:'png',width:'60'});
      await page.evaluate(()=>{
        const real=encodeFromSource;window.batchCalls=[];
        encodeFromSource=async(config,source)=>{
          if(config===app.batchRun?.config) {
            batchCalls.push({name:source.name,format:config.format,width:config.resizeWidth,frozen:Object.isFrozen(config)});
            if(batchCalls.length===1)await new Promise(resolve=>{window.releaseBatch=resolve;});
          }
          return real(config,source);
        };
      });
      await startBatch(page);await page.waitForFunction(()=>Boolean(window.releaseBatch));
      assert.equal(await page.locator('#fileInput').isDisabled(),true);
      assert.equal(await page.locator('#clearFiles').isDisabled(),true);
      assert.equal(await page.locator('.file-remove').first().isDisabled(),true);
      const stable=await page.evaluate(async()=>{
        const run=app.batchRun;clearFiles();removeFile(app.files[0].id);await convertAllFiles();
        Object.assign(app.exportConfig,{format:'bmp32',resizeWidth:'44',metadataPolicy:'none'});
        return app.files.length===3&&app.batchRun===run;
      });
      assert.equal(stable,true);
      await page.locator('.file-select').nth(1).click();await ready(page);
      await page.locator('#layout4').click();
      await page.locator('.format-select').nth(1).selectOption('gif');
      await page.locator('#metadataPolicy').selectOption('none');await ready(page);
      assert.equal(await page.locator('#cancelBatch').isVisible(),true);
      await page.evaluate(()=>releaseBatch());await page.waitForFunction(()=>!app.batchRun.running);
      assert.deepEqual(await page.evaluate(()=>batchCalls),files.map(f=>({name:f.name,format:'png',width:'60',frozen:true})));
      assert.equal(await page.evaluate(()=>app.source.name),'tall.png');
      assert.equal(await page.evaluate(()=>app.variants[1].resultConfig.format),'gif');
      assert.equal(await page.locator('#fileInput').isDisabled(),false);
    });

    await check('cancel finishes the current file, releases remaining references and allows another run',async page=>{
      await page.locator('#fileInput').setInputFiles(files);await ready(page);
      await page.evaluate(()=>{
        const real=decodeSourceFile;let once=true;
        decodeSourceFile=async file=>{const source=await real(file);if(app.batchRun?.running&&once){once=false;await new Promise(resolve=>{window.finishCurrent=resolve;});}return source;};
      });
      await startBatch(page);await page.waitForFunction(()=>Boolean(window.finishCurrent));
      await page.locator('#cancelBatch').click();
      assert.match(await page.locator('#batchSummary').textContent(),/Остановка после текущего файла/);
      await page.evaluate(()=>finishCurrent());await page.waitForFunction(()=>!app.batchRun.running);
      assert.deepEqual(await page.evaluate(()=>({statuses:app.batchRun.entries.map(e=>e.status),cancelled:app.batchRun.cancelled,
        completed:app.batchRun.completed,filesReleased:app.batchRun.entries.every(e=>e.file===null)})),
        {statuses:['sent','skipped','skipped'],cancelled:true,completed:1,filesReleased:true});
      await batch(page);assert.equal(await page.evaluate(()=>app.batchRun.sent),3);
    });

    await check('source and output failures are reported while later files continue',async page=>{
      const corrupt={name:'broken.png',mimeType:'image/png',buffer:Buffer.from('broken')};
      await page.locator('#fileInput').setInputFiles([files[0],corrupt,files[1]]);await ready(page);
      await page.evaluate(()=>{
        const real=encodeFromSource;
        encodeFromSource=async(config,source)=>config===app.batchRun?.config&&source.name==='wide.png'
          ? {blob:new Blob(['bad output'],{type:'image/jpeg'}),width:240,height:120}:real(config,source);
      });
      await batch(page);
      assert.deepEqual(await page.evaluate(()=>({sent:app.batchRun.sent,failed:app.batchRun.failed,states:app.batchRun.entries.map(e=>e.status),source:app.source.name})),
        {sent:1,failed:2,states:['error','error','sent'],source:'wide.png'});
      await page.locator('#batchReport summary').click();
      assert.equal(await page.locator('#batchResults .error').count(),2);
      assert.match(await page.locator('#batchResults').textContent(),/broken.png/);
      assert.deepEqual(await page.evaluate(()=>downloads.map(d=>d.name)),['tall.jpg']);
    });

    await check('duplicate names get distinct outputs and filenames remain safe text',async page=>{
      const names=['photo.png','photo.webp','PHOTO.PNG','<img src=x onerror=alert(1)>.png'];
      await page.locator('#fileInput').setInputFiles(names.map(name=>({...files[0],name})));await ready(page);
      await batch(page);
      const outputs=await page.evaluate(()=>downloads.map(d=>d.name));
      assert.deepEqual(outputs.slice(0,3),['photo.jpg','photo (2).jpg','PHOTO (3).jpg']);
      assert.equal(new Set(outputs.map(s=>s.toLowerCase())).size,4);
      assert.equal(await page.locator('#batchResults img').count(),0);
      assert.equal(/[<>]/.test(outputs[3]),false);
    });

    await check('download errors do not stop the queue and owned URLs are released',async page=>{
      await page.locator('#fileInput').setInputFiles(files);await ready(page);
      await page.evaluate(()=>{
        const real=triggerDownload,timeout=setTimeout,revoke=URL.revokeObjectURL;
        window.releases=[];window.revoked=[];window.batchUrls=[];
        setTimeout=(fn,ms,...args)=>{if(ms===4000){releases.push(()=>fn(...args));return 0;}return timeout(fn,ms,...args);};
        URL.revokeObjectURL=url=>{revoked.push(url);revoke.call(URL,url);};
        triggerDownload=(url,name)=>{batchUrls.push(url);if(batchUrls.length===1)throw new Error('simulated download failure');return real(url,name);};
      });
      await batch(page);
      const result=await page.evaluate(()=>{
        const firstReleased=revoked.includes(batchUrls[0]);for(const release of releases)release();
        return {firstReleased,allReleased:batchUrls.every(url=>revoked.includes(url)),sent:app.batchRun.sent,
          failed:app.batchRun.failed,anchors:document.querySelectorAll('a[download]').length};
      });
      assert.deepEqual(result,{firstReleased:true,allReleased:true,sent:2,failed:1,anchors:0});
    });

    await check('JPEG panorama dimensions survive batch resizing and metadata removal works independently of comparison',async page=>{
      await page.locator('#fileInput').setInputFiles(await panoramaFixture(page));await ready(page);
      assert.deepEqual(await page.evaluate(()=>[app.source.width,app.source.height]),[1280,640]);
      await settings(page,{width:'600'});
      await page.evaluate(()=>{const real=downloadBlob;window.panoramaBlobs=[];downloadBlob=(blob,name)=>{panoramaBlobs.push(blob);real(blob,name);};});
      await batch(page);
      let pano=await page.evaluate(async()=>parseJpegPanorama(new Uint8Array(await panoramaBlobs.at(-1).arrayBuffer())));
      assert.equal(pano.CroppedAreaImageWidthPixels,'600');assert.equal(pano.CroppedAreaImageHeightPixels,'300');
      assert.equal(pano.FullPanoWidthPixels,'600');assert.equal(pano.FullPanoHeightPixels,'300');
      await settings(page,{width:'600',metadata:'none'});await batch(page);
      pano=await page.evaluate(async()=>parseJpegPanorama(new Uint8Array(await panoramaBlobs.at(-1).arrayBuffer())));
      assert.equal(pano,null);
      assert.equal(await page.locator('#metadataPolicy').inputValue(),'panorama');
    });

    await check('single viewer, progress and reports fit desktop and mobile widths',async page=>{
      await page.locator('#fileInput').setInputFiles(files);await ready(page);await batch(page);
      await page.locator('#batchReport summary').click();
      for(const width of [1440,1100,768,390]) {
        await page.setViewportSize({width,height:1000});
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'overflow at '+width);
        assert.ok((await page.locator('#batchPanel').boundingBox()).height>100);
        assert.ok(await page.locator('.cell').nth(1).locator('canvas').evaluate(el=>el.height)>50);
      }
      await page.locator('.cell').nth(1).locator('.cell-foot').scrollIntoViewIfNeeded();
      const footer=await page.locator('.cell').nth(1).locator('.cell-foot').boundingBox();
      assert.ok(footer.y>=0&&footer.y+footer.height<=1000);
    });
  } finally {await browser.close();}
  if(failures)process.exitCode=1;
})().catch(error=>{console.error(error);process.exitCode=1;});
