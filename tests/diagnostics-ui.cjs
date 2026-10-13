const assert=require('node:assert/strict'),fs=require('node:fs'),{buildSync}=require('../scripts/node_modules/esbuild');
(async()=>{
 const bundle=buildSync({entryPoints:['src/ui/diagnostics.mjs'],bundle:true,write:false,format:'cjs',platform:'node'}).outputFiles[0].text;
 const module={exports:{}};new Function('exports','module',bundle)(module.exports,module);const {createDiagnostics}=module.exports;
 const {DIAGNOSTIC_CASES}=await import('../src/services/diagnostic-tests.mjs');
 const {createPixelBuffer}=await import('../src/core/pixel-buffer.mjs');
 const reference=JSON.parse(fs.readFileSync('src/diagnostic-reference.json','utf8'));
 const libraries=JSON.parse(fs.readFileSync('vendor/components.json','utf8'));
 const pixels=createPixelBuffer({width:1,height:1,data:new Uint8ClampedArray([20,40,60,255]),colorSpace:'srgb'});
 global.document={getElementById:id=>id==='embedded-codecs'?{textContent:JSON.stringify({components:libraries,buildId:'e'.repeat(32),releaseTag:'v0.1.2'})}:{textContent:'{}'}};
 const app={source:null,sourceLoading:false,codecs:{},codecPromises:{},codecAttempts:{},variants:[],layout:2,view:{zoom:1,centerX:0,centerY:0}};
 let tests=DIAGNOSTIC_CASES.map(id=>({id,bytes:100,psnr:Infinity,alpha:0,changed:0,max:0,...reference.tests[id]}));
 let versions={heic:{version:'1.23.4',decoder:'1.1.2'},utif:{jpegVersion:'3.2.0'}};
 const controller=createDiagnostics({app,els:{metadataPolicy:{value:'none'}}},{isVariantReady:v=>v.ready,getAnalysisSnapshot:()=>({settings:{type:'histogram',scope:'viewport',display:'overlay'}}),runDiagnosticTests:async()=>Object.defineProperty(structuredClone(tests),'codecInfo',{value:structuredClone(versions)})});
 let result=await controller.diagnosticReport();assert.match(result.report.verdict,/^OK/);assert.ok(result.fits);
 app.source={file:new File(['fixture'],'PERSONAL_FILE.png',{type:'image/png'}),name:'PERSONAL_FILE.png',width:1,height:1,size:7,pixelBuffer:pixels,decodingPath:'png-js'};
 app.variants=[0,1,2,3].map(i=>({index:i,ready:true,resultConfig:{format:'avif',matte:'white',quality:85,avifSpeed:6},config:{format:'avif'},measurement:{bytes:7,width:1,height:1,psnrRGB:40,alphaErrorPercent:0,processingMs:25},blob:new Blob(['fixture']),pixelBuffer:pixels,encodingPath:'libheif',decodingPath:'libheif'}));
 const before=app.variants.map(v=>v.blob);
 result=await controller.diagnosticReport();assert.ok(result.fits);assert.equal(result.report.cells.length,4);assert.ok(!result.readableText.includes('PERSONAL'));assert.deepEqual(app.variants.map(v=>v.blob),before);
 versions.heic.decoder='1.1.2-test';result=await controller.diagnosticReport();assert.match(result.report.verdict,/versions=1/);versions.heic.decoder='1.1.2';
 tests.find(t=>t.id==='avif').fileHash='0'.repeat(11);result=await controller.diagnosticReport();assert.match(result.report.verdict,/^DIFFERENCES/);assert.match(result.readableText,/FAIL avif/);assert.ok(result.readableText.includes('H:f'+'0'.repeat(11)));assert.equal(result.report.tests.find(t=>t.id==='avif').differences[0].key,'fileHash');
 tests=DIAGNOSTIC_CASES.map(id=>({id,error:'cancel'}));result=await controller.diagnosticReport();assert.equal(result.report.verdict,'INCOMPLETE');assert.equal(result.report.tests.length,DIAGNOSTIC_CASES.length);assert.match(result.readableText,/SKIP photo-j85/);
 tests=DIAGNOSTIC_CASES.map(id=>({id,error:'unsupported'}));result=await controller.diagnosticReport();assert.match(result.report.verdict,/^DIFFERENCES/);assert.ok(result.fits);
 const broken=createDiagnostics({app,els:{}},{isVariantReady:v=>v.ready,runDiagnosticTests:async()=>{throw new Error('C:/PERSONAL_FILE broken');}});
 result=await broken.diagnosticReport();assert.equal(result.report.tests.length,DIAGNOSTIC_CASES.length);assert.match(result.report.verdict,/^DIFFERENCES/);assert.ok(!result.readableText.includes('PERSONAL'));
 tests=DIAGNOSTIC_CASES.map(id=>({id,bytes:100,psnr:Infinity,alpha:0,changed:0,max:0,...reference.tests[id]}));
 tests.find(t=>t.id==='photo-a85').values.b++;
 result=await controller.diagnosticReport();assert.match(result.readableText,/FAIL photo-a85 .*b=39308.*D:b/);assert.equal(result.report.tests.find(t=>t.id==='photo-a85').status,'FAIL');
 app.diagnosticEvents=[['error','timeout:12345678']];result=await controller.diagnosticReport();assert.ok(result.report.issues.some(issue=>issue.id==='session'));assert.match(result.readableText,/FAIL session error:timeout/);
 class Element {
   constructor(id){this.id=id;this.listeners={};this.children=[];this.dataset={};this.value='';this.textContent='';this.hidden=false;this.disabled=false;}
   addEventListener(name,fn){this.listeners[name]=fn;}
   appendChild(child){this.children.push(child);}
   replaceChildren(){this.children=[];}
   showModal(){this.open=true;}
   close(){this.open=false;this.listeners.close?.();}
   focus(){document.activeElement=this;}
   select(){this.selected=true;}
   async click(){return this.listeners.click?.({currentTarget:this});}
 }
 const payload=document.getElementById('embedded-codecs'),nodes=new Map();
 global.document={activeElement:null,getElementById:id=>id==='embedded-codecs'?payload:id==='embedded-samples'?{textContent:'{}'}:(nodes.get(id)??(nodes.set(id,new Element(id)),nodes.get(id))),createElement:name=>new Element(name),execCommand:()=>false};
 let clipboard='',opened='';Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async value=>{clipboard=value;}}});global.open=url=>{opened=url;return null;};
 const ui=createDiagnostics({app,els:{}},{isVariantReady:v=>v.ready,runDiagnosticTests:async({progress})=>{assert.equal(document.getElementById('diagnosticSummary').dataset.state,'pending');progress('metrics',0,DIAGNOSTIC_CASES.length);assert.equal(document.getElementById('diagnosticBar').value,0);progress(null,DIAGNOSTIC_CASES.length,DIAGNOSTIC_CASES.length);return structuredClone(tests);}});
 ui.attachDiagnosticEvents();await document.getElementById('diagnosticOpen').click();
 assert.equal(document.getElementById('diagnosticBar').value,DIAGNOSTIC_CASES.length);
 assert.ok(document.getElementById('diagnosticOutput').children.some(row=>row.dataset.status==='FAIL'&&row.textContent.includes('photo-a85')));
 assert.ok(document.getElementById('diagnosticDetails').children.some(row=>row.textContent.includes('ожидалось 39307, получено 39308')));
 assert.equal(document.getElementById('diagnosticSend').disabled,false);
 assert.equal(document.getElementById('diagnosticSummary').dataset.state,'different');assert.equal(document.getElementById('diagnosticVerdict').textContent,'Есть ошибки или расхождения');assert.match(document.getElementById('diagnosticCounts').textContent,/в тестах: 1 · замечаний состояния: 1/);
 const summaryText=document.getElementById('diagnosticVerdict').textContent;
 await document.getElementById('diagnosticSend').click();assert.equal(opened,'https://forms.yandex.ru/u/6acd565e5057b2a2063f9016/');assert.equal(clipboard,document.getElementById('diagnosticText').value);
 assert.equal(document.getElementById('diagnosticVerdict').textContent,summaryText);
 navigator.clipboard.writeText=async()=>{throw new Error('blocked');};await document.getElementById('diagnosticCopy').click();assert.equal(document.getElementById('diagnosticText').hidden,false);assert.equal(document.getElementById('diagnosticText').selected,true);assert.match(document.getElementById('diagnosticProgress').textContent,/Ctrl\+C/);
 document.getElementById('diagnosticDialog').close();assert.equal(document.activeElement,document.getElementById('diagnosticOpen'));
 function validTests(){const current=JSON.parse(fs.readFileSync('src/diagnostic-reference.json','utf8'));return DIAGNOSTIC_CASES.map(id=>({id,bytes:100,psnr:Infinity,alpha:0,changed:0,max:0,...current.tests[id]}));}
 app.diagnosticEvents=[];tests=validTests();await document.getElementById('diagnosticOpen').click();
 assert.equal(document.getElementById('diagnosticSummary').dataset.state,'ok');assert.equal(document.getElementById('diagnosticVerdict').textContent,'Все тесты пройдены');assert.ok(document.getElementById('diagnosticCounts').textContent.includes(`Завершено ${DIAGNOSTIC_CASES.length} из ${DIAGNOSTIC_CASES.length} · ошибок/расхождений в тестах: 0`));
 document.getElementById('diagnosticDialog').close();tests=DIAGNOSTIC_CASES.map(id=>({id,error:'cancel'}));await document.getElementById('diagnosticOpen').click();
 assert.equal(document.getElementById('diagnosticSummary').dataset.state,'incomplete');assert.equal(document.getElementById('diagnosticVerdict').textContent,'Проверка не завершена');assert.ok(document.getElementById('diagnosticCounts').textContent.includes(`пропущено: ${DIAGNOSTIC_CASES.length}`));
 document.getElementById('diagnosticDialog').close();tests[0]={id:'metrics',error:'timeout'};await document.getElementById('diagnosticOpen').click();
 assert.equal(document.getElementById('diagnosticSummary').dataset.state,'different');assert.match(document.getElementById('diagnosticVerdict').textContent,/ошибки.*неполная/);
 document.getElementById('diagnosticDialog').close();tests=validTests();app.diagnosticEvents=[['error','codec:12345678']];await document.getElementById('diagnosticOpen').click();
 assert.equal(document.getElementById('diagnosticSummary').dataset.state,'different');assert.match(document.getElementById('diagnosticCounts').textContent,/в тестах: 0 · замечаний состояния: 1/);
 console.log('PASS automatic result, four-cell snapshot, privacy, mismatch, missing capabilities and complete cancelled/error reports');
 console.log('PASS visible entry, coloured statuses, expected/actual explanations, progress, send/clipboard fallback and focus');
 console.log('PASS prominent summary: success, failures, session issues, cancelled/partial results and reset on a new run');
})().catch(e=>{console.error(e);process.exitCode=1;});
