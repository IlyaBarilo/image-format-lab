// Browser integration for the exact per-pixel error distribution. CI runs Chromium.
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {pathToFileURL}=require('node:url');
const {chromium}=require('playwright');
const artifacts=require('./support/artifacts.cjs');

(async()=>{
  const browser=await chromium.launch({headless:true,executablePath:process.env.IMAGE_TEST_BROWSER||undefined});
  const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
  const page=await context.newPage(),errors=[],requests=[];
  page.setDefaultTimeout(20000);
  page.on('pageerror',error=>errors.push(error.message));
  page.on('request',request=>{if(/^https?:/.test(request.url()))requests.push(request.url());});
  const ready=()=>page.waitForFunction(()=>app.source&&!app.sourceLoading&&app.variants.slice(0,app.layout).every(isVariantReady));
  const plotted=()=>page.waitForFunction(()=>document.getElementById('analysisCombined').dataset.state==='ready'&&document.getElementById('analysisCombinedChart').dataset.kind==='errorHistogram');
  try{
    await context.setOffline(true);
    await page.goto(pathToFileURL(require('./support/viewer-path.cjs')()).href);
    await page.locator('#sampleImage').click();await ready();
    await page.locator('#analysisType').selectOption('errorHistogram');await plotted();
    if(process.env.IMAGE_TEST_LOGS){const folder=artifacts.folder(process.env.IMAGE_TEST_LOGS);fs.mkdirSync(folder,{recursive:true});await page.screenshot({path:path.join(folder,artifacts.runId+'-error-histogram.png')});}
    assert.equal(await page.locator('#analysisDisplayOverlay').isChecked(),true);
    assert.equal(await page.locator('#analysisDisplayDelta').isDisabled(),true);
    assert.equal(await page.locator('#analysisLevelLabel').textContent(),'Ошибка');
    const first=await page.evaluate(()=>getAnalysisSnapshot());
    assert.equal(first.settings.type,'errorHistogram');
    assert.equal(first.items[0].data.channels[0][0],first.items[0].data.pixelCount);
    assert.equal(first.items[0].data.metrics.maeRGB,0);
    assert.ok((await page.locator('#analysisCombinedLegend').textContent()).includes('MAE RGB'));
    await page.evaluate(()=>{const oldWorker=workerCompute,oldEncode=encodeOne;window.errorJobs=0;window.errorEncodes=0;workerCompute=(...args)=>{errorJobs++;return oldWorker(...args);};encodeOne=(...args)=>{errorEncodes++;return oldEncode(...args);};});
    await page.locator('#analysisDifferenceChannel').selectOption('alpha');
    assert.equal(await page.locator('#analysisMatte').isDisabled(),true);
    await page.locator('#analysisLevel').fill('0');
    await page.locator('#analysisDisplaySeparate').check();
    await page.waitForFunction(()=>[...document.querySelectorAll('.analysis-card')].filter(c=>!c.hidden).every(c=>c.dataset.state==='ready'&&c.querySelector('canvas').dataset.kind==='errorHistogram'));
    assert.deepEqual(await page.evaluate(()=>[errorJobs,errorEncodes]),[0,0]);
    await page.locator('#analysisScope').selectOption('full');
    await page.waitForFunction(()=>getAnalysisSnapshot().settings.scope==='full'&&getAnalysisSnapshot().items.every(i=>i.data));
    assert.equal(await page.evaluate(()=>errorEncodes),0);
    const snapshot=await page.evaluate(()=>getAnalysisSnapshot());
    assert.equal(snapshot.items[0].data.pixelCount,snapshot.source.width*snapshot.source.height);
    await page.evaluate(()=>holdComparisonRendering());
    await page.locator('.cell .format-select').first().selectOption('jpeg');
    assert.equal(await page.locator('.analysis-chart').first().isVisible(),false,'old graph clears while conversion is pending');
    await page.evaluate(()=>resumeComparisonRendering());await ready();
    await page.waitForFunction(()=>document.querySelector('.analysis-card').dataset.state==='ready'&&getAnalysisSnapshot().items[0].data?.metrics.maeRGB>0);
    assert.ok((await page.locator('.analysis-chart').first().getAttribute('aria-label')).includes('MAE RGB'));
    assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
    console.log('PASS offline error chart, exact zero, alpha controls, no chart-triggered encoding and stale-result invalidation');
  }finally{await context.close();await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
