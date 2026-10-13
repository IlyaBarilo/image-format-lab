const assert=require('node:assert/strict'),fs=require('node:fs');
(async()=>{
 const core=await import('../src/core/diagnostics.mjs');
 const {packDiagnostics,unpackDiagnostics}=await import('../src/core/diagnostic-transport.mjs');
 const {DIAGNOSTIC_CASES}=await import('../src/services/diagnostic-tests.mjs');
 const reference=JSON.parse(fs.readFileSync('src/diagnostic-reference.json','utf8'));
 assert.equal(reference.version,core.DIAGNOSTIC_VERSION);
 assert.deepEqual([...Object.keys(reference.tests),...reference.informational].sort(),[...DIAGNOSTIC_CASES].sort());
 const pixels=core.diagnosticPixels(16),before=pixels.data.slice();
 assert.deepEqual(core.diagnosticDifference(pixels,pixels),{psnr:Infinity,alpha:0,changed:0,max:0});
 const other={...pixels,data:pixels.data.slice()};other.data[0]++;
 const diff=core.diagnosticDifference(pixels,other);assert.equal(diff.changed,1);assert.ok(diff.psnr>100);
 assert.deepEqual(pixels.data,before);
 const iconInput=core.diagnosticPixels(),iconData=new Uint8ClampedArray(256*256*4);
 for(let row=0;row<32;row++)iconData.set(iconInput.data.subarray(row*128,(row+1)*128),((112+row)*256+112)*4);
 const icon={...iconInput,width:256,height:256,data:iconData};
 assert.equal(await core.diagnosticPixelHash(icon),reference.tests.ico.pixelHash);
 assert.equal(await core.diagnosticPixelHash({...icon,colorSpace:'unknown'}),reference.tests.ico.pixelHash);
 iconData[(112*256+112)*4]++;assert.notEqual(await core.diagnosticPixelHash(icon),reference.tests.ico.pixelHash);
 assert.equal(await core.diagnosticHash(new Blob(['abc'])),'ungWv48Bz-o');
 const grid={channels:[new Uint32Array([0,1,2])],count:3},owned=grid.channels[0].slice();
 const gridHash=await core.diagnosticDataHash(grid);assert.equal(await core.diagnosticDataHash(grid),gridHash);assert.deepEqual(grid.channels[0],owned);
 grid.channels[0][1]++;assert.notEqual(await core.diagnosticDataHash(grid),gridHash);
 assert.equal(core.diagnosticByteLength('Я\n'),3);
 const events=[];for(let i=0;i<100;i++)core.recordDiagnosticEvent(events,'error','C:/PRIVATE/'+i+'.png');
 assert.equal(events.length,6);assert.ok(!JSON.stringify(events).includes('PRIVATE'));
 const registry=core.diagnosticLibraries(JSON.parse(fs.readFileSync('vendor/components.json','utf8')).components);
 const report={release:'v0.1.2.3',build:'f'.repeat(32),state:'source',environment:core.diagnosticEnvironment({userAgent:'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/26.6.2 Safari/605.1.15'},{Worker(){},createImageBitmap(){},crypto:{subtle:{}},OffscreenCanvas(){},devicePixelRatio:2,location:{protocol:'file:'}}),libraries:registry,codecs:['modern=r','jpeg2000=e','upng=r','gifenc=r','utif=r','heic=r'],
  source:[99999,400,999999999,'uint16',16,'unknown','straight',1,1,'bitmap','99999,99999,99999,99999','f'.repeat(11),'f'.repeat(11)],view:'4/1/panorama/errorProfile/delta/viewport/alpha/black/255/99999,99999,99999,99999/99999,99999,99999,99999/'+Array(4).fill('99999,99999,99999,99999').join(';')+'/float16/123456.12345/123456.12345/123456.12345/batch-running/100,1000,400,65535,65535,24',actual:['heic=1.23.4/1.1.2','utif=3.2.0'],
  batch:'tiff/black/cmyk/16/deflate/9/1/99999/99999/999999/100/panorama/files/999',cells:[0,1,2,3].map(i=>({index:i+1,status:'ready',config:core.diagnosticConfig({format:'tiff',matte:'black',colorMode:'cmyk',tiffDepth:'16',tiffCompression:'deflate',tiffLevel:9,tiffPredictor:true}),numbers:[999999999,99999,99999,123.12345,100,99999999],paths:'libheif/bitmap',hashes:['f'.repeat(11),'f'.repeat(11)]})),
  tests:DIAGNOSTIC_CASES.map(id=>core.evaluateDiagnosticTest({id,bytes:628,psnr:Infinity,alpha:0,changed:0,max:0,...reference.tests[id]},reference.tests[id],reference.informational.includes(id))),events,verdict:'OK checked paths'};
 const readable=core.formatDiagnostics(report),text=packDiagnostics(readable);const size=core.diagnosticByteLength(text);
 assert.equal(unpackDiagnostics(text),readable);
 console.log('Largest fixed-schema case:',size,'bytes');assert.ok(size<=core.DIAGNOSTIC_LIMIT);assert.ok(core.diagnosticByteLength(text.replaceAll('\n','\r\n'))<=core.DIAGNOSTIC_LIMIT);
 assert.equal(readable.split('\n').filter(line=>/^(PASS|INFO) /.test(line)).length,DIAGNOSTIC_CASES.length);
 assert.match(text,/RESULT OK/);assert.ok(!text.includes('PRIVATE'));
 const altered=core.evaluateDiagnosticTest({id:'photo-a85',values:{...reference.tests['photo-a85'].values,b:39308},...Object.fromEntries(Object.entries(reference.tests['photo-a85']).filter(([key])=>key!=='values'))},reference.tests['photo-a85']);
 assert.equal(altered.status,'FAIL');assert.deepEqual(altered.differences,[{key:'b',expected:39307,actual:39308}]);assert.match(core.diagnosticTestLine(altered),/b=39308.*D:b/);
 const failed={...report,tests:report.tests.map(test=>test.id===altered.id?altered:test),verdict:'DIFFERENCES tests=1 current=0'};
 assert.ok(core.diagnosticByteLength(packDiagnostics(core.formatDiagnostics(failed)).replaceAll('\n','\r\n'))<=core.DIAGNOSTIC_LIMIT);
 const graph=core.evaluateDiagnosticTest({id:'scopes',values:{...reference.tests.scopes.values,hWave:'z'.repeat(11)},inputHash:reference.tests.scopes.inputHash},reference.tests.scopes);
 assert.equal(graph.status,'FAIL');assert.deepEqual(graph.differences.map(d=>d.key),['hWave']);assert.ok(core.diagnosticTestLine(graph).includes('w'+'z'.repeat(11)));
 const worker=reference.tests['metric-worker'].values;assert.equal(worker.delta,0);assert.equal(worker.bpp,400);assert.equal(worker.display,'46.37');assert.ok(Math.abs(worker.P-10*Math.log10(255**2/(9/6)))<0.00001);
 assert.deepEqual(reference.tests['sample-float'].values,{low:224,high:896});
 assert.equal(reference.tests['sample-alpha'].values.low,61600);assert.equal(reference.tests['sample-alpha'].values.high,20640);assert.equal(reference.tests['sample-alpha'].values.line,127.5);
 assert.equal(reference.tests['print-tiff'].values.over,'41528,28976,27656');assert.equal(reference.tests['print-jpeg'].values.lostK,0);
 console.log('PASS pixel checks, ownership, reference coverage, privacy codes and complete UTF-8 report budget');
})().catch(e=>{console.error(e);process.exitCode=1;});
