const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');
const artifacts = require('./support/artifacts.cjs');
const url = pathToFileURL(require('./support/viewer-path.cjs')()).href;
async function download(page, button) {
  const [result] = await Promise.all([page.waitForEvent('download'), button.click()]);
  const chunks = []; for await (const chunk of await result.createReadStream()) chunks.push(chunk);
  return { name: result.suggestedFilename(), bytes: Buffer.concat(chunks) };
}
async function ready(page) { await page.waitForFunction(() => app.source && app.variants.filter(v => !v.cell.classList.contains('hidden')).every(isVariantReady)); }
(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.IMAGE_TEST_BROWSER || undefined });
  const report = { browser: browser.version(), checks: [], cases: [], externalRequests: [], errors: [] };
  try {
    const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 1000 } });
    await context.setOffline(true);
    context.on('request', r => { if (r.url() !== url && !/^(blob:|data:)/.test(r.url())) report.externalRequests.push(r.url()); });
    const page = await context.newPage(); page.setDefaultTimeout(60000);
    page.on('pageerror', e => report.errors.push(e.message));
    await page.addInitScript(() => {
      const Original = Worker; globalThis.heicEncoders = [];
      globalThis.Worker = class extends Original {
        constructor(...args) { super(...args); this.record = { terminated: false };
          this.addEventListener('message', ({data}) => { if (data.type === 'ready' && data.encoder) { this.record.encoder = data.encoder; heicEncoders.push(this.record); } }); }
        terminate() { this.record.terminated = true; return super.terminate(); }
      };
    });
    await page.goto(url); await page.waitForFunction(() => document.getElementById('codecStatus').dataset.state === 'ready');
    const cases = await page.evaluate(async () => {
      const codec = await loadOptionalCodec('heic'), rows = [];
      const base64 = bytes => { let s=''; for(let i=0;i<bytes.length;i+=16384)s+=String.fromCharCode(...bytes.subarray(i,i+16384));return btoa(s); };
      for (const [width,height,alpha] of [[1,1,false],[1,17,false],[37,23,true],[129,65,false],[1024,768,false]]) {
        for (const quality of [1,25,85,100]) {
          const input = new ImageData(width,height);
          for(let y=0;y<height;y++)for(let x=0;x<width;x++){
            const i=(y*width+x)*4;input.data[i]=x*255/Math.max(1,width-1);input.data[i+1]=y*255/Math.max(1,height-1);
            input.data[i+2]=Math.round((Math.sin(x/8)+1)*100);input.data[i+3]=alpha?Math.round(x*255/(width-1)):255;
          }
          const before=base64(input.data), start=performance.now();
          const blob=await codec.encode(input,quality), bytes=new Uint8Array(await blob.arrayBuffer());
          if(base64(input.data)!==before)throw Error('Encoder changed or detached the source');
          const decoded=await codec.decode(blob);
          if(decoded.width!==width||decoded.height!==height)throw Error('HEIC crop changed dimensions');
          let alphaMaxError=0,rgbMeanError=0;
          for(let i=0;i<input.data.length;i++)if(i%4===3)alphaMaxError=Math.max(alphaMaxError,Math.abs(input.data[i]-decoded.imageData.data[i]));else rgbMeanError+=Math.abs(input.data[i]-decoded.imageData.data[i]);
          rgbMeanError/=width*height*3;
          rows.push({width,height,alpha,quality,mime:blob.type,bytes:blob.size,ms:Math.round(performance.now()-start),alphaMaxError,rgbMeanError,
            brand:String.fromCharCode(...bytes.subarray(8,12)),heic:base64(bytes),rgba:before});
        }
      }
      return rows;
    });
    for (const row of cases) {
      assert.equal(row.mime,'image/heic'); assert.equal(row.brand,'heic');
      if(!row.alpha)assert.equal(row.alphaMaxError,0);
      if(row.quality>=25)assert.ok(row.rgbMeanError<16,JSON.stringify({...row,heic:undefined,rgba:undefined}));
      if(row.alpha&&row.quality>=85)assert.ok(row.alphaMaxError<=2);
      const { heic,rgba,...summary }=row; report.cases.push(summary);
    }
    assert.ok(cases[14].bytes>cases[13].bytes,'quality must affect HEIC output');
    report.checks.push('20 real HEIC round trips: 1x1, narrow, odd dimensions, alpha and 1024x768; quality 1/25/85/100; source pixels retained');
    if(process.env.IMAGE_TEST_HEIC_NATIVE){
      const native=spawnSync(process.env.IMAGE_TEST_PYTHON||'python',[path.join(__dirname,'support/check-heic-export.py')],{input:JSON.stringify(cases),encoding:'utf8',maxBuffer:4*1024*1024});
      assert.equal(native.status,0,native.stderr||native.error?.message); report.native=JSON.parse(native.stdout);
      report.checks.push('all browser exports independently opened by native Pillow-Heif');
    }
    const validation=await page.evaluate(async()=>{
      const codec=await loadOptionalCodec('heic'), input=new ImageData(2,2), messages=[];
      for(const [image,q] of [[input,0],[input,101],[input,50.5],[{width:40000001,height:1,data:[]},85],[{width:2,height:2,data:[1]},85]]){
        try{await codec.encode(image,q);messages.push(null);}catch(e){messages.push(e.message);}
      }
      const blobs=await Promise.all([codec.encode(input,50),codec.encode(input,80)]);
      const decoded=await codec.decode(blobs[1]);return{messages,recovered:[decoded.width,decoded.height],workers:heicEncoders};
    });
    assert.ok(validation.messages.every(Boolean));assert.deepEqual(validation.recovered,[2,2]);
    assert.ok(validation.workers.length>40&&validation.workers.every(w=>w.terminated&&w.encoder==='Kvazaar 2.3.2'));
    report.checks.push('invalid quality/size rejected, queued encoding recovers, all HEIC Workers terminated');
    const png=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=129;c.height=65;const x=c.getContext('2d');x.fillStyle='#b84119';x.fillRect(0,0,65,65);x.fillStyle='#1b79cd';x.fillRect(65,0,64,65);return c.toDataURL().split(',')[1];});
    await page.locator('#fileInput').setInputFiles([{name:'own-a.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')},{name:'own-b.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')}]);
    await ready(page);
    const cell=page.locator('.cell').nth(1); await cell.locator('.format-select').selectOption('heic'); await ready(page);
    assert.equal(await cell.locator('.quality').isVisible(),true);
    const comparison=await page.evaluate(async()=>{
      const v=app.variants[1], decoded=await decodeHeicFile(v.blob);
      return {same:decoded.imageData.data.every((n,i)=>n===v.imageData.data[i]),psnr:v.measurement.psnrRGB,config:v.config.format,bytes:v.blob.size};
    });
    assert.equal(comparison.same,true);assert.equal(comparison.config,'heic');assert.ok(Number.isFinite(comparison.psnr));
    const saved=await download(page,cell.locator('button[title="Скачать вариант"]'));
    assert.match(saved.name,/\.heic$/);assert.equal(saved.bytes.toString('ascii',8,12),'heic');assert.equal(saved.bytes.length,comparison.bytes);
    report.checks.push('comparison HEIC selector, quality slider, real decoded preview/metrics and .heic download');
    const budget=await page.evaluate(async()=>{
      const result=await encodeFromSource({...DEFAULT_EXPORT_CONFIG,format:'heic',quality:85,targetKB:2,minQuality:20},app.source);
      return{bytes:result.blob.size,attempts:result.attempts,quality:result.selectedQuality,width:result.width,height:result.height};
    });
    assert.ok(budget.bytes<=2000&&budget.attempts>=2&&budget.attempts<=21&&budget.quality>=20);assert.deepEqual([budget.width,budget.height],[129,65]);
    report.checks.push('target-size search checks actual HEIC bytes and retains dimensions');
    await page.locator('#convertAll').click();await page.locator('#batchFormat').selectOption('heic');
    await page.locator('#batchResizeMode').selectOption('limit');await page.locator('#batchDialogWidth').fill('37');
    await page.waitForFunction(()=>isBatchPreviewReady()&&!app.batchPreview.busy);
    assert.deepEqual(await page.evaluate(()=>[app.batchPreview.width,app.batchPreview.height,app.batchPreview.blob.type]),[37,19,'image/heic']);
    const preview=await download(page,page.locator('#batchPreviewDownload'));assert.match(preview.name,/\.heic$/);
    await page.locator('#batchDialogWidth').fill('');assert.equal(await page.locator('#batchPreviewDownload').isDisabled(),true);
    await page.locator('#batchDialogWidth').fill('37');await page.waitForFunction(()=>isBatchPreviewReady()&&!app.batchPreview.busy);
    await page.locator('#batchDelivery').selectOption('zip');
    const zip=await download(page,page.locator('#batchStart'));
    let at=0,count=0;
    while(zip.bytes.readUInt32LE(at)===0x04034b50){
      assert.equal(zip.bytes.readUInt16LE(at+8),0);const size=zip.bytes.readUInt32LE(at+18),n=zip.bytes.readUInt16LE(at+26),extra=zip.bytes.readUInt16LE(at+28);
      const name=zip.bytes.subarray(at+30,at+30+n).toString();assert.match(name,/\.heic$/);
      const begin=at+30+n+extra;assert.equal(zip.bytes.toString('ascii',begin+8,begin+12),'heic');at=begin+size;count++;
    }
    assert.equal(count,2);
    assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem(BATCH_STORAGE_KEY)).config.format),'heic');
    report.checks.push('batch HEIC preview, resize, stale download protection, two-file ZIP and saved format');
    await page.evaluate(()=>clearFiles());
    await page.locator('#fileInput').setInputFiles({name:'saved.heic',mimeType:'image/heic',buffer:saved.bytes});
    await page.waitForFunction(()=>app.source?.name==='saved.heic');assert.deepEqual(await page.evaluate(()=>[app.source.width,app.source.height]),[129,65]);
    report.checks.push('downloaded HEIC reopens in the shared file list');
    assert.deepEqual(report.externalRequests,[]);assert.deepEqual(report.errors,[]);report.passed=true;
  } finally { await browser.close(); }
  if(process.env.IMAGE_TEST_LOGS)fs.writeFileSync(path.join(artifacts.folder(process.env.IMAGE_TEST_LOGS),artifacts.runId+'-heic-encode.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2));
})().catch(e=>{console.error(e);process.exitCode=1});
