// Browser coverage runs in CI; this suite must not launch local Chromium during development.
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {pathToFileURL}=require('node:url');
const {chromium}=require('playwright');
const artifacts=require('./support/artifacts.cjs');

(async()=>{
  const browser=await chromium.launch({headless:true,executablePath:process.env.IMAGE_TEST_BROWSER||undefined});
  const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
  const page=await context.newPage(),errors=[],requests=[];
  page.setDefaultTimeout(90000);
  page.on('pageerror',error=>errors.push(error.message));
  page.on('request',request=>{if(/^https?:/.test(request.url()))requests.push(request.url());});
  try{
    await context.setOffline(true);
    await page.goto(pathToFileURL(require('./support/viewer-path.cjs')()).href);
    await page.locator('#studyOpen').click();
    await page.locator('#referenceSampleSelect').selectOption('gradient');
    await page.locator('#referenceSampleCreate').click();
    await page.waitForFunction(()=>app.source?.name==='ifl-gradient-v1.png'&&!app.sourceLoading);
    const before=await page.evaluate(()=>app.variants.map(v=>({...v.config})));
    await page.locator('#studyOpen').click();
    await page.locator('#qualitySeriesStart').click();
    await page.waitForFunction(()=>document.querySelectorAll('#qualitySeriesRows tr').length===10&&!document.querySelector('#qualitySeriesStart').disabled);
    assert.equal(await page.locator('#qualitySeriesRows tr').count(),10);
    assert.equal(await page.locator('#qualitySeriesRows tr[data-best="true"]').count(),1);
    assert.ok(await page.locator('#qualitySeriesRows tr[data-frontier="true"]').count()>0);
    assert.equal(await page.locator('#qualitySeriesChart').isVisible(),true);
    const after=await page.evaluate(()=>app.variants.map(v=>({...v.config})));
    assert.deepEqual(after,before,'series does not alter comparison cells');
    await page.locator('#qualitySeriesBudget').fill('1');
    assert.match(await page.locator('#qualitySeriesSummary').textContent(),/Ни одна готовая точка/);
    assert.equal(await page.locator('#qualitySeriesRows tr[data-best="true"]').count(),0);
    await page.locator('#qualitySeriesBudget').fill('100000');
    assert.equal(await page.locator('#qualitySeriesRows tr[data-best="true"]').count(),1);
    if(process.env.IMAGE_TEST_LOGS){const folder=artifacts.folder(process.env.IMAGE_TEST_LOGS);fs.mkdirSync(folder,{recursive:true});await page.locator('#qualitySeriesChart').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(folder,artifacts.runId+'-quality-series.png')});}
    await page.locator('#qualitySeriesStart').click();
    await page.locator('#qualitySeriesCancel').click();
    await page.waitForFunction(()=>!document.querySelector('#qualitySeriesStart').disabled);
    assert.match(await page.locator('#qualitySeriesStatus').textContent(),/Остановлено/);
    assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
    console.log('PASS offline quality series, measured budget/Pareto, unchanged cells and cancellation');
  }finally{await context.close();await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
