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
  page.setDefaultTimeout(30000);
  page.on('pageerror',error=>errors.push(error.message));
  page.on('request',request=>{if(/^https?:/.test(request.url()))requests.push(request.url());});
  try{
    await context.setOffline(true);
    await page.goto(pathToFileURL(require('./support/viewer-path.cjs')()).href);
    await page.locator('#studyOpen').click();
    await page.locator('#referenceSampleSelect').selectOption('gradient');
    await page.locator('#referenceSampleCreate').click();
    await page.waitForFunction(()=>app.source?.name==='ifl-gradient-v1.png'&&!app.sourceLoading&&app.layout===4&&app.variants.slice(0,4).every(isVariantReady));
    assert.equal(await page.locator('#studyDialog').isVisible(),false);
    assert.deepEqual(await page.evaluate(()=>app.variants.map(v=>v.config.format)),['original','jpeg','webp','png']);
    if(process.env.IMAGE_TEST_LOGS){const folder=artifacts.folder(process.env.IMAGE_TEST_LOGS);fs.mkdirSync(folder,{recursive:true});await page.screenshot({path:path.join(folder,artifacts.runId+'-reference-sample.png')});}
    await page.locator('#studyOpen').click();
    const [download]=await Promise.all([page.waitForEvent('download'),page.locator('#reportProtocol').click()]);
    assert.equal(download.suggestedFilename(),'experiment-protocol.json');
    const chunks=[];for await(const chunk of await download.createReadStream())chunks.push(chunk);
    const protocol=JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const hash=await page.evaluate(async()=>{const digest=await crypto.subtle.digest('SHA-256',await app.source.file.arrayBuffer());return [...new Uint8Array(digest)].map(v=>v.toString(16).padStart(2,'0')).join('');});
    assert.equal(protocol.input.sha256,hash);
    assert.equal(protocol.input.name,'ifl-gradient-v1.png');
    assert.equal(protocol.comparison.layout,4);
    assert.deepEqual(protocol.comparison.variants.map(v=>v.format),['original','jpeg','webp','png']);
    assert.equal(protocol.analysis.settings.scope,'viewport');
    assert.equal(protocol.observations.length,4);
    assert.ok(protocol.observations.every(v=>v.status==='ready'&&Number.isFinite(v.metrics.bytes)));
    assert.ok(protocol.observations.every(v=>/^[0-9a-f]{64}$/.test(v.sha256)));
    assert.equal(protocol.observations[0].sha256,protocol.input.sha256);
    assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
    console.log('PASS offline generated reference sample, matching preset, exact source hash and complete protocol download');
  }finally{await context.close();await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
