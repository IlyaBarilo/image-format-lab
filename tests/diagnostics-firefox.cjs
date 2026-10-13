const assert=require('node:assert/strict'),fs=require('node:fs'),crypto=require('node:crypto');
(async()=>{
  const core=await import('../src/core/diagnostics.mjs');
  const {packDiagnostics,unpackDiagnostics}=await import('../src/core/diagnostic-transport.mjs');
  const {pixelBufferFromImageData}=await import('../src/core/pixels.mjs');
  const {createPixelBuffer}=await import('../src/core/pixel-buffer.mjs');
  const {DIAGNOSTIC_CASES}=await import('../src/services/diagnostic-tests.mjs');
  const reference=JSON.parse(fs.readFileSync('src/diagnostic-reference.json','utf8'));
  const previous=global.ImageData;
  try{
    global.ImageData=class {constructor(data,width,height){this.data=data;this.width=width;this.height=height;}};
    const image=new ImageData(new Uint8ClampedArray([25,50,100,255]),1,1);
    assert.equal(pixelBufferFromImageData(image).colorSpace,'srgb');
    assert.equal(pixelBufferFromImageData({...image}).colorSpace,'unknown');
    assert.equal(createPixelBuffer({width:1,height:1,data:image.data}).colorSpace,'unknown');
    image.colorSpace='display-p3';assert.equal(pixelBufferFromImageData(image).colorSpace,'display-p3');
  }finally{if(previous===undefined)delete global.ImageData;else global.ImageData=previous;}
  const pixels=core.diagnosticPixels();
  assert.equal(await core.diagnosticPixelHash(pixels),await core.diagnosticPixelHash({...pixels,colorSpace:'unknown'}));
  const changed={...pixels,data:pixels.data.slice()};changed.data[0]^=1;
  assert.notEqual(await core.diagnosticPixelHash(pixels),await core.diagnosticPixelHash(changed));
  const graph={channels:[new Uint32Array([1,2,3])],colorSpace:{source:'srgb',result:'srgb'},colorComparison:'same-code-values'};
  const other={...graph,colorSpace:{source:'unknown',result:'unknown'},colorComparison:'unknown-code-values'};
  assert.equal(await core.diagnosticDataHash(graph),await core.diagnosticDataHash(other));
  const altered={...graph,channels:[new Uint32Array([1,2,4])]};assert.notEqual(await core.diagnosticDataHash(graph),await core.diagnosticDataHash(altered));
  const metadata=core.evaluateDiagnosticTest({id:'test',pixelHash:'same',colors:'unknown/srgb'},{pixelHash:'same',colors:'srgb/srgb'});
  assert.equal(metadata.status,'INFO');assert.equal(metadata.differences.length,0);assert.equal(metadata.metadataDifferences.length,1);
  const hash=id=>crypto.createHash('sha256').update(id).digest().subarray(0,8).toString('base64url');
  const tests=DIAGNOSTIC_CASES.map(id=>{
    const expected=reference.tests[id],test={id,bytes:9999999,psnr:123.12345,alpha:100,changed:9999999,max:100,...structuredClone(expected??{})};
    for(const key of ['fileHash','pixelHash','inputHash'])if(test[key]&&test[key]!=='-')test[key]=hash(id+key);
    for(const key of ['bytes','psnr','alpha','changed','max'])if(expected&&key in expected)test[key]=expected[key]==='inf'?100.12345:expected[key]+1;
    if(!expected)test.pixelHash=hash(id+'pixels');
    for(const [key,value]of Object.entries(test.values??{}))test.values[key]=/^h[A-Z]/.test(key)?hash(id+key):typeof value==='number'?value+1:value;
    if(test.colors)test.colors='unknown/unknown';
    return core.evaluateDiagnosticTest(test,expected,reference.informational.includes(id));
  });
  const report={release:'v0.1.2.3',build:'f'.repeat(32),state:'source',environment:'Firefox/157.0;mac/10.15.7;W1B1C1O1;DPR=2;file',libraries:core.diagnosticLibraries(JSON.parse(fs.readFileSync('vendor/components.json','utf8')).components),codecs:['modern=e','jpeg2000=e','upng=e','gifenc=e','utif=e','heic=e'],actual:['utif=3.2.0','heic=1.23.4/1.1.2'],
    source:['png',99999,400,999999999,'uint16',16,'unknown','straight',1,1,'bitmap','99999,99999,99999,99999',hash('source-file'),hash('source-pixels')],
    view:'4/1/panorama/errorProfile/delta/viewport/alpha/black/255/99999,99999,99999,99999/99999,99999,99999,99999/'+Array(4).fill('99999,99999,99999,99999').join(';')+'/float16/123456.12345/123456.12345/123456.12345/batch-running/100,1000,400,65535,65535,24',
    batch:'tiff/black/cmyk/16/deflate/9/1/99999/99999/999999/100/panorama/files/999',
    cells:[1,2,3,4].map(index=>({index,status:'ready',config:'tiff/black/cmyk/16/deflate/9/1',numbers:[999999999,99999,99999,123.12345,100,99999999],paths:'libheif/bitmap',hashes:[hash(index+'file'),hash(index+'pixels')]})),tests,
    issues:['source','cell1','cell2','cell3','cell4','codec','session','version-jpeg'].map(id=>({id,detail:'error:'+hash(id)})),events:Array.from({length:6},(_,i)=>['error','codec:'+hash('event'+i).slice(0,8)]),verdict:'DIFFERENCES tests=50 current=7 versions=1'};
  const readable=core.formatDiagnostics(report),packed=packDiagnostics(readable);
  const bytes=core.diagnosticByteLength(packed.replaceAll('\n','\r\n'));
  console.log('All mismatches, four cells, large parameters and eight issues:',bytes,'bytes');
  assert.ok(bytes<=4000);assert.equal(unpackDiagnostics(packed),readable);assert.equal(unpackDiagnostics(packed.replaceAll('\n','\r\n')),readable);
  assert.equal(readable.split('\n').filter(line=>DIAGNOSTIC_CASES.some(id=>line.startsWith('FAIL '+id+' ')||line.startsWith('INFO '+id+' ')||line.startsWith('PASS '+id+' '))).length,DIAGNOSTIC_CASES.length);
  for(const test of tests)for(const [key,value]of Object.entries(test.values??{}))if(/^h[A-Z]/.test(key))assert.ok(readable.includes(value));
  assert.throws(()=>unpackDiagnostics(packed.replace('v0.1.2.3','v9')),/Заголовок/);
  assert.throws(()=>unpackDiagnostics('IFL-D3 local\nRESULT OK\nENV test\nPACK z85d1:9:xyz\n'));
  assert.throws(()=>unpackDiagnostics(packDiagnostics('IFL-D3 local\nRESULT OK\nENV test\n'+'x'.repeat(70000))),/слишком велик/);
  assert.equal(unpackDiagnostics('IFL-D2 local\nRESULT OK\nENV old\n'),'IFL-D2 local\nRESULT OK\nENV old\n');
  assert.equal(reference.tests['photo-png'].values.b,478394);assert.equal(reference.tests['photo-j85'].values.P,39.36663);assert.equal(reference.tests['photo-a85'].values.P,41.33034);
  console.log('PASS absent Firefox colour API, unknown files, separate metadata, strict raw counts and lossless complete report');
})().catch(error=>{console.error(error);process.exitCode=1;});
