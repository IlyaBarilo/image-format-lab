const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { spawnSync } = require('node:child_process'), { pathToFileURL } = require('node:url');
const { chromium } = require('playwright'), artifacts = require('./support/artifacts.cjs');
const url = pathToFileURL(require('./support/viewer-path.cjs')()).href;
const formats = ['avif', 'webpLossless', 'jxl', 'jxlLossless', 'tiff', 'ico'];
async function download(page, button) {
  const [d] = await Promise.all([page.waitForEvent('download'), button.click()]);
  const chunks = []; for await (const b of await d.createReadStream()) chunks.push(b);
  return { name: d.suggestedFilename(), bytes: Buffer.concat(chunks) };
}
(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.IMAGE_TEST_BROWSER || undefined });
  const report = { browser: browser.version(), checks: [], requests: [], errors: [] };
  try {
    const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 1000 } });
    await context.setOffline(true);
    context.on('request', r => { if (r.url() !== url && !/^(blob:|data:)/.test(r.url())) report.requests.push(r.url()); });
    const page = await context.newPage(); page.setDefaultTimeout(60000); page.on('pageerror', e => report.errors.push(e.message));
    await page.goto(url); await page.waitForFunction(() => document.getElementById('codecStatus').dataset.state === 'ready');
    const cases = await page.evaluate(async formats => {
      const rows = [], b64 = b => { let s=''; for(let i=0;i<b.length;i+=16384)s+=String.fromCharCode(...b.subarray(i,i+16384)); return btoa(s); };
      for (const [width,height] of [[1,1],[37,23],[256,192]]) {
        const imageData=new ImageData(width,height);
        for(let y=0;y<height;y++)for(let x=0;x<width;x++){
          const i=(y*width+x)*4;imageData.data.set([Math.round(x*255/Math.max(1,width-1)),Math.round(y*255/Math.max(1,height-1)),(x*7+y*11)%256,(x+y)%7?Math.round(x*255/Math.max(1,width-1)):255],i);
        }
        const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
        const ctx=canvas.getContext('2d');ctx.putImageData(imageData,0,0);
        const source={canvas,ctx,imageData,width,height,hasAlpha:true,name:'own.png'};
        const original=b64(imageData.data);
        for(const format of formats)for(const quality of (['avif','jxl'].includes(format)?[20,85]:[85])) {
          const encoded=await encodeFromSource({...DEFAULT_EXPORT_CONFIG,format,quality},source);
          const decoded=await decodeVariantForPreview(encoded.blob);
          if(decoded.imageData.width!==encoded.width||decoded.imageData.height!==encoded.height)throw Error('Preview dimensions');
          decoded.bitmap.close();
          if(b64(imageData.data)!==original)throw Error('Source changed or detached');
          rows.push({format,quality,width:encoded.width,height:encoded.height,file:b64(new Uint8Array(await encoded.blob.arrayBuffer())),rgba:b64(encoded.sourceImageData.data),bytes:encoded.blob.size,mime:encoded.blob.type});
        }
      }
      // Lossless APIs preserve even hidden RGB before a canvas round trip.
      const modern=await loadOptionalCodec('modern'),raw=new ImageData(new Uint8ClampedArray([91,25,192,0,41,212,6,12]),2,1);
      for(const format of ['webpLossless','jxlLossless']) {
        const saved=await modern.encode(raw,85,format),decoded=await modern.decode(saved,format==='webpLossless'?'webp':'jxl');
        if(!raw.data.every((v,i)=>v===decoded.imageData.data[i]))throw Error('Not lossless '+format);
      }
      for(const format of ['webp','jxl']) {
        let rejected=false;try{await modern.decode(new Blob(['bad']),format);}catch{rejected=true;}
        if(!rejected)throw Error('Malformed input accepted');
      }
      const recovered=await modern.encode(raw,85,'jxlLossless');await modern.decode(recovered);
      return rows;
    }, formats);
    assert.equal(cases.length,24);
    for (const format of ['avif', 'jxl']) {
      const matching = cases.filter(c => c.width === 256 && c.height === 192 && c.format === format);
      assert.ok(matching.find(c => c.quality === 85).bytes > matching.find(c => c.quality === 20).bytes, format + ' quality must change the output');
    }
    report.cases=cases.map(({file,rgba,...summary})=>summary);
    report.checks.push('24 real exports/decoded previews: 1x1, odd dimensions, transparency, two lossy qualities; exact lossless RGBA; corrupt input recovery; source ownership');
    if(process.env.IMAGE_TEST_MODERN_NATIVE) {
      const result=spawnSync(process.env.IMAGE_TEST_PYTHON||'python',[path.join(__dirname,'support/check-modern-export.py')],{input:JSON.stringify(cases),encoding:'utf8',maxBuffer:8*1024*1024});
      assert.equal(result.status,0,result.stderr||result.error?.message);report.native=JSON.parse(result.stdout);
      report.checks.push('all exports independently opened by native Pillow/libavif/libwebp/libjxl/libtiff; ICO all seven sizes; TIFF Deflate/straight-alpha tags');
    }
    await page.evaluate(()=>createSampleFile().then(file=>addFiles([file])));
    await page.waitForFunction(()=>app.source && app.variants.filter(v=>!v.cell.classList.contains('hidden')).every(isVariantReady));
    const cell=page.locator('.cell').nth(1);
    for(const format of formats) {
      await cell.locator('.format-select').selectOption(format);
      await page.waitForFunction(()=>isVariantReady(app.variants[1]));
      assert.equal(await cell.locator('.quality').isVisible(),['avif','jxl'].includes(format));
      const saved=await download(page,cell.locator('button[title="Скачать вариант"]'));
      assert.match(saved.name,new RegExp('\\.'+({webpLossless:'webp',jxlLossless:'jxl',tiff:'tif'}[format]||format)+'$'));
      assert.ok(saved.bytes.length>10);
    }
    report.checks.push('all six selectors, appropriate quality visibility, current comparison preview and downloads');
    await cell.locator('.format-select').selectOption('tiff');
    await cell.locator('.tiff-compression').selectOption('lzw');
    await page.waitForFunction(()=>app.variants[1].resultConfig?.tiffCompression==='lzw'&&isVariantReady(app.variants[1]));
    assert.equal(await cell.locator('.tiff-level-wrap').isVisible(),false);
    await cell.locator('.tiff-compression').selectOption('deflate');
    await cell.locator('.tiff-level').press('End');
    await cell.locator('.tiff-predictor').uncheck();
    await page.waitForFunction(()=>app.variants[1].resultConfig?.tiffCompression==='deflate'&&app.variants[1].resultConfig?.tiffLevel===9&&app.variants[1].resultConfig?.tiffPredictor===false&&isVariantReady(app.variants[1]));
    assert.equal(await page.locator('#tiffSettingsDialog').isVisible(),false);
    await cell.locator('.tiff-compression').selectOption('none');
    await page.waitForFunction(()=>app.variants[1].resultConfig?.tiffCompression==='none'&&isVariantReady(app.variants[1]));
    assert.equal(await cell.locator('.tiff-level-wrap').isVisible(),false);
    assert.equal(await cell.locator('.tiff-predictor-wrap').isVisible(),false);
    report.checks.push('Inline TIFF controls automatically update comparison without a dialog; compression-dependent fields, Deflate level and predictor reach actual output');
    await page.locator('#convertAll').click();
    await page.locator('#batchResizeMode').selectOption('limit');await page.locator('#batchDialogWidth').fill('37');
    for(const format of formats) {
      await page.locator('#batchFormat').selectOption(format);
      if(format==='tiff') {
        await page.locator('#batchTiffSettings').click();
        await page.locator('#tiffCompression').selectOption('lzw');
        await page.locator('#tiffSettingsDialog button').click();
      }
      await page.waitForFunction(()=>isBatchPreviewReady()&&!app.batchPreview.busy);
      const dims=await page.evaluate(()=>[app.batchPreview.width,app.batchPreview.height]);
      assert.equal(dims[0],format==='ico'?256:37);
      const preview=await download(page,page.locator('#batchPreviewDownload'));assert.ok(preview.bytes.length>10);
    }
    await page.locator('#batchDelivery').selectOption('zip');
    const zip=await download(page,page.locator('#batchStart'));assert.equal(zip.bytes.readUInt32LE(0),0x04034b50);
    report.checks.push('batch settings/resize/actual preview/download for each format and ICO ZIP');
    assert.deepEqual(report.requests,[]);assert.deepEqual(report.errors,[]);report.passed=true;
  } finally { await browser.close(); }
  if(process.env.IMAGE_TEST_LOGS) fs.writeFileSync(path.join(artifacts.folder(process.env.IMAGE_TEST_LOGS),artifacts.runId+'-modern.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2));
})().catch(e=>{console.error(e);process.exitCode=1});
