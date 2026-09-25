const assert = require('node:assert/strict');
const { chunk, png, segment, jpeg, exif } = require('./support/passport-fixtures.cjs');

(async () => {
  const core = await import('../src/core/file-passport.mjs');
  const { inspectFile, fileBitsPerPixel, workingRasterInfo } = core;
  const parse = (bytes, options) => inspectFile(new Blob([bytes], { type: 'image/wrong' }), options);
  const srgb = chunk('sRGB', [0]);
  for (const [type, depth] of [[0,1],[0,16],[2,8],[2,16],[3,2],[4,16],[6,8],[6,16]]) {
    const before = type === 3 ? [chunk('PLTE', [255,0,0,0,255,0]), chunk('tRNS', [0,128])] : [srgb];
    const bytes = png({ type, depth, before }), info = await parse(bytes);
    assert.equal(info.status, 'ok'); assert.equal(info.format, 'PNG'); assert.equal(info.colorType, type); assert.equal(info.bitDepth, depth);
    assert.deepEqual([info.width, info.height], [3,2]); assert.equal(info.bpp, bytes.length / 6 * 8);
    assert.equal(info.paletteEntries, type === 3 ? 2 : null);
    assert.equal(info.transparency, [4,6].includes(type) ? 'alpha' : type === 3 ? 'tRNS' : 'none');
    assert.deepEqual(info.metadata, { icc: 'absent', exif: 'absent', xmp: 'absent' });
  }
  const iccp = chunk('iCCP', [112,0,0,1,2,3]); // Presence only; no inflater is invoked.
  const xmp = chunk('iTXt', Buffer.from('XML:com.adobe.xmp\0\0\0\0\0<x/>'));
  const metadata = await parse(png({ interlace: 1, before: [iccp], after: [xmp, chunk('eXIf', exif)] }));
  assert.equal(metadata.status, 'ok'); assert.equal(metadata.interlace, 1);
  assert.deepEqual(metadata.metadata, { icc: 'present', exif: 'present', xmp: 'present' });
  assert.equal((await parse(png({ type: 0, before: [chunk('tRNS', [0,0])] }))).transparency, 'tRNS');
  assert.equal((await parse(png({ before: [chunk('gAMA', [0,0,177,143]), chunk('cHRM', Buffer.alloc(32))] }))).colorLabels.join(','), 'gAMA,cHRM');
  const badCRC = png(); badCRC[29] ^= 1; assert.equal((await parse(badCRC)).status, 'invalid');
  for (const bytes of [png().subarray(0, -1), png({ type: 3 }), png({ depth: 3 }), png({ before: [chunk('PLTE', [1])] }), png({ after: [srgb] }), png({ before: [srgb, srgb] }), png({ before: [chunk('iCCP', [0,0,1])] })]) {
    const info = await parse(bytes); assert.equal(info.status, 'invalid'); assert.equal(info.metadata.xmp, 'unknown');
  }
  const unsupported = await parse(png({ before: [chunk('ABCD')] })); assert.equal(unsupported.status, 'partial'); assert.equal(unsupported.metadata.icc, 'unknown');
  assert.equal((await parse(png({ before: [chunk('acTL', Buffer.alloc(8))] }))).status, 'partial');
  console.log('PASS PNG signatures, packed/16-bit/palette/alpha/interlace, late metadata, CRC and malformed structure');

  for (const [sampling, label] of [[[0x11,0x11,0x11], '4:4:4'], [[0x21,0x11,0x11], '4:2:2'], [[0x22,0x11,0x11], '4:2:0']]) {
    const info = await parse(jpeg({ sampling })); assert.equal(info.status, 'ok'); assert.equal(info.sampling, label);
    assert.equal(info.colorModel, 'YCbCr'); assert.equal(info.progressive, false); assert.deepEqual([info.width, info.height, info.bitDepth], [16,8,8]);
  }
  const progressive = await parse(jpeg({ mode: 194, scans: 3 })); assert.equal(progressive.status, 'ok'); assert.equal(progressive.progressive, true);
  const unknown = await parse(jpeg({ jfif: false })); assert.equal(unknown.colorModel, 'Не определено'); assert.equal(unknown.sampling, null);
  assert.equal((await parse(jpeg({ jfif: false, adobe: 1 }))).sampling, '4:2:0');
  assert.equal((await parse(jpeg({ jfif: false, adobe: 0, ids: [82,71,66], sampling: [17,17,17] }))).colorModel, 'RGB');
  assert.equal((await parse(jpeg({ adobe: 0 }))).colorModel, 'Не определено');
  assert.equal((await parse(jpeg({ jfif: false, adobe: 0, ids: [67,77,89,75], sampling: [17,17,17,17] }))).colorModel, 'CMYK');
  assert.equal((await parse(jpeg({ ids: [1], sampling: [17] }))).colorModel, 'Серый');
  assert.equal((await parse(jpeg({ depth: 12, mode: 193 }))).bitDepth, 12);
  assert.equal((await parse(jpeg({ depth: 16, mode: 195 }))).bitDepth, 16);
  assert.equal((await parse(jpeg({ height: 0, dnl: 9 }))).height, 9);
  assert.equal((await parse(jpeg({ height: 0 }))).status, 'partial');
  const icc = (part, count) => segment(226, Buffer.concat([Buffer.from('ICC_PROFILE\0'), Buffer.from([part,count,7])]));
  const jpegMetadata = await parse(jpeg({ before: [icc(2,2)], after: [segment(225, Buffer.concat([Buffer.from('Exif\0\0'),exif])), segment(225, Buffer.from('http://ns.adobe.com/xap/1.0/\0<x/>')), icc(1,2)] }));
  assert.equal(jpegMetadata.status, 'ok'); assert.deepEqual(jpegMetadata.metadata, { icc:'present', exif:'present', xmp:'present' });
  assert.match((await parse(jpeg({ before: [icc(1,2)] }))).notes.join(' '), /не все части/);
  for (const bytes of [jpeg().subarray(0,-1), jpeg({ depth:16 }), jpeg({ ids:[1,1,3] }), jpeg({ sampling:[0,17,17] }), jpeg({ before: [icc(1,2),icc(1,2)] }), Buffer.from([255,216,255,225,255,255])]) assert.equal((await parse(bytes)).status, 'invalid');
  const entropy = Buffer.alloc(150000); for (let n = 0; n < entropy.length; n += 3) entropy[n] = 255;
  const escaped = jpeg({ entropy }); const many = await parse(escaped); assert.equal(many.status, 'ok'); assert.ok(many.readBytes < escaped.length + 2 * 65536, 'cache reads entropy once, not once per escape');
  const tail = await parse(Buffer.concat([jpeg(), Buffer.from([1,2,3])])); assert.match(tail.notes[0], /3 байт/);
  console.log('PASS baseline/progressive JPEG, exact factors vs colour assumptions, DNL, multi-scan metadata and byte stuffing');

  assert.equal(fileBitsPerPixel(100, 10, 20), 4); assert.equal(fileBitsPerPixel(100,0,20), null); assert.equal(fileBitsPerPixel(-1,10,20), null);
  const { createPixelBuffer } = await import('../src/core/pixel-buffer.mjs');
  const pixels = createPixelBuffer({ width:2, height:1, data:new Uint16Array(8), sampleType:'uint16' });
  const desc = workingRasterInfo(pixels); assert.equal(desc.byteLength,16); assert.equal(desc.bitDepth,16); assert.equal('data' in desc,false);
  assert.equal(workingRasterInfo(null),null); assert.throws(() => workingRasterInfo({ ...pixels, data:new Uint8Array(8) }));
  const limited = await parse(escaped, { readBytes:128 }); assert.equal(limited.status,'partial'); assert.equal(limited.metadata.exif,'unknown'); assert.ok(limited.readBytes <=128);
  assert.equal((await parse(png(), { entries:1 })).status,'partial');
  assert.equal((await parse(Buffer.from('not a PNG'))).format,null);
  let resolveRead; const aborter = new AbortController();
  const pending = inspectFile({ size:8, slice:() => ({ arrayBuffer:() => new Promise(resolve => { resolveRead=resolve; }) }) }, { signal:aborter.signal });
  aborter.abort(); resolveRead(new ArrayBuffer(8)); await assert.rejects(pending, { name:'AbortError' });
  const big = 256 * 1024 * 1024, initial = png().subarray(0,33), idat = Buffer.alloc(8); idat.writeUInt32BE(big); idat.write('IDAT',4);
  const final = chunk('IEND'), end = 33 + 12 + big, total = end + final.length; let largestRead=0;
  const sparse = { size:total, slice:(start,stop) => ({ arrayBuffer:async() => {
    largestRead=Math.max(largestRead,stop-start); const out=Buffer.alloc(stop-start);
    for (const [at,part] of [[0,initial],[33,idat],[end,final]]) { const from=Math.max(start,at),to=Math.min(stop,at+part.length); if(from<to)part.copy(out,from-start,from-at,to-at); }
    return out.buffer.slice(out.byteOffset,out.byteOffset+out.byteLength);
  } }) };
  const sparseInfo=await inspectFile(sparse); assert.equal(sparseInfo.status,'ok'); assert.ok(sparseInfo.readBytes<=2*65536); assert.ok(largestRead<=65536);
  console.log('PASS bpp vs working memory, budgets, cancellation and skipping a large PNG payload without allocation');

  if (process.env.IMAGE_TEST_PYTHON) {
    const python = require('node:child_process').spawnSync(process.env.IMAGE_TEST_PYTHON, ['-c', `
import base64, io, json
from PIL import Image
out=[]
for subsampling in (0,1,2):
 for progressive in (False,True):
  image=Image.new('RGB',(19,11),(25,120,230)); stream=io.BytesIO()
  image.save(stream,format='JPEG',subsampling=subsampling,progressive=progressive,icc_profile=b'profile-marker-only')
  out.append(dict(data=base64.b64encode(stream.getvalue()).decode(),format='JPEG',sampling=('4:4:4','4:2:2','4:2:0')[subsampling],progressive=progressive))
for mode in ('RGB','RGBA','P','I;16'):
 image=Image.new(mode,(19,11)); stream=io.BytesIO()
 if mode=='P':
  image.putpalette([channel for value in range(256) for channel in (value,255-value,value//2)])
  image.save(stream,format='PNG',bits=8)
 else: image.save(stream,format='PNG')
 out.append(dict(data=base64.b64encode(stream.getvalue()).decode(),format='PNG',mode=mode))
print(json.dumps(out))
`], { encoding:'utf8', maxBuffer:1024*1024 });
    assert.equal(python.status,0,python.stderr || python.error?.message);
    for (const item of JSON.parse(python.stdout)) {
      const info=await parse(Buffer.from(item.data,'base64')); assert.equal(info.status,'ok',info.notes.join(' '));
      assert.equal(info.format,item.format);assert.deepEqual([info.width,info.height],[19,11]);
      if(item.format==='JPEG'){assert.equal(info.sampling,item.sampling);assert.equal(info.progressive,item.progressive);assert.equal(info.metadata.icc,'present');}
      else {assert.equal(info.bitDepth,item.mode==='I;16'?16:8);assert.equal(info.colorType,{RGB:2,RGBA:6,P:3,'I;16':0}[item.mode]);}
    }
    console.log('PASS independent Pillow JPEG baseline/progressive 444/422/420 and PNG RGB/RGBA/palette/16-bit');
  }

  class Element {
    constructor(){this.children=[];this.events=new Map();this.attrs={};this.open=false;this.value='';this.text='';this.disabled=false;}
    set textContent(v){this.text=String(v);this.children=[];} get textContent(){return this.text+this.children.map(c=>c.textContent).join('');}
    append(...nodes){this.children.push(...nodes);} replaceChildren(...nodes){this.children=nodes;this.text='';}
    setAttribute(k,v){this.attrs[k]=String(v);} addEventListener(k,f){this.events.set(k,f);} emit(k){this.events.get(k)?.({target:this});}
    showModal(){this.open=true;} close(){this.open=false;this.emit('close');}
  }
  const elements=new Map(), get=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};
  global.document={getElementById:get,createElement:()=>new Element()};
  const file=new Blob([png({width:2,height:1,depth:16})],{type:'image/png'}), blob=new Blob([jpeg()]);
  const app={source:{file,pixelBuffer:pixels,name:'source.png'},sourceGeneration:1,layout:2,variants:[]};
  app.variants=[0,1].map(index=>({index,config:{format:index?'jpeg':'original'},resultConfig:{format:index?'jpeg':'original'},generation:0,
    blob:index?blob:file,pixelBuffer:pixels,url:'blob:result',resultSource:app.source,controls:{},foot:new Element()}));
  let reads=[];
  const {createFilePassport}=await import('../src/ui/file-passport.mjs');
  const {createControls}=await import('../src/ui/controls.mjs');
  const deps={...core,formatBytes:n=>String(n),outputFormatLabel:f=>f,updateAnalysis(){},updatePixelInspector(){},
    inspectFile:(b,o)=>new Promise((resolve,reject)=>reads.push({b,o,resolve,reject})),encodeFromSource(){throw new Error('must not encode');}};
  const controls=createControls({app,els:{}},deps), ui=createFilePassport({app},deps); Object.assign(deps,ui,controls);
  app.variants.forEach(v=>controls.buildMetrics(v));
  assert.equal(reads.length,0); app.variants[1].controls.fileInfo.emit('click');
  assert.equal(get('filePassportDialog').open,true); assert.equal(reads[0].b,blob);
  get('filePassportTarget').value='source';get('filePassportTarget').emit('change');
  assert.equal(reads[0].o.signal.aborted,true); assert.equal(reads[1].b,file);
  const tick=async()=>{await new Promise(resolve=>setImmediate(resolve));};
  reads[0].resolve(await parse(jpeg()));await tick();assert.doesNotMatch(get('filePassportFields').textContent,/Тип кодирования/);
  reads[1].resolve(await inspectFile(file));await tick(); assert.match(get('filePassportFields').textContent,/16 бит/);assert.match(get('filePassportRaster').textContent,/16 байт/);
  const readCount=reads.length;ui.updateFilePassport();assert.equal(reads.length,readCount);
  get('filePassportDialog').close();app.variants[0].controls.fileInfo.emit('click');assert.equal(reads.length,readCount,'completed Blob is cached');
  get('filePassportTarget').value='1';get('filePassportTarget').emit('change');
  controls.markDirty(app.variants[1],{schedule:false});assert.equal(reads.at(-1).o.signal.aborted,true);assert.match(get('filePassportStatus').textContent,/Дождитесь/);assert.equal(get('filePassportFields').textContent,'');
  app.variants[1].error='fail';controls.updateMetrics(app.variants[1]);assert.match(get('filePassportStatus').textContent,/Ошибка обработки/);
  reads.at(-1).resolve(await parse(jpeg()));await tick();assert.equal(get('filePassportFields').textContent,'');
  app.variants[1].dirty=false;app.variants[1].error=null;controls.updateMetrics(app.variants[1]);
  const failed=reads.at(-1);get('filePassportDialog').close();failed.reject(new Error('late'));await tick();assert.equal(get('filePassportStatus').textContent,'');
  ui.openFilePassport(app.variants[1]);app.source={...app.source,name:'next.png',file:new Blob([png()])};app.sourceGeneration++;ui.updateFilePassport();
  assert.match(get('filePassportStatus').textContent,/Дождитесь/);assert.equal(get('filePassportFields').textContent,'');
  app.source=null;ui.updateFilePassport();assert.match(get('filePassportStatus').textContent,/Откройте/);assert.equal(get('filePassportRaster').textContent,'');
  console.log('PASS on-demand UI, source/output identity, cache, cancellation, stale success/error, source changes and no encoding');
})().catch(error=>{console.error(error);process.exitCode=1;});
