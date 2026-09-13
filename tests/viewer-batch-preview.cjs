const assert = require('node:assert/strict');
const fs = require('node:fs');
const artifacts = require('./support/artifacts.cjs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');
const root=path.resolve(__dirname,'..');
const url=pathToFileURL(require('./support/viewer-path.cjs')()).href;
let failures=0;
async function ready(page) {
  await page.waitForFunction(()=>app.source&&!app.sourceLoading&&app.variants.filter(v=>!v.cell.classList.contains('hidden')).every(isVariantReady));
}
async function previewReady(page) { await page.waitForFunction(()=>isBatchPreviewReady()&&!app.batchPreview.busy); }
async function limit(page,width,height='') {
  await page.locator('#batchResizeMode').selectOption('limit');
  await page.locator('#batchDialogWidth').fill(width); await page.locator('#batchDialogHeight').fill(height);
}

(async()=>{
  const browser=await chromium.launch({headless:true,...(process.env.IMAGE_TEST_BROWSER?{executablePath:process.env.IMAGE_TEST_BROWSER}:{})});
  console.log('Chromium '+browser.version());
  try {
    const fixture=await browser.newPage();
    const bytes=await fixture.evaluate(()=>[[240,120],[80,160],[24,12]].map(([w,h])=>{
      const canvas=document.createElement('canvas'); canvas.width=w;canvas.height=h;
      const ctx=canvas.getContext('2d');ctx.fillStyle='#078cb1';ctx.fillRect(0,0,w/2,h);
      ctx.fillStyle='rgba(180,20,50,0.5)';ctx.fillRect(w/3,h/3,w/3,h/3);
      return canvas.toDataURL().split(',')[1];
    })); await fixture.close();
    const files=bytes.map((buffer,i)=>({name:['wide.png','tall.png','small.png'][i],mimeType:'image/png',buffer:Buffer.from(buffer,'base64')}));
    async function check(name,run) {
      const page=await browser.newPage({viewport:{width:1440,height:1000},acceptDownloads:false});
      page.setDefaultTimeout(10000);const errors=[];page.on('pageerror',error=>errors.push(error.message));
      try {
        await page.goto(url);await page.locator('#fileInput').setInputFiles(files);await ready(page);
        await page.evaluate(()=>{
          window.downloads=[];window.downloadChecks=[];
          HTMLAnchorElement.prototype.click=function(){
            const name=this.download,href=this.href;
            downloadChecks.push((async()=>{
              const blob=await fetch(href).then(r=>r.blob());const bitmap=await createImageBitmap(blob);
              try{downloads.push({name,mime:blob.type,width:bitmap.width,height:bitmap.height});}finally{bitmap.close();}
            })());
          };
        });
        await run(page);await page.evaluate(()=>Promise.all(downloadChecks));
        assert.deepEqual(errors,[]);console.log('PASS '+name);
      }catch(error){failures++;console.error('FAIL '+name+': '+error.stack);}
      finally{await page.close();}
    }

    await check('draft preview uses the current source and resized reference without changing comparison or storage',async page=>{
      await page.locator('#layout4').click();await ready(page);
      const before=await page.evaluate(()=>JSON.stringify({configs:app.variants.map(v=>v.config),source:app.source.name,view:app.view,metadata:els.metadataPolicy.value,layout:app.layout}));
      await page.locator('#convertAll').click();await page.locator('#batchFormat').selectOption('png');await limit(page,'100','100');await previewReady(page);
      assert.deepEqual(await page.evaluate(()=>({w:app.batchPreview.width,h:app.batchPreview.height,psnr:app.batchPreview.metrics.psnr===Infinity,alpha:app.batchPreview.metrics.alpha,mime:app.batchPreview.blob.type})),
        {w:100,h:50,psnr:true,alpha:0,mime:'image/png'});
      assert.match(await page.locator('#batchPreviewBeforeInfo').textContent(),/240×120/);
      assert.match(await page.locator('#batchPreviewAfterInfo').textContent(),/100×50/);
      assert.equal(await page.evaluate(()=>JSON.stringify({configs:app.variants.map(v=>v.config),source:app.source.name,view:app.view,metadata:els.metadataPolicy.value,layout:app.layout})),before);
      assert.equal(await page.evaluate(()=>localStorage.getItem(BATCH_STORAGE_KEY)),null);
      await page.locator('#batchPreviewDownload').click();await page.evaluate(()=>Promise.all(downloadChecks));
      assert.deepEqual(await page.evaluate(()=>downloads),[{name:'wide.png',mime:'image/png',width:100,height:50}]);
      assert.equal(await page.evaluate(()=>app.batchRun),null);
    });

    await check('changing settings disables the old result immediately and restores a valid preview',async page=>{
      await page.locator('#convertAll').click();await previewReady(page);
      await limit(page,'0');
      assert.equal(await page.locator('#batchPreviewDownload').isDisabled(),true);
      assert.equal(await page.evaluate(()=>app.batchPreview.blob),null);
      await page.evaluate(()=>els.batchPreviewDownload.dispatchEvent(new Event('click')));
      assert.equal(await page.evaluate(()=>downloads.length),0);
      await page.locator('#batchDialogWidth').fill('60');await page.locator('#batchFormat').selectOption('png');await previewReady(page);
      assert.equal(await page.evaluate(()=>app.batchPreview.width),60);
      await page.locator('#batchPreviewDownload').click();await page.evaluate(()=>Promise.all(downloadChecks));
      assert.equal(await page.evaluate(()=>downloads[0].name),'wide.png');
    });

    await check('closing during decode and reopening discards and releases the obsolete bitmap',async page=>{
      await page.evaluate(()=>{
        const real=decodeVariantForPreview;window.closedBitmaps=0;let once=true;
        decodeVariantForPreview=async blob=>{
          const decoded=await real(blob);
          if(els.batchDialog.open&&once){once=false;const close=decoded.bitmap.close.bind(decoded.bitmap);
            decoded.bitmap.close=()=>{closedBitmaps++;close();};
            await new Promise(resolve=>{window.finishDecode=()=>resolve();});
          }
          return decoded;
        };
      });
      await page.locator('#convertAll').click();await page.waitForFunction(()=>Boolean(window.finishDecode));
      await page.keyboard.press('Escape');await page.locator('#convertAll').click();
      await page.locator('#batchFormat').selectOption('png');await limit(page,'48');
      await page.evaluate(()=>finishDecode());await previewReady(page);
      assert.deepEqual(await page.evaluate(()=>({width:app.batchPreview.width,format:app.batchPreview.resultConfig.format,closed:closedBitmaps})),{width:48,format:'png',closed:1});
    });

    await check('rapid edits queue only the latest draft with at most one active preview encoder',async page=>{
      await page.evaluate(()=>{
        const real=encodeFromSource;window.calls=[];window.active=0;window.maxActive=0;
        encodeFromSource=async(config,source)=>{
          if(!els.batchDialog.open)return real(config,source);
          active++;maxActive=Math.max(maxActive,active);calls.push(config.resizeWidth);
          try {if(calls.length===1)await new Promise(resolve=>{window.releaseEncode=resolve;});return await real(config,source);}
          finally{active--;}
        };
      });
      await page.locator('#convertAll').click();await page.waitForFunction(()=>Boolean(window.releaseEncode));
      await limit(page,'60');await page.locator('#batchDialogWidth').fill('50');await page.locator('#batchDialogWidth').fill('40');
      await page.evaluate(()=>releaseEncode());await previewReady(page);
      assert.deepEqual(await page.evaluate(()=>({calls,maxActive,width:app.batchPreview.width})),{calls:['','40'],maxActive:1,width:40});
    });

    await check('a changed source during pending preview cannot publish the previous file',async page=>{
      await page.evaluate(()=>{
        const real=encodeFromSource;let once=true;
        encodeFromSource=async(config,source)=>{
          if(els.batchDialog.open&&once){once=false;await new Promise(resolve=>{window.releaseOldSource=resolve;});}
          return real(config,source);
        };
      });
      await page.locator('#convertAll').click();await page.waitForFunction(()=>Boolean(window.releaseOldSource));
      await page.evaluate(()=>selectFile(app.files[1].id));
      await page.evaluate(()=>releaseOldSource());await previewReady(page);
      assert.equal(await page.locator('#batchPreviewSource').textContent(),'tall.png');
      assert.deepEqual(await page.evaluate(()=>[app.batchPreview.width,app.batchPreview.height]),[80,160]);
      await page.locator('#batchPreviewDownload').click();await page.evaluate(()=>Promise.all(downloadChecks));
      assert.equal(await page.evaluate(()=>downloads[0].name),'tall.jpg');
    });

    await check('corrupt or wrong-sized encoded previews show an error without a substitute result',async page=>{
      await page.evaluate(()=>{
        const real=encodeFromSource;window.restoreEncoder=()=>{encodeFromSource=real;};
        encodeFromSource=async(config,source)=>els.batchDialog.open
          ?{blob:new Blob(['bad output'],{type:'image/png'}),width:source.width,height:source.height}:real(config,source);
      });
      await page.locator('#convertAll').click();
      await page.waitForFunction(()=>els.batchPreviewStatus.textContent.startsWith('Ошибка предпросмотра'));
      assert.equal(await page.locator('#batchPreviewDownload').isDisabled(),true);
      assert.equal(await page.evaluate(()=>app.batchPreview.bitmap),null);
      await page.evaluate(()=>{restoreEncoder();const real=encodeFromSource;window.restoreEncoder=()=>{encodeFromSource=real;};encodeFromSource=async(config,source)=>{const out=await real(config,source);return els.batchDialog.open?{...out,width:out.width+1}:out;};});
      await page.locator('#batchFormat').selectOption('png');
      await page.waitForFunction(()=>els.batchPreviewStatus.textContent.includes('Размеры результата'));
      assert.equal(await page.evaluate(()=>app.batchPreview.blob),null);
      await page.evaluate(()=>restoreEncoder());await limit(page,'120');await previewReady(page);
      assert.equal(await page.evaluate(()=>app.batchPreview.width),120);
    });

    await check('preview closure releases bitmap, Blob, source and canvas storage',async page=>{
      await page.locator('#convertAll').click();await previewReady(page);
      await page.evaluate(()=>{window.bitmapClosed=0;const bitmap=app.batchPreview.bitmap,close=bitmap.close.bind(bitmap);bitmap.close=()=>{bitmapClosed++;close();};});
      await page.locator('#batchDialogCancel').click();
      await page.waitForFunction(()=>app.batchPreview.blob===null);
      assert.deepEqual(await page.evaluate(()=>({bitmap:app.batchPreview.bitmap,source:app.batchPreview.source,pending:app.batchPreview.pending,closed:bitmapClosed,before:els.batchPreviewBefore.width,after:els.batchPreviewAfter.width})),
        {bitmap:null,source:null,pending:false,closed:1,before:1,after:1});
    });

    await check('zoom and pan in either preview stay independent of the main viewer and survive parameter changes',async page=>{
      const main=await page.evaluate(()=>JSON.stringify(app.view));
      await page.locator('#convertAll').click();await previewReady(page);
      await page.locator('#batchPreviewZoomIn').click();
      const rect=await page.locator('#batchPreviewAfter').boundingBox();
      await page.mouse.move(rect.x+rect.width/2,rect.y+rect.height/2);await page.mouse.down();
      await page.mouse.move(rect.x+rect.width/2+20,rect.y+rect.height/2+10);await page.mouse.up();
      const view=await page.evaluate(()=>({zoom:app.batchPreview.zoom,x:app.batchPreview.centerX,y:app.batchPreview.centerY}));
      assert.ok(view.zoom>1);assert.notEqual(view.x,0.5);assert.notEqual(view.y,0.5);
      await page.locator('#batchQualityNumber').fill('72');await previewReady(page);
      assert.deepEqual(await page.evaluate(()=>({zoom:app.batchPreview.zoom,x:app.batchPreview.centerX,y:app.batchPreview.centerY})),view);
      assert.equal(await page.evaluate(()=>JSON.stringify(app.view)),main);
      await page.locator('#batchPreviewFit').click();
      assert.equal(await page.evaluate(()=>app.batchPreview.zoom),1);
    });

    await check('small files are not enlarged and JPEG matte and PNG alpha are reflected in the preview',async page=>{
      await page.locator('.file-select').nth(2).click();await ready(page);
      await page.locator('#convertAll').click();await limit(page,'100','100');
      await page.locator('#batchAdvanced').evaluate(el=>el.open=true);await page.locator('#batchMatte').selectOption('black');await previewReady(page);
      assert.deepEqual(await page.evaluate(()=>[app.batchPreview.width,app.batchPreview.height]),[24,12]);
      assert.ok(await page.evaluate(()=>app.batchPreview.metrics.alpha)>0);
      await page.locator('#batchFormat').selectOption('png');await previewReady(page);
      assert.equal(await page.evaluate(()=>app.batchPreview.metrics.alpha),0);
    });

    await check('preview content fits desktop and mobile and actions stay accessible',async page=>{
      await page.locator('#convertAll').click();await page.locator('#batchFormat').selectOption('png');await limit(page,'120');await previewReady(page);
      for(const [width,height] of [[1440,1000],[768,900],[390,844],[320,568]]) {
        await page.setViewportSize({width,height});
        await page.locator('#batchPreviewAfter').scrollIntoViewIfNeeded();
        assert.equal(await page.locator('.batch-dialog-body').evaluate(el=>el.scrollWidth>el.clientWidth),false,'overflow '+width);
        assert.ok((await page.locator('#batchPreviewAfter').boundingBox()).width>100);
        const button=await page.locator('#batchStart').boundingBox();assert.ok(button.y>=0&&button.y+button.height<=height);
      }
      if(process.env.IMAGE_TEST_SCREENSHOTS) {
        const out=artifacts.folder(process.env.IMAGE_TEST_SCREENSHOTS);fs.mkdirSync(out,{recursive:true});
        for(const [label,width,height] of [['desktop',1440,1000],['mobile',390,844]]) {
          await page.setViewportSize({width,height});await page.locator('#batchPreviewAfter').scrollIntoViewIfNeeded();
          await page.screenshot({path:path.join(out,artifacts.runId+'-batch-preview-'+label+'.png')});
        }
        await page.locator('#batchDialogCancel').click();await page.setViewportSize({width:1440,height:1000});
        await page.screenshot({path:path.join(out,artifacts.runId+'-single-viewer.png')});
      }
    });
  } finally {await browser.close();}
  if(failures)process.exitCode=1;
})().catch(error=>{console.error(error);process.exitCode=1;});
