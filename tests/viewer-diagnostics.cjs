const assert=require('node:assert/strict'),{pathToFileURL}=require('node:url');
const {chromium}=require('playwright');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.IMAGE_TEST_BROWSER||undefined});
 try{
  const context=await browser.newContext({acceptDownloads:true});await context.setOffline(true);
  const page=await context.newPage();await page.goto(pathToFileURL(require('./support/viewer-path.cjs')()).href);
  await page.waitForFunction(()=>document.getElementById('codecStatus').dataset.state==='ready',null,{timeout:90000});
  await page.locator('#studyOpen').click();await page.locator('#reportDiagnostic').click();
  await page.waitForFunction(()=>document.getElementById('diagnosticText').value.includes('\nRESULT '),null,{timeout:240000});
  const first=await page.locator('#diagnosticText').inputValue();assert.ok(Buffer.byteLength(first)<=4000);assert.match(first,/avif /);assert.match(first,/photo-webp /);assert.match(first,/ACTUAL .*1\.23\.4/);
  assert.equal(first.split('\n').filter(line=>/^(metrics|crop|resize|alpha-canvas|icc-p3|photo-webp|jpeg|png|png-js|png-palette|png-opt|webp|webp-ll|jxl|jxl-ll|jp2|j2k|tiff|bmp8|bmp24|bmp32|gif|gifenc|heic|avif|ico|png16|tiff16|jxl16|jp2-16|png-alpha|avif-alpha|cmyk-tiff|cmyk-jpeg)(?:\*? | !)/.test(line)).length,34);
  const download=page.waitForEvent('download');await page.locator('#diagnosticDownload').click();const file=await(await download).path();assert.equal(require('node:fs').readFileSync(file,'utf8'),first);
  await page.keyboard.press('Escape');assert.equal(await page.locator('#reportDiagnostic').evaluate(el=>el===document.activeElement),true);
  await page.locator('#reportDiagnostic').click();await page.locator('#diagnosticStop').click();
  await page.waitForFunction(()=>document.getElementById('diagnosticText').value.includes('RESULT INCOMPLETE'),null,{timeout:60000});
  assert.ok(Buffer.byteLength(await page.locator('#diagnosticText').inputValue())<=4000);
  assert.equal(await page.evaluate(()=>app.source),null);
  console.log('PASS offline automatic diagnostics, exact TXT, result, cancellation and focus without changing the source');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
