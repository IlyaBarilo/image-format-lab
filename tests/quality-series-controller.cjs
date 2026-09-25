const assert=require('node:assert/strict');
const {createHash}=require('node:crypto');

class Element{
  constructor(){this.children=[];this.attributes=new Map();this.dataset={};this.hidden=false;this.disabled=false;this.value='';this.textContent='';this.listeners={};}
  append(child){this.children.push(child);}
  replaceChildren(...children){this.children=children.flatMap(child=>child.fragment?child.children:[child]);}
  setAttribute(key,value){this.attributes.set(key,String(value));}
  toggleAttribute(key,present){if(present)this.attributes.set(key,'');else this.attributes.delete(key);}
  addEventListener(kind,handler){this.listeners[kind]=handler;}
}

(async()=>{
  const {createQualitySeries}=await import('../src/ui/quality-series.mjs');
  const ids=['qualitySeriesChart','qualitySeriesStart','qualitySeriesCancel','qualitySeriesExport','qualitySeriesExportStatus','qualitySeriesTable','qualitySeriesRows','qualitySeriesStatus','qualitySeriesSummary','qualitySeriesBudget','qualitySeriesFirst','qualitySeriesSecond','studyDialog'];
  const elements=Object.fromEntries(ids.map(id=>[id,new Element()]));
  elements.qualitySeriesBudget.value='10';elements.qualitySeriesFirst.value='jpeg';elements.qualitySeriesSecond.value='webp';
  global.document={getElementById:id=>elements[id],createElement:()=>new Element(),createElementNS:()=>new Element(),createDocumentFragment:()=>Object.assign(new Element(),{fragment:true})};
  const file=new Blob(['abc'],{type:'image/png'});
  const source={name:'test.png',width:100,height:100,file,pixelBuffer:{bitDepth:8}};
  const app={source,sourceLoading:false,sourceGeneration:1,batchRun:null,variants:[{config:{format:'original'}},{config:{format:'jpeg',quality:85}}]};
  const before=structuredClone(app.variants.map(v=>v.config));
  let encodeCount=0,closed=0;
  const downloads=[];
  const deps={formatUnavailableReason:()=>'',encodeFromSource:async config=>({blob:{size:config.quality*100,quality:config.quality},sourcePixelBuffer:{}}),
    decodeVariantForPreview:async blob=>({imageData:{width:100,height:100},pixelBuffer:{quality:blob.quality},bitmap:{close:()=>closed++}}),
    measurePixels:async(_,pixels)=>({psnr:pixels.quality/2,alpha:0}),downloadBlob:(blob,name)=>downloads.push({blob,name})};
  const originalEncode=deps.encodeFromSource;
  deps.encodeFromSource=async(...args)=>{encodeCount++;return originalEncode(...args);};
  const controller=createQualitySeries({app},deps);
  controller.attachQualitySeriesEvents();
  await controller.startQualitySeries();
  assert.equal(encodeCount,10);assert.equal(closed,10);
  assert.equal(elements.qualitySeriesRows.children.length,10);
  assert.equal(elements.qualitySeriesChart.attributes.has('hidden'),false);
  assert.equal(elements.qualitySeriesRows.children.filter(row=>row.dataset.best==='true').length,1);
  assert.deepEqual(app.variants.map(v=>v.config),before,'series must not change comparison configs');
  assert.equal(elements.qualitySeriesExport.disabled,false);
  await controller.saveQualitySeriesJSON();
  assert.equal(downloads.length,1);assert.equal(downloads[0].name,'quality-series.json');
  const report=JSON.parse(await downloads[0].blob.text());
  assert.equal(report.kind,'image-format-lab-quality-series');
  assert.equal(report.progress.partial,false);assert.equal(report.progress.attempted,10);
  assert.equal(report.conditions.budgetBytes,10000);
  assert.equal(report.input.sha256,createHash('sha256').update('abc').digest('hex'));
  assert.equal(report.result.bestUnderBudget,'jpeg-90');
  assert.equal(encodeCount,10,'export must not encode again');
  elements.qualitySeriesBudget.value='1';elements.qualitySeriesBudget.listeners.input();
  assert.match(elements.qualitySeriesSummary.textContent,/Ни одна готовая точка/);
  assert.equal(elements.qualitySeriesRows.children.filter(row=>row.dataset.best==='true').length,0);
  await controller.saveQualitySeriesJSON();
  const smallBudget=JSON.parse(await downloads[1].blob.text());
  assert.equal(smallBudget.conditions.budgetBytes,1000);
  assert.equal(smallBudget.result.bestUnderBudget,null);
  assert.equal(encodeCount,10,'changing only the budget must not rerun probes');

  let release,entered,pending=0;
  const started=new Promise(resolve=>entered=resolve);
  deps.encodeFromSource=config=>{
    if(++pending===1)return Promise.resolve({blob:{size:100,quality:config.quality},sourcePixelBuffer:{}});
    return new Promise(resolve=>{release=()=>resolve({blob:{size:100,quality:config.quality},sourcePixelBuffer:{}});entered();});
  };
  const interrupted=controller.startQualitySeries();
  await started;
  controller.cancelQualitySeries();release();await interrupted;
  assert.equal(elements.qualitySeriesRows.children.length,1,'finished point remains; cancelled in-flight point is discarded');
  assert.match(elements.qualitySeriesStatus.textContent,/Остановлено/);
  await controller.saveQualitySeriesJSON();
  const partial=JSON.parse(await downloads[2].blob.text());
  assert.equal(partial.progress.state,'stopped');assert.equal(partial.progress.partial,true);
  assert.equal(partial.progress.attempted,1);assert.equal(partial.points.length,1);
  assert.deepEqual(app.variants.map(v=>v.config),before);
  const sourceChanged=new Promise(resolve=>entered=resolve);
  const stale=controller.startQualitySeries();
  await sourceChanged;
  app.source={...source,name:'next.png'};app.sourceGeneration++;
  release();await stale;
  assert.equal(elements.qualitySeriesRows.children.length,0,'new source invalidates in-flight series');
  assert.match(elements.qualitySeriesStatus.textContent,/Исходник изменился/);
  console.log('PASS quality-series controller: 10 probes, chart/table/budget, unchanged cells, cancellation and source replacement');
})().catch(error=>{console.error(error);process.exitCode=1;});
