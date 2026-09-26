const assert = require('node:assert/strict');
const codecProbe = require('./support/codec-probe.cjs');
const artifacts = require('./support/artifacts.cjs');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const url = pathToFileURL(require('./support/viewer-path.cjs')()).href;
const storageKey = 'image-format-viewer.batch-settings.v1';
let failures = 0;
async function ready(page) {
  await page.waitForFunction(() => app.source && !app.sourceLoading &&
    app.variants.filter(v => !v.cell.classList.contains('hidden')).every(isVariantReady));
}
async function finished(page) {
  await page.waitForFunction(() => app.batchRun && !app.batchRun.running);
  await page.evaluate(() => Promise.all(downloadChecks));
}

(async () => {
  const browser = await chromium.launch({ headless: true,
    ...(process.env.IMAGE_TEST_BROWSER ? { executablePath: process.env.IMAGE_TEST_BROWSER } : {}) });
  console.log(`Chromium ${browser.version()}`);
  try {
    const fixturePage = await browser.newPage();
    const bytes = await fixturePage.evaluate(() => [[240,120],[120,240],[20,10]].map(([w,h]) => {
      const canvas = document.createElement('canvas'); canvas.width=w; canvas.height=h;
      const ctx=canvas.getContext('2d'); ctx.fillStyle='#086f9e'; ctx.fillRect(0,0,w/2,h);
      return canvas.toDataURL().split(',')[1];
    }));
    await fixturePage.close();
    const files = bytes.map((buffer,i) => ({name:['wide.png','tall.png','small.png'][i], mimeType:'image/png', buffer:Buffer.from(buffer,'base64')}));

    async function check(name, run, setup) {
      const context = await browser.newContext({ viewport:{width:1440,height:1000}, acceptDownloads:false });
      const page = await context.newPage();
      page.setDefaultTimeout(10000);
      const errors=[]; page.on('pageerror', e => errors.push(e.message));
      try {
        await context.addInitScript(() => {
          window.downloads=[]; window.downloadChecks=[];
          HTMLAnchorElement.prototype.click=function() {
            const name=this.download, href=this.href;
            downloadChecks.push((async () => {
              const blob=await fetch(href).then(r=>r.blob());
              const bitmap=await createImageBitmap(blob);
              try { downloads.push({name,type:blob.type,width:bitmap.width,height:bitmap.height}); }
              finally { bitmap.close(); }
            })());
          };
        });
        if (setup) await setup(page,context);
        await page.goto(url);
        await run(page,context);
        await page.evaluate(() => Promise.all(downloadChecks));
        assert.deepEqual(errors,[]);
        console.log('PASS '+name);
      } catch(error) { failures++; console.error(`FAIL ${name}: ${error.stack}`); }
      finally { await context.close(); }
    }

    await check('single viewer opens the dialog with quality 85, and Escape returns keyboard focus', async page => {
      assert.equal(await page.locator('#modeConvert, #modeCompare').count(),0);
      assert.equal(await page.locator('#convertAll').isDisabled(),true);
      await page.locator('#fileInput').setInputFiles(files); await ready(page);
      await page.locator('#layout4').click();
      await page.locator('.quality').nth(1).evaluate(el=>{el.value='42';el.dispatchEvent(new Event('input',{bubbles:true}));}); await ready(page);
      const before=await page.evaluate(()=>JSON.stringify({configs:app.variants.map(v=>v.config),layout:app.layout,source:app.source.name}));
      await page.locator('#convertAll').click();
      assert.equal(await page.locator('#batchFormat').inputValue(),'jpeg');
      assert.equal(await page.locator('#batchQualityNumber').inputValue(),'85');
      assert.equal(await page.locator('#batchFormat').evaluate(el=>el===document.activeElement),true);
      assert.match(await page.locator('#batchDialogCount').textContent(),/3 файла/);
      await page.locator('#batchQualityNumber').fill('65');
      assert.equal(await page.locator('#batchQuality').inputValue(),'65');
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('#batchDialog').isVisible(),false);
      assert.equal(await page.locator('#convertAll').evaluate(el=>el===document.activeElement),true);
      assert.equal(await page.evaluate(()=>JSON.stringify({configs:app.variants.map(v=>v.config),layout:app.layout,source:app.source.name})),before);
      assert.equal(await page.evaluate(key=>localStorage.getItem(key),storageKey),null);
      await page.locator('#convertAll').click();
      assert.equal(await page.locator('#batchQualityNumber').inputValue(),'85');
      await page.locator('#batchDialogClose').click();
      assert.equal(await page.evaluate(()=>downloads.length),0);
    });

    await check('saving without conversion survives reload and a new tab with only whitelisted parameters', async (page,context) => {
      await page.locator('#fileInput').setInputFiles(files[0]); await ready(page);
      await page.locator('#convertAll').click();
      await page.locator('#batchQualityNumber').fill('72');
      await page.locator('#batchAdvanced summary').click();
      await page.locator('#batchMatte').selectOption('blue');
      await page.locator('#batchFormat').selectOption('gif');
      await page.locator('#batchGifColors').fill('32');
      await page.locator('#batchGifDither').uncheck();
      await page.locator('#batchResizeMode').selectOption('limit');
      await page.locator('#batchDialogWidth').fill('100');
      await page.locator('#batchDialogHeight').fill('70');
      await page.locator('#batchMetadata').selectOption('none');
      await page.locator('#batchSaveSettings').click();
      const expected={format:'gif',quality:72,gifColors:32,gifDither:false,bmpColors:256,bmpCompression:'none',matte:'blue',resizeWidth:'100',resizeHeight:'70',metadataPolicy:'none',delivery:'files',targetKB:'',minQuality:40,tiffCompression:'deflate',tiffLevel:6,tiffPredictor:true,pngDepth:'auto',pngFilter:'default',pngLevel:6,jpegSubsampling:'420',jpegProgressive:false};
      assert.deepEqual(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),storageKey),{version:1,config:expected});
      assert.equal(await page.evaluate(()=>downloads.length),0);
      await page.reload();
      assert.deepEqual(await page.evaluate(()=>({...app.exportConfig})),expected);
      assert.equal(await page.evaluate(()=>app.files.length),0);
      await page.locator('#fileInput').setInputFiles(files[0]); await ready(page);
      await page.locator('#convertAll').click();
      assert.equal(await page.locator('#batchGifColors').inputValue(),'32');
      assert.equal(await page.locator('#batchGifDither').isChecked(),false);
      assert.equal(await page.locator('#batchDialogHeight').inputValue(),'70');
      const reopened=await context.newPage(); await reopened.goto(url);
      assert.deepEqual(await reopened.evaluate(()=>({...app.exportConfig})),expected);
      assert.equal(await reopened.evaluate(()=>app.files.length),0);
      await reopened.close();
    });

    await check('Cancel and close discard unsaved changes without overwriting localStorage or preview', async page => {
      await page.locator('#fileInput').setInputFiles(files[0]); await ready(page);
      await page.locator('#convertAll').click();
      await page.locator('#batchQualityNumber').fill('77'); await page.locator('#batchSaveSettings').click();
      const saved=await page.evaluate(key=>localStorage.getItem(key),storageKey);
      await page.locator('#batchQualityNumber').fill('25');
      await page.locator('#batchResizeMode').selectOption('limit');
      await page.locator('#batchDialogWidth').fill('10');
      await page.locator('#batchDialogCancel').click(); await ready(page);
      assert.equal(await page.evaluate(key=>localStorage.getItem(key),storageKey),saved);
      assert.equal(await page.evaluate(()=>app.variants[1].resultConfig.quality),85);
      assert.equal(await page.evaluate(()=>app.variants[1].imageData.width),240);
      await page.locator('#convertAll').click();
      assert.equal(await page.locator('#batchQualityNumber').inputValue(),'77');
      assert.equal(await page.locator('#batchResizeMode').inputValue(),'original');
      await page.locator('#batchQualityNumber').fill('50'); await page.locator('#batchDialogClose').click();
      assert.equal(await page.evaluate(key=>localStorage.getItem(key),storageKey),saved);
    });

    await check('launch from comparison uses all files, persists its parameters, and keeps comparison state', async page => {
      await page.locator('#fileInput').setInputFiles(files); await ready(page);
      await page.locator('#layout4').click(); await ready(page);
      await page.locator('#metadataPolicy').selectOption('none'); await ready(page);
      const before=await page.evaluate(()=>JSON.stringify({configs:app.variants.map(v=>v.config),layout:app.layout,metadata:els.metadataPolicy.value,source:app.source.name}));
      await page.locator('#convertAll').click();
      await page.locator('#batchFormat').selectOption('png');
      await page.locator('#batchResizeMode').selectOption('limit');
      await page.locator('#batchDialogWidth').fill('100'); await page.locator('#batchDialogHeight').fill('100');
      await page.locator('#batchStart').click(); await finished(page);
      assert.equal(await page.locator('#batchDialog').isVisible(),false);
      assert.equal(await page.locator('#batchPanel').isVisible(),true);
      assert.deepEqual(await page.evaluate(()=>downloads.map(d=>[d.name,d.width,d.height])),[['wide.png',100,50],['tall.png',50,100],['small.png',20,10]]);
      assert.equal(await page.evaluate(()=>JSON.stringify({configs:app.variants.map(v=>v.config),layout:app.layout,metadata:els.metadataPolicy.value,source:app.source.name})),before);
      assert.equal(await page.evaluate(()=>Object.isFrozen(app.batchRun.config)),true);
      assert.equal(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)).config.format,storageKey),'png');
      await page.reload();
      assert.equal(await page.evaluate(()=>app.exportConfig.resizeWidth),'100');
      assert.equal(await page.evaluate(()=>app.batchRun),null);
    });

    await check('PNG depth follows independent comparison and batch controls and survives saved-file decoding', async page => {
      await page.locator('#fileInput').setInputFiles(files[0]);await ready(page);
      const cell=page.locator('.cell').nth(1);
      await cell.locator('.format-select').selectOption('png');await ready(page);
      await cell.locator('.png-depth').selectOption('16');await ready(page);
      assert.deepEqual(await page.evaluate(()=>[app.variants[1].pixelBuffer.bitDepth,app.variants[1].measurement.psnrRGB]),[16,Infinity]);
      const header=await page.evaluate(async()=>Array.from(new Uint8Array(await app.variants[1].blob.slice(0,33).arrayBuffer())));
      assert.equal(header[24],16);
      await page.locator('#convertAll').click();await page.locator('#batchFormat').selectOption('png');
      assert.equal(await page.locator('#batchPngField').isVisible(),true);
      await page.locator('#batchPngDepth').selectOption('16');
      await page.waitForFunction(()=>isBatchPreviewReady()&&app.batchPreview.resultConfig.pngDepth==='16');
      assert.equal(await page.evaluate(async()=>new Uint8Array(await app.batchPreview.blob.slice(0,33).arrayBuffer())[24]),16);
      await page.locator('#batchSaveSettings').click();
      await page.locator('#batchDialogClose').click();
      assert.equal(await page.locator('#batchDialog').isVisible(),false);
      await cell.locator('.png-depth').selectOption('8');await ready(page);
      await page.locator('#convertAll').click();assert.equal(await page.locator('#batchPngDepth').inputValue(),'16');
      await page.locator('#batchStart').click();await finished(page);
      assert.equal(await page.evaluate(()=>app.batchRun.failed),0);
      assert.equal(await cell.locator('.png-depth').inputValue(),'8');
    });

    await check('conditional controls match format capabilities and no unsupported format is offered as usable', async page => {
      await page.waitForFunction(()=>document.getElementById('codecStatus').dataset.state==='ready');
      await page.locator('#fileInput').setInputFiles(files[0]); await ready(page);
      await page.locator('#convertAll').click();
      await page.locator('#batchAdvanced summary').click();
      assert.equal(await page.locator('#batchMatteField').isVisible(),true);
      await page.locator('#batchFormat').selectOption('png');
      assert.equal(await page.locator('#batchQualityField').isVisible(),false);
      assert.equal(await page.locator('#batchMatteField').isVisible(),false);
      assert.match(await page.locator('#batchMetadataHint').textContent(),/метаданные удаляются/);
      await page.locator('#batchFormat').selectOption('gif');
      assert.equal(await page.locator('#batchGifField').isVisible(),true);
      assert.equal(await page.locator('#batchDitherField').isVisible(),true);
      assert.equal(await page.locator('#batchGifColors').inputValue(),'256');
      assert.equal(await page.locator('#batchGifDither').isChecked(),true);
      assert.equal(await page.locator('#batchFormat option[value="gifenc"]').evaluate(el=>el.disabled),false);
      assert.equal(await page.locator('#batchFormat option[value="pngUpng"]').evaluate(el=>el.disabled),false);
      await page.locator('#batchFormat').selectOption('bmp');
      assert.equal(await page.locator('#batchBmpField').isVisible(),true);
      await page.locator('#batchBmpDepth').selectOption('32');
      assert.equal(await page.locator('#batchGifField').isVisible(),false);
      assert.equal(await page.locator('#batchMatteField').isVisible(),false);
      await page.locator('#batchBmpDepth').selectOption('24');
      assert.equal(await page.locator('#batchMatteField').isVisible(),true);
    });

    await check('invalid quality, palette and dimensions block saving and launch; valid corrections recover', async page => {
      await page.locator('#fileInput').setInputFiles(files[0]); await ready(page);
      await page.locator('#convertAll').click();
      for(const value of ['', '0', '101', '82.5']) {
        await page.locator('#batchQualityNumber').fill(value);
        assert.equal(await page.locator('#batchStart').isDisabled(),true);
        assert.equal(await page.locator('#batchSaveSettings').isDisabled(),true);
      }
      await page.locator('#batchQualityNumber').fill('85');
      await page.locator('#batchResizeMode').selectOption('limit');
      assert.equal(await page.locator('#batchStart').isDisabled(),true);
      for(const value of ['0', '-1', '1.5', '32769']) {
        await page.locator('#batchDialogWidth').fill(value);
        assert.equal(await page.locator('#batchStart').isDisabled(),true);
      }
      await page.locator('#batchDialogWidth').fill(''); await page.locator('#batchDialogHeight').fill('60');
      assert.equal(await page.locator('#batchStart').isDisabled(),false);
      await page.locator('#batchFormat').selectOption('gif');
      await page.locator('#batchGifColors').fill('257');
      assert.equal(await page.locator('#batchStart').isDisabled(),true);
      await page.locator('#batchGifColors').fill('16');
      assert.equal(await page.locator('#batchStart').isDisabled(),false);
      assert.equal(await page.evaluate(key=>localStorage.getItem(key),storageKey),null);
      await page.locator('#batchStart').click(); await finished(page);
      assert.equal(await page.evaluate(()=>downloads[0].height),60);
    });

    await check('malformed JSON and incompatible storage versions fall back without breaking initialization', async page => {
      for(const raw of ['{broken','null','[]','{"version":2,"config":{"quality":5}}','{"version":1,"config":[]}']) {
        await page.evaluate(({key,raw})=>localStorage.setItem(key,raw),{key:storageKey,raw}); await page.reload();
        assert.equal(await page.evaluate(()=>app.exportConfig.quality),85);
        await page.locator('#fileInput').setInputFiles(files[0]); await ready(page);
        await page.locator('#convertAll').click();
        assert.match(await page.locator('#batchStorageNotice').textContent(),/Не удалось прочитать/);
        await page.locator('#batchSaveSettings').click();
        assert.equal(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)).version,storageKey),1);
      }
    });

    await check('invalid stored fields are sanitized individually and extra data never reaches saved settings', async page => {
      await page.evaluate(key=>localStorage.setItem(key,JSON.stringify({version:1,config:{format:'__proto__',quality:101,gifColors:1,gifDither:'false',matte:'__proto__',metadataPolicy:'all',resizeWidth:'-2',resizeHeight:80,tiffCompression:'unknown',tiffLevel:100,tiffPredictor:'false',files:['private.png'],unexpected:'ignored'}})),storageKey);
      await page.reload();
      assert.deepEqual(await page.evaluate(()=>({...app.exportConfig})),{format:'jpeg',quality:85,gifColors:256,gifDither:true,bmpColors:256,bmpCompression:'none',matte:'white',metadataPolicy:'panorama',resizeWidth:'',resizeHeight:'80',delivery:'files',targetKB:'',minQuality:40,tiffCompression:'deflate',tiffLevel:6,tiffPredictor:true,pngDepth:'auto',pngFilter:'default',pngLevel:6,jpegSubsampling:'420',jpegProgressive:false});
      await page.locator('#fileInput').setInputFiles(files[0]); await ready(page);
      await page.locator('#convertAll').click(); await page.locator('#batchSaveSettings').click();
      const stored=await page.evaluate(key=>localStorage.getItem(key),storageKey);
      assert.equal(stored.includes('private.png'),false); assert.equal(stored.includes('unexpected'),false);
    });

    await check('unavailable saved codec remains explicit and can be corrected', async page => {
      await page.evaluate(key=>localStorage.setItem(key,JSON.stringify({version:1,config:{format:'pngUpng',quality:72}})),storageKey);
      await page.addInitScript(codecProbe,{failAll:true});
      await page.reload();
      await page.waitForFunction(()=>document.getElementById('codecStatus').dataset.state==='error');
      await page.locator('#fileInput').setInputFiles(files[0]);
      await page.waitForFunction(()=>app.source && !app.sourceLoading);
      assert.equal(await page.evaluate(()=>app.exportConfig.format),'pngUpng');
      await page.locator('#convertAll').click();
      assert.equal(await page.locator('#batchFormat').inputValue(),'pngUpng');
      assert.equal(await page.locator('#batchStart').isDisabled(),true);
      assert.match(await page.locator('#batchDialogError').textContent(),/кодек/);
      await page.locator('#batchFormat').selectOption('png'); await page.locator('#batchStart').click(); await finished(page);
      assert.equal(await page.evaluate(()=>downloads[0].type),'image/png');
    });

    await check('denied storage reads and writes still allow session settings and a successful batch', async page => {
      await page.locator('#fileInput').setInputFiles(files[0]); await ready(page);
      await page.locator('#convertAll').click();
      await page.locator('#batchFormat').selectOption('png'); await page.locator('#batchSaveSettings').click();
      assert.match(await page.locator('#batchStorageNotice').textContent(),/не разрешил сохранить/);
      await page.locator('#batchStart').click(); await finished(page);
      assert.equal(await page.evaluate(()=>app.batchRun.sent),1);
      assert.match(await page.locator('#batchStorageWarning').textContent(),/не разрешил сохранить/);
    }, async (page,context) => {
      await context.addInitScript(() => {
        Storage.prototype.getItem=function(){throw new DOMException('denied','SecurityError');};
        Storage.prototype.setItem=function(){throw new DOMException('full','QuotaExceededError');};
      });
    });

    await check('dialog traps focus and its settings and actions fit desktop and small mobile screens', async page => {
      await page.locator('#fileInput').setInputFiles(files); await ready(page);
      await page.locator('#convertAll').click();
      await page.locator('#batchResizeMode').selectOption('limit');
      await page.locator('#batchDialogWidth').fill('1920'); await page.locator('#batchDialogHeight').fill('1080');
      await page.locator('#batchAdvanced summary').click();
      for(let i=0;i<24;i++) { await page.keyboard.press('Tab'); assert.equal(await page.evaluate(()=>els.batchDialog.contains(document.activeElement)),true); }
      for(const [width,height] of [[1440,1000],[768,900],[390,760],[320,568]]) {
        await page.setViewportSize({width,height});
        await page.locator('#batchStart').scrollIntoViewIfNeeded();
        const rect=await page.locator('#batchDialog').boundingBox();
        assert.ok(rect.x>=0 && rect.x+rect.width<=width && rect.y>=0 && rect.y+rect.height<=height,`dialog bounds ${width}`);
        assert.equal(await page.locator('#batchDialog').evaluate(el=>el.scrollWidth>el.clientWidth),false,`dialog overflow ${width}`);
        const button=await page.locator('#batchStart').boundingBox();
        assert.ok(button.y>=0 && button.y+button.height<=height,`start visible ${width}`);
      }
      if(process.env.IMAGE_TEST_SCREENSHOTS) {
        const out=artifacts.folder(process.env.IMAGE_TEST_SCREENSHOTS); fs.mkdirSync(out,{recursive:true});
        for(const [label,width,height] of [['desktop',1440,1100],['mobile',390,844]]) {
          await page.setViewportSize({width,height});
          await page.locator('#batchAdvanced summary').evaluate(el=>el.parentElement.open=false);
          await page.locator('#batchDialog .batch-dialog-body').evaluate(el=>el.scrollTop=0);
          await page.screenshot({path:path.join(out,`${artifacts.runId}-batch-dialog-${label}.png`)});
        }
      }
    });
  } finally { await browser.close(); }
  if(failures) process.exitCode=1;
})().catch(error=>{console.error(error);process.exitCode=1;});
