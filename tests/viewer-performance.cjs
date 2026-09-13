const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({headless:true, executablePath:process.env.IMAGE_TEST_BROWSER || undefined});
  try {
    const page = await browser.newPage();
    await page.goto(pathToFileURL(require('./support/viewer-path.cjs')()).href);
    const session = await page.context().newCDPSession(page);
    const before = await session.send('Runtime.getHeapUsage');
    const result = await page.evaluate(async () => {
      const canvas = document.createElement('canvas'); canvas.width = 2048; canvas.height = 1024;
      const ctx = canvas.getContext('2d'); const pixels = ctx.createImageData(canvas.width, canvas.height);
      let seed = 97;
      for(let i=0;i<pixels.data.length;i+=4) {
        seed=(Math.imul(seed,1664525)+1013904223)>>>0;
        pixels.data.set([seed&255,seed>>>8&255,seed>>>16&255,255],i);
      }
      ctx.putImageData(pixels,0,0);
      const source={canvas,width:canvas.width,height:canvas.height,imageData:pixels,hasAlpha:false};
      let last=performance.now(),maxGap=0,ticks=0;
      const timer=setInterval(()=>{const now=performance.now();maxGap=Math.max(maxGap,now-last);last=now;ticks++;},10);
      await new Promise(r=>setTimeout(r,30));
      const start=performance.now();
      const encoded=await encodeFromSource({...DEFAULT_EXPORT_CONFIG,format:'gif'},source);
      const elapsed=performance.now()-start;
      await new Promise(r=>setTimeout(r,30));clearInterval(timer);
      const decoded=await decodeVariantForPreview(encoded.blob);decoded.bitmap.close();
      return {width:source.width,height:source.height,rgbaBytes:pixels.data.byteLength,encodedBytes:encoded.blob.size,
        elapsedMs:Math.round(elapsed),maxTimerGapMs:Math.round(maxGap),timerTicks:ticks,
        decodedWidth:decoded.imageData.width,worker:typeof app.computeWorker!=='undefined'&&Boolean(app.computeWorker)};
    });
    const after = await session.send('Runtime.getHeapUsage');
    console.log(JSON.stringify({browser:browser.version(),...result,heapBefore:before,heapAfter:after,
      limitation:'Single synthetic 2MP GIF run; heap snapshot is not peak browser/GPU memory.'},null,2));
  } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exitCode=1;});
