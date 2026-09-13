const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { pathToFileURL } = require('node:url'), { chromium } = require('playwright');
const artifacts = require('./support/artifacts.cjs');
const root = path.resolve(__dirname,'..'), folder = path.join(__dirname,'fixtures/tiff');
const manifest = JSON.parse(fs.readFileSync(path.join(folder,'manifest.json')));
const url = pathToFileURL(require('./support/viewer-path.cjs')()).href;
function probe({ failFirst = false } = {}) {
  const NativeBlob=Blob, NativeWorker=Worker, create=URL.createObjectURL.bind(URL), revoke=URL.revokeObjectURL.bind(URL);
  const blobs=new WeakSet(), urls=new Set();
  globalThis.tiffWorkers=[]; globalThis.tiffRevoked=[]; globalThis.dropTiffDecode=false;
  globalThis.Blob=class extends NativeBlob { constructor(parts,options) {
    super(parts,options); if (parts?.some(part => typeof part==='string' && part.includes('ViewerJpegModule'))) blobs.add(this);
  }};
  URL.createObjectURL=blob=>{const url=create(blob); if(blobs.has(blob)) urls.add(url);return url;};
  URL.revokeObjectURL=url=>{if(urls.has(url)) tiffRevoked.push(url);return revoke(url);};
  let failed=false;
  globalThis.Worker=class extends NativeWorker {
    constructor(url,options) {
      const tiff=urls.has(url);
      if(tiff && failFirst && !failed) {failed=true;throw new Error('Test TIFF Worker startup failure');}
      super(url,options);
      this.record=tiff?{url,terminated:false}:null;
      if(this.record) tiffWorkers.push(this.record);
      this.addEventListener('message',({data})=>{if(this.record && data.type==='ready')this.record.jpegVersion=data.jpegVersion;});
    }
    postMessage(data,...rest) {
      if(this.record && data?.type==='decode' && dropTiffDecode) {dropTiffDecode=false;return;}
      return super.postMessage(data,...rest);
    }
    terminate(){if(this.record)this.record.terminated=true;return super.terminate();}
  };
}
(async()=>{
  const browser=await chromium.launch({headless:true,executablePath:process.env.IMAGE_TEST_BROWSER||undefined});
  const report={browser:browser.version(),cases:[],checks:[],externalRequests:[],errors:[]};
  try {
    const context=await browser.newContext(); await context.setOffline(true); await context.addInitScript(probe);
    const page=await context.newPage();page.setDefaultTimeout(60000);
    context.on('request',r=>{if(r.url()!==url&&!/^(blob:|data:)/.test(r.url()))report.externalRequests.push(r.url());});
    page.on('pageerror',error=>report.errors.push(error.message));
    await page.goto(url);await page.waitForFunction(()=>document.getElementById('codecStatus').dataset.state==='ready');
    for(const item of manifest.cases){
      await page.evaluate(()=>clearFiles());
      await page.locator('#fileInput').setInputFiles({name:item.file,mimeType:'image/tiff',buffer:fs.readFileSync(path.join(folder,item.file))});
      await page.waitForFunction(name=>app.source?.name===name&&!app.sourceLoading,item.file);
      const result=await page.evaluate(reference=>{
        const expected=new Uint8Array(UPNG.toRGBA8(UPNG.decode(new Uint8Array(reference).buffer))[0]);
        const actual=app.source.imageData.data;let max=0;
        if(actual.length!==expected.length)throw new Error('TIFF RGBA length mismatch');
        for(let i=0;i<actual.length;i++)max=Math.max(max,Math.abs(actual[i]-expected[i]));
        return {width:app.source.width,height:app.source.height,max};
      },[...fs.readFileSync(path.join(folder,item.expected))]);
      assert.deepEqual([result.width,result.height],[item.width,item.height]);assert.ok(result.max<=1,item.name+': '+result.max);
      report.cases.push({name:item.name,...result});
    }
    const good=fs.readFileSync(path.join(folder,'baseline.tiff'));
    const oversized=Buffer.from(good), count=oversized.readUInt16LE(8);
    for(let i=0;i<count;i++){const at=10+i*12;if([256,257].includes(oversized.readUInt16LE(at)))oversized.writeUInt32LE(10000,at+8);}
    for(const [name,bad] of [['truncated',good.subarray(0,20)],['corrupt-jpeg',good.subarray(0,good.length-20)],['oversized',oversized]]){
      const result=await page.evaluate(async({bad,good})=>{
        let error;try{await decodeTiffFile(new File([new Uint8Array(bad)],'bad.tiff'));}catch(e){error=e.message;}
        const recovered=await decodeTiffFile(new File([new Uint8Array(good)],'good.tiff'));
        return {error,dimensions:[recovered.width,recovered.height]};
      },{bad:[...bad],good:[...good]});
      assert.ok(result.error,name);assert.deepEqual(result.dimensions,[37,23]);report.checks.push(name+': '+result.error);
    }
    const queued=await page.evaluate(async bytes=>{
      const file=new File([new Uint8Array(bytes)],'queued.tiff');
      const results=await Promise.all([decodeTiffFile(file),decodeTiffFile(file),decodeTiffFile(file)]);
      let error;try{await decodeTiffFile({size:256*1024*1024+1,arrayBuffer(){throw new Error('must not read');}});}catch(e){error=e.message;}
      return {dimensions:results.map(v=>[v.width,v.height]),error,workers:tiffWorkers,revoked:tiffRevoked};
    },[...good]);
    assert.deepEqual(queued.dimensions,[[37,23],[37,23],[37,23]]);assert.match(queued.error,/256/);
    assert.ok(queued.workers.length>=manifest.cases.length+9);
    assert.ok(queued.workers.every(v=>v.terminated&&v.jpegVersion==='3.2.0'&&queued.revoked.includes(v.url)));
    report.checks.push('queued operations, input limit, every used TIFF Worker terminated and Blob URL revoked');
    const timed=await page.evaluate(async bytes=>{
      const original=setTimeout;globalThis.setTimeout=(fn,ms,...args)=>original(fn,ms===120000?30:ms,...args);
      let error;try{dropTiffDecode=true;await decodeTiffFile(new File([new Uint8Array(bytes)],'timeout.tiff'));}catch(e){error=e.message;}
      finally{globalThis.setTimeout=original;}
      const ok=await decodeTiffFile(new File([new Uint8Array(bytes)],'recovery.tiff'));return {error,width:ok.width};
    },[...good]);
    assert.match(timed.error,/время декодирования TIFF/);assert.equal(timed.width,37);report.checks.push('decode watchdog terminates stalled Worker and next operation recovers');
    await page.evaluate(async bytes=>{const decoded=await decodeTiffFile(new File([new Uint8Array(bytes)],'weak.tiff'));globalThis.tiffWeak=new WeakRef(decoded.imageData.data.buffer);},[...good]);
    const devtools=await context.newCDPSession(page);await devtools.send('HeapProfiler.collectGarbage');await devtools.send('HeapProfiler.collectGarbage');
    assert.equal(await page.evaluate(()=>tiffWeak.deref()===undefined),true);await devtools.detach();
    report.checks.push('settled queue does not retain unreferenced result pixels');
    await context.close();
    const failed=await browser.newContext();await failed.setOffline(true);await failed.addInitScript(probe,{failFirst:true});
    const retry=await failed.newPage();retry.on('pageerror',error=>report.errors.push(error.message));
    await retry.goto(url);await retry.waitForFunction(()=>document.getElementById('codecStatus').dataset.state==='error');
    await retry.locator('#retryCodecs').click();await retry.waitForFunction(()=>document.getElementById('codecStatus').dataset.state==='ready');
    await retry.locator('#fileInput').setInputFiles({name:'recovered.tiff',mimeType:'image/tiff',buffer:good});
    await retry.waitForFunction(()=>app.source?.name==='recovered.tiff');
    report.checks.push('TIFF startup failure exposes retry and recovers through the public button');await failed.close();
    assert.deepEqual(report.externalRequests,[]);assert.deepEqual(report.errors,[]);report.passed=true;
  }finally{await browser.close();}
  if(process.env.IMAGE_TEST_LOGS){const output=artifacts.folder(process.env.IMAGE_TEST_LOGS);fs.mkdirSync(output,{recursive:true});fs.writeFileSync(path.join(output,artifacts.runId+'-tiff.json'),JSON.stringify(report,null,2)+'\n');}
  console.log(JSON.stringify(report,null,2));
})().catch(error=>{console.error(error);process.exitCode=1;});
