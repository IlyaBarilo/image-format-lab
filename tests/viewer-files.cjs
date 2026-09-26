const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

const url = pathToFileURL(require('./support/viewer-path.cjs')()).href;
let failures = 0;
async function ready(page, name) {
  await page.waitForFunction(name => app.source?.name === name && !app.sourceLoading &&
    app.files.find(f => f.id === app.selectedFileId)?.status === 'ready' &&
    app.variants.filter(v => !v.cell.classList.contains('hidden')).every(isVariantReady), name);
}
async function snapshot(page) {
  return page.evaluate(() => ({
    names: app.files.map(f => f.name), selected: app.files.find(f => f.id === app.selectedFileId)?.name || null,
    source: app.source?.name || null, statuses: app.files.map(f => f.status),
    dimensions: app.files.map(f => [f.width, f.height]), count: els.fileCount.textContent,
    current: document.querySelectorAll('.file-select[aria-current="true"]').length,
    outputs: app.variants.filter(v => !v.cell.classList.contains('hidden')).map(v => v.resultSource?.name || null)
  }));
}

(async () => {
  const {SAMPLE_CATALOG} = await import('../src/core/reference-samples.mjs');
  const browser = await chromium.launch({ headless: true,
    ...(process.env.IMAGE_TEST_BROWSER ? { executablePath: process.env.IMAGE_TEST_BROWSER } : {}) });
  console.log(`Chromium ${browser.version()}`);
  try {
    const fixturePage = await browser.newPage();
    const data = await fixturePage.evaluate(() => [8, 12, 16].map(width => {
      const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = width / 2;
      const ctx = canvas.getContext('2d'); ctx.fillStyle = `rgb(${width * 10},50,150)`; ctx.fillRect(0,0,width,width);
      return canvas.toDataURL().split(',')[1];
    }));
    await fixturePage.close();
    const files = data.map((buffer, i) => ({ name: ['first.png', 'second.png', 'third.png'][i],
      mimeType: 'image/png', buffer: Buffer.from(buffer, 'base64') }));
    const other = { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('not an image') };

    async function check(name, run) {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, acceptDownloads: false });
      page.setDefaultTimeout(10000);
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      try {
        await page.goto(url);
        await run(page);
        assert.deepEqual(errors, []);
        console.log('PASS ' + name);
      } catch (error) { failures++; console.error(`FAIL ${name}: ${error.stack}`); }
      finally { await page.close(); }
    }

    await check('multiple input, lazy decoding and automatically opening a single addition', async page => {
      await page.locator('#fileInput').setInputFiles([files[0], files[1], other]);
      await ready(page, 'first.png');
      assert.deepEqual(await snapshot(page), { names: ['first.png','second.png'], selected:'first.png', source:'first.png',
        statuses:['ready','idle'], dimensions:[[8,4],[null,null]], count:'2', current:1, outputs:['first.png','first.png'] });
      await page.evaluate(() => { window.previousSource = app.source; window.previousOutput = app.variants[1].blob; });
      await page.locator('#fileInput').setInputFiles(files[2]);
      await ready(page, 'third.png');
      assert.equal(await page.evaluate(() => previousSource !== app.source && previousOutput !== app.variants[1].blob), true);
      assert.equal(await page.locator('#fileInput').inputValue(), '');
      assert.equal((await snapshot(page)).count, '3');
    });

    await check('view drop opens the first added image, skips other types and reveals a hidden list', async page => {
      await page.locator('#fileInput').setInputFiles(files[0]); await ready(page, 'first.png');
      await page.locator('#toggleFiles').click();
      assert.equal(await page.locator('#filePanel').isVisible(), false);
      const payload = [files[1],files[2],other].map(f => ({name:f.name, type:f.mimeType, bytes:[...f.buffer]}));
      await page.evaluate(payload => {
        const dt = new DataTransfer();
        for (const f of payload) dt.items.add(new File([new Uint8Array(f.bytes)],f.name,{type:f.type}));
        document.dispatchEvent(new DragEvent('dragover',{bubbles:true,dataTransfer:dt}));
        document.dispatchEvent(new DragEvent('drop',{bubbles:true,dataTransfer:dt}));
      },payload);
      assert.equal(await page.locator('#filePanel').isVisible(), true);
      assert.equal(await page.locator('#toggleFiles').getAttribute('aria-expanded'), 'true');
      assert.deepEqual((await snapshot(page)).names, files.map(f => f.name));
      await ready(page, 'second.png');
      assert.equal((await snapshot(page)).source, 'second.png');
      assert.equal(await page.locator('#viewDropHint').isVisible(), false);
      assert.equal(await page.locator('#fileDropHint').isVisible(), false);
      assert.match(await page.locator('#status').textContent(), /Пропущено.*1/);
    });

    await check('list drop appends several files without replacing the source, then opens a single addition', async page => {
      await page.locator('#fileInput').setInputFiles(files[0]); await ready(page, 'first.png');
      async function intoList(items) {
        await page.evaluate(payload => {
          const dt = new DataTransfer();
          for (const file of payload) dt.items.add(new File([new Uint8Array(file.bytes)], file.name, { type: file.type }));
          const list = document.querySelector('#fileList');
          list.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
          if (document.querySelector('#fileDropHint').hidden || !document.querySelector('#viewDropHint').hidden) throw new Error('Wrong drop hint');
          list.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
        }, items.map(file => ({ name: file.name, type: file.mimeType, bytes: [...file.buffer] })));
      }
      await intoList([files[1], files[2]]);
      assert.equal((await snapshot(page)).source, 'first.png');
      await intoList([files[2]]); await ready(page, 'third.png');
      assert.deepEqual((await snapshot(page)).names, ['first.png', 'second.png', 'third.png', 'third.png']);
      assert.equal(await page.locator('#filePanel #sampleImage').count(), 1);
      assert.equal(await page.locator('.appbar #sampleImage').count(), 0);
    });

    await check('switch keeps comparison settings and downloads the selected source and result', async page => {
      await page.locator('#fileInput').setInputFiles(files); await ready(page, 'first.png');
      await page.locator('#layout4').click();
      await page.locator('#backgroundSelect').selectOption('red');
      await page.locator('#metadataPolicy').selectOption('none');
      await page.locator('.format-select').nth(3).selectOption('gif');
      await page.evaluate(() => {
        const v = app.variants[1]; v.controls.quality.value = '37'; v.controls.quality.dispatchEvent(new Event('input'));
        const gif = app.variants[3]; gif.controls.gifColors.value = '7'; gif.controls.gifColors.dispatchEvent(new Event('change'));
        window.configSnapshot = JSON.stringify(app.variants.map(v => v.config));
      });
      await page.locator('.file-select').nth(1).click(); await ready(page, 'second.png');
      const result = await page.evaluate(() => {
        const downloads = [], original = HTMLAnchorElement.prototype.click;
        HTMLAnchorElement.prototype.click = function () { downloads.push(this.download); };
        try { downloadVariant(app.variants[0]); downloadVariant(app.variants[1]); }
        finally { HTMLAnchorElement.prototype.click = original; }
        return { settings: JSON.stringify(app.variants.map(v => v.config)) === configSnapshot,
          layout:app.layout, auto:captureComparison().autoApply, background:app.background, metadata:els.metadataPolicy.value,
          outputs:app.variants.map(v => [v.resultSource.name,v.imageData.width]), downloads };
      });
      assert.deepEqual(result,{settings:true,layout:4,auto:true,background:'red',metadata:'none',
        outputs:Array(4).fill(['second.png',12]),downloads:['second.png','second-2.jpg']});
      await page.locator('#previousFile').click(); await ready(page,'first.png');
      assert.equal(await page.evaluate(() => JSON.stringify(app.variants.map(v => v.config)) === configSnapshot),true);
    });

    await check('keyboard and previous/next controls preserve focus and stop at list ends', async page => {
      await page.locator('#fileInput').setInputFiles(files); await ready(page,'first.png');
      assert.equal(await page.locator('#previousFile').isDisabled(),true);
      await page.locator('.file-select').first().focus();
      await page.keyboard.press('ArrowDown'); await ready(page,'second.png');
      assert.equal(await page.locator('.file-select').nth(1).evaluate(el => el === document.activeElement),true);
      await page.keyboard.press('End'); await ready(page,'third.png');
      assert.equal(await page.locator('#nextFile').isDisabled(),true);
      await page.keyboard.press('ArrowDown');
      assert.equal((await snapshot(page)).selected,'third.png');
      await page.keyboard.press('Home'); await ready(page,'first.png');
      await page.locator('#nextFile').click(); await ready(page,'second.png');
      assert.equal((await snapshot(page)).current,1);
    });

    await check('remove inactive, current, last and then add the same file again', async page => {
      await page.locator('#fileInput').setInputFiles(files); await ready(page,'first.png');
      await page.evaluate(() => { window.savedSource = app.source; window.savedBlob = app.variants[1].blob; });
      await page.locator('.file-remove').nth(2).click();
      assert.equal(await page.evaluate(() => savedSource === app.source && savedBlob === app.variants[1].blob),true);
      await page.locator('.file-remove').first().click(); await ready(page,'second.png');
      await page.locator('.file-remove').first().click();
      assert.deepEqual((await snapshot(page)).names,[]);
      assert.equal((await snapshot(page)).source,null);
      assert.equal(await page.locator('#emptyState').isVisible(),true);
      assert.equal(await page.evaluate(() => app.fileRows.size === 0 && app.variants.every(v => !v.blob && !v.bitmap && v.controls.download.disabled)),true);
      await page.locator('#fileInput').setInputFiles(files[1]); await ready(page,'second.png');
    });

    await check('a corrupt file is marked, can be retried, and does not prevent opening its neighbor', async page => {
      const corrupt = {name:'broken.png',mimeType:'image/png',buffer:Buffer.from('broken')};
      await page.locator('#fileInput').setInputFiles([corrupt,files[1]]);
      await page.waitForFunction(() => app.files[0]?.status === 'error');
      assert.equal((await snapshot(page)).source,null);
      assert.match(await page.locator('.file-row.error').textContent(),/повтора/);
      await page.evaluate(() => {
        const original = decodeSourceFile; window.retryCount = 0;
        decodeSourceFile = async (...args) => { retryCount++; return original(...args); };
      });
      await page.locator('.file-select').first().click();
      await page.waitForFunction(() => retryCount === 1 && app.files[0].status === 'error');
      await page.locator('#nextFile').click(); await ready(page,'second.png');
      assert.equal((await snapshot(page)).statuses[0],'error');
    });

    await check('late decode completion and failure cannot overwrite a newer selection of the same row', async page => {
      await page.locator('#fileInput').setInputFiles(files); await ready(page,'first.png');
      const result = await page.evaluate(async () => {
        const real = decodeSourceFile;
        const [a,b] = app.files;
        try {
          await selectFile(b.id);
          let release;
          decodeSourceFile = async file => {
            const source = await real(file);
            if (file === a.file) await new Promise(resolve => {release=resolve;});
            return source;
          };
          const old = selectFile(a.id);
          while (!release) await new Promise(resolve => setTimeout(resolve,0));
          const blocked = app.source === null && app.variants.every(v => !v.blob && v.controls.download.disabled) &&
            els.emptyState.style.display !== 'none';
          decodeSourceFile = real;
          await selectFile(b.id); await selectFile(a.id);
          const fresh = app.source; release(); await old;
          const same = app.source === fresh;
          await selectFile(b.id);
          let reject;
          decodeSourceFile = file => file === a.file ? new Promise((_,fail) => {reject=fail;}) : real(file);
          const failing = selectFile(a.id);
          await selectFile(b.id); reject(new Error('delayed old failure')); await failing;
          return {same,blocked,selected:app.selectedFileId,expected:b.id,source:app.source.name,
            status:b.status, errors:app.files.some(f => f.status === 'error'), consistent:app.variants.slice(0,2).every(v => v.resultSource === app.source)};
        } finally {decodeSourceFile = real;}
      });
      assert.deepEqual(result,{same:true,blocked:true,selected:result.expected,expected:result.expected,source:'second.png',status:'ready',errors:false,consistent:true});
    });

    await check('remove or clear during decoding cannot restore removed files or old output', async page => {
      await page.locator('#fileInput').setInputFiles(files); await ready(page,'first.png');
      const result = await page.evaluate(async () => {
        const real = decodeSourceFile;
        try {
          const b = app.files[1]; let release;
          decodeSourceFile = async file => {
            const source = await real(file);
            if (file === b.file) await new Promise(resolve => {release=resolve;});
            return source;
          };
          const pending = selectFile(b.id);
          while (!release) await new Promise(resolve => setTimeout(resolve,0));
          removeFile(b.id); release(); await pending;
          while (app.sourceLoading) await new Promise(resolve => setTimeout(resolve,0));
          const neighbor = app.source.name;
          let finish; const a=app.files[0];
          decodeSourceFile = async file => { const source=await real(file); await new Promise(resolve=>{finish=resolve;}); return source; };
          const clearing=selectFile(a.id);
          while (!finish) await new Promise(resolve => setTimeout(resolve,0));
          clearFiles(); finish(); await clearing;
          return {neighbor, files:app.files.length, rows:app.fileRows.size, selected:app.selectedFileId,
            source:app.source, loading:app.sourceLoading, disabled:app.variants.every(v=>v.controls.download.disabled),
            empty:els.emptyState.style.display !== 'none'};
        } finally {decodeSourceFile=real;}
      });
      assert.deepEqual(result,{neighbor:'third.png',files:0,rows:0,selected:null,source:null,loading:false,disabled:true,empty:true});
    });

    await check('clear during encoding revokes completed URLs and discards pending results', async page => {
      await page.locator('#fileInput').setInputFiles(files);
      await page.waitForFunction(() => app.source?.name === 'first.png' && !app.sourceLoading &&
        app.variants.slice(0, 2).every(isVariantReady), null, { timeout: 30000 });
      const result = await page.evaluate(async () => {
        const real=encodeFromSource, realRevoke=URL.revokeObjectURL;
        const urls=app.variants.map(v=>v.url).filter(Boolean), revoked=[];
        let release;
        URL.revokeObjectURL=url=>{revoked.push(url);realRevoke.call(URL,url);};
        encodeFromSource=async (...args)=>{const result=await real(...args); await new Promise(resolve=>{release=resolve;}); return result;};
        try {
          const pending=renderVariant(app.variants[1]);
          while (!release) await new Promise(resolve=>setTimeout(resolve,0));
          clearFiles(); release(); await pending;
          return {revoked:urls.every(url=>revoked.includes(url)), clean:app.variants.every(v=>!v.url&&!v.blob&&!v.bitmap&&!v.processing), source:app.source};
        } finally {encodeFromSource=real;URL.revokeObjectURL=realRevoke;}
      });
      assert.deepEqual(result,{revoked:true,clean:true,source:null});
    });

    await check('sample uses the list and a pending sample respects clear', async page => {
      await page.locator('#fileInput').setInputFiles(files[0]); await ready(page,'first.png');
      await page.locator('#sampleImage').click();
      await page.waitForFunction(()=>app.files.length===2);
      const sampleName=(await snapshot(page)).names[1];
      await ready(page,sampleName);
      assert.equal((await snapshot(page)).source,sampleName);
      await page.evaluate(()=>{
        const real=createSampleFile;
        createSampleFile=async ()=>{const file=await real();await new Promise(resolve=>{window.finishSample=resolve;});return file;};
      });
      await page.locator('#sampleImage').click();
      await page.waitForFunction(()=>Boolean(window.finishSample));
      await page.locator('#clearFiles').click(); await page.evaluate(()=>finishSample());
      await page.waitForFunction(()=>!els.sampleImage.disabled);
      assert.deepEqual((await snapshot(page)).names,[]);
    });

    await check('sample menu describes each example and opens a precise TIFF16 file', async page => {
      await page.locator('#sampleMenuToggle').focus();
      await page.keyboard.press('ArrowDown');
      assert.equal(await page.locator('#sampleMenuToggle').getAttribute('aria-expanded'),'true');
      const menuItems=await page.locator('#sampleMenu .sample-menu-item').evaluateAll(items=>items.map(item=>({id:item.dataset.sampleId,text:item.textContent})));
      assert.deepEqual(menuItems.map(item=>item.id),SAMPLE_CATALOG.map(item=>item.id));
      for(const [index,item] of menuItems.entries()){
        assert.ok(item.text.includes(SAMPLE_CATALOG[index].label),`Образец ${item.id}: название`);
        assert.ok(item.text.includes(SAMPLE_CATALOG[index].description),`Образец ${item.id}: описание`);
      }
      assert.equal(await page.locator('#sampleMenu .sample-menu-item').first().evaluate(element=>element===document.activeElement),true);
      assert.match(await page.locator('#sampleMenu').textContent(),/младшими разрядами/);
      for (const width of [1440, 390]) {
        await page.setViewportSize({width,height:1000});
        const bounds=await page.evaluate(()=>{
          const panel=document.getElementById('filePanel').getBoundingClientRect();
          const menu=document.getElementById('sampleMenu').getBoundingClientRect();
          const buttons=document.querySelector('.file-add-actions').getBoundingClientRect();
          return {panelLeft:panel.left,panelRight:panel.right,menuLeft:menu.left,menuRight:menu.right,menuTop:menu.top,buttonsBottom:buttons.bottom};
        });
        assert.ok(bounds.menuLeft>=bounds.panelLeft && bounds.menuRight<=bounds.panelRight && bounds.menuTop>=bounds.buttonsBottom,bounds);
      }
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('#sampleMenuToggle').getAttribute('aria-expanded'),'false');
      await page.locator('#sampleMenuToggle').click();
      await page.locator('#sampleMenu [data-sample-id="tiff16"]').click();
      await page.waitForFunction(() => app.source?.name==='ifl-tiff16-v1.tif' &&
        app.source.pixelBuffer?.bitDepth===16 && !app.sourceLoading, null, {timeout:60000});
      assert.equal(await page.evaluate(() => app.source.pixelBuffer.data[4]%257!==0),true);
      assert.equal((await snapshot(page)).names[0],'ifl-tiff16-v1.tif');
      await page.locator('#sampleMenuToggle').click();
      await page.locator('#sampleMenu [data-sample-id="gradient"]').click();
      await page.waitForFunction(() => app.source?.name==='ifl-gradient-v1.png' && !app.sourceLoading, null, {timeout:60000});
      assert.deepEqual((await snapshot(page)).names,['ifl-tiff16-v1.tif','ifl-gradient-v1.png']);
      await page.locator('#sampleMenuToggle').click();
      await page.locator('#sampleMenu [data-sample-id="iccP3"]').click();
      await page.waitForFunction(() => app.source?.name==='ifl-p3-icc16-v1.png' && !app.sourceLoading, null, {timeout:60000});
      assert.equal(await page.evaluate(() => app.source.pixelBuffer.bitDepth),16);
      assert.equal(await page.evaluate(() => app.source.iccProfile?.length),416);
      assert.deepEqual((await snapshot(page)).names,['ifl-tiff16-v1.tif','ifl-gradient-v1.png','ifl-p3-icc16-v1.png']);
    });

    await check('long names are safe text, many rows scroll and responsive panels remain usable', async page => {
      const longName='<img src=x onerror=alert(1)>_'+'длинное имя '.repeat(15)+'.png';
      await page.locator('#fileInput').setInputFiles(Array.from({length:30},(_,i)=>({...files[0],name:i===0?longName:`image-${i}.png`})));
      await page.waitForFunction(()=>app.files[0].status==='ready');
      assert.equal(await page.locator('#fileList img').count(),0);
      for (const width of [1440,1100,768,390]) {
        await page.setViewportSize({width,height:1000});
        const layout=await page.evaluate(()=>{
          const list=els.fileList.getBoundingClientRect(),stage=document.querySelector('.stage').getBoundingClientRect();
          return {overflow:document.documentElement.scrollWidth>innerWidth,listWidth:list.width,listHeight:list.height,
            scrollable:els.fileList.scrollHeight>els.fileList.clientHeight,stageWidth:stage.width};
        });
        assert.equal(layout.overflow,false,`overflow at ${width}`);
        assert.ok(layout.listWidth>150 && layout.listHeight>60 && layout.stageWidth>150,JSON.stringify(layout));
        if(width<=1080)assert.ok(layout.listHeight>=120,'wrapped source information must leave a usable file list: '+JSON.stringify(layout));
        assert.equal(layout.scrollable,true);
      }
      const footer=page.locator('.cell').nth(1).locator('.cell-foot');
      await footer.scrollIntoViewIfNeeded();
      const bounds=await footer.boundingBox();
      assert.ok(bounds.y>=0 && bounds.y+bounds.height<=1000,'mobile page must scroll to the second comparison footer');
      await page.locator('.file-select').first().focus(); await page.keyboard.press('End');
      await ready(page,'image-29.png');
      assert.ok(await page.locator('#fileList').evaluate(el=>el.scrollTop)>0);
      await page.locator('#toggleFiles').click();
      assert.equal(await page.locator('#filePanel').isVisible(),false);
      await page.locator('#toggleFiles').click();
      assert.equal((await snapshot(page)).selected,'image-29.png');
    });
  } finally { await browser.close(); }
  if (failures) process.exitCode=1;
})().catch(error => {console.error(error);process.exitCode=1;});
