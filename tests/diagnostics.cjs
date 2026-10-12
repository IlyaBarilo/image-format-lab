const assert=require('node:assert/strict'),fs=require('node:fs');
(async()=>{
 const core=await import('../src/core/diagnostics.mjs');
 const {DIAGNOSTIC_CASES}=await import('../src/services/diagnostic-tests.mjs');
 const reference=JSON.parse(fs.readFileSync('src/diagnostic-reference.json','utf8'));
 assert.equal(reference.version,core.DIAGNOSTIC_VERSION);
 assert.deepEqual([...Object.keys(reference.tests),...reference.informational].sort(),[...DIAGNOSTIC_CASES].sort());
 const pixels=core.diagnosticPixels(16),before=pixels.data.slice();
 assert.deepEqual(core.diagnosticDifference(pixels,pixels),{psnr:Infinity,alpha:0,changed:0,max:0});
 const other={...pixels,data:pixels.data.slice()};other.data[0]++;
 const diff=core.diagnosticDifference(pixels,other);assert.equal(diff.changed,1);assert.ok(diff.psnr>100);
 assert.deepEqual(pixels.data,before);
 assert.equal(await core.diagnosticHash(new Blob(['abc'])),'ungWv48Bz-o');
 assert.equal(core.diagnosticByteLength('Я\n'),3);
 const events=[];for(let i=0;i<100;i++)core.recordDiagnosticEvent(events,'error','C:/PRIVATE/'+i+'.png');
 assert.equal(events.length,6);assert.ok(!JSON.stringify(events).includes('PRIVATE'));
 const registry=core.diagnosticLibraries(JSON.parse(fs.readFileSync('vendor/components.json','utf8')).components);
 const report={release:'v0.1.2.3',build:'f'.repeat(32),state:'source',environment:core.diagnosticEnvironment({userAgent:'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/26.6.2 Safari/605.1.15'},{Worker(){},createImageBitmap(){},crypto:{subtle:{}},OffscreenCanvas(){},devicePixelRatio:2,location:{protocol:'file:'}}),libraries:registry,codecs:['modern=r','jpeg2000=e','upng=r','gifenc=r','utif=r','heic=r'],
  source:[99999,400,999999999,'uint16',16,'unknown','straight',1,1,'bitmap','99999,99999,99999,99999','f'.repeat(11),'f'.repeat(11)],view:'4/1/panorama/errorProfile/delta/viewport/alpha/black/255/99999,99999,99999,99999/99999,99999,99999,99999/'+Array(4).fill('99999,99999,99999,99999').join(';')+'/float16/123456.12345/123456.12345/123456.12345/batch-running/100,1000,400,65535,65535,24',actual:['heic=1.23.4/1.1.2','utif=3.2.0'],
  batch:'tiff/black/cmyk/16/deflate/9/1/99999/99999/999999/100/panorama/files/999',cells:[0,1,2,3].map(i=>({index:i+1,status:'ready',config:core.diagnosticConfig({format:'tiff',matte:'black',colorMode:'cmyk',tiffDepth:'16',tiffCompression:'deflate',tiffLevel:9,tiffPredictor:true}),numbers:[999999999,99999,99999,123.12345,100,99999999],paths:'libheif/bitmap',hashes:['f'.repeat(11),'f'.repeat(11)]})),
  tests:DIAGNOSTIC_CASES.map(id=>({id,bytes:999999,psnr:123.12345,alpha:100,changed:6291456,max:100,fileHash:'f'.repeat(11),pixelHash:'f'.repeat(11),mismatch:true})),events,verdict:'DIFFERENCES tests=34 current=1'};
 const text=core.formatDiagnostics(report);const size=core.diagnosticByteLength(text);
 console.log('Largest fixed-schema case:',size,'bytes');assert.ok(size<=core.DIAGNOSTIC_LIMIT);assert.ok(core.diagnosticByteLength(text.replaceAll('\n','\r\n'))<=core.DIAGNOSTIC_LIMIT);
 assert.equal(text.split('\n').filter(line=>DIAGNOSTIC_CASES.some(id=>line.startsWith(id+'* '))).length,34);
 assert.match(text,/RESULT DIFFERENCES/);assert.ok(!text.includes('PRIVATE'));
 console.log('PASS pixel checks, ownership, reference coverage, privacy codes and complete UTF-8 report budget');
})().catch(e=>{console.error(e);process.exitCode=1;});
