const assert=require('node:assert/strict');

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
  const ids=['qualitySeriesChart','qualitySeriesStart','qualitySeriesCancel','qualitySeriesTable','qualitySeriesRows','qualitySeriesStatus','qualitySeriesSummary','qualitySeriesBudget','qualitySeriesFirst','qualitySeriesSecond','studyDialog'];
  const elements=Object.fromEntries(ids.map(id=>[id,new Element()]));
  elements.qualitySeriesBudget.value='10';elements.qualitySeriesFirst.value='jpeg';elements.qualitySeriesSecond.value='webp';
  global.document={getElementById:id=>elements[id],createElement:()=>new Element(),createElementNS:()=>new Element(),createDocumentFragment:()=>Object.assign(new Element(),{fragment:true})};
  const source={name:'test.png',width:100,height:100};
  const app={source,sourceLoading:false,sourceGeneration:1,batchRun:null,variants:[{config:{format:'original'}},{config:{format:'jpeg',quality:85}}]};
  const before=structuredClone(app.variants.map(v=>v.config));
  let encodeCount=0,closed=0;
  const deps={formatUnavailableReason:()=>'',encodeFromSource:async config=>({blob:{size:config.quality*100,quality:config.quality},sourcePixelBuffer:{}}),
    decodeVariantForPreview:async blob=>({imageData:{width:100,height:100},pixelBuffer:{quality:blob.quality},bitmap:{close:()=>closed++}}),
    measurePixels:async(_,pixels)=>({psnr:pixels.quality/2,alpha:0})};
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
  elements.qualitySeriesBudget.value='1';elements.qualitySeriesBudget.listeners.input();
  assert.match(elements.qualitySeriesSummary.textContent,/Ни одна готовая точка/);
  assert.equal(elements.qualitySeriesRows.children.filter(row=>row.dataset.best==='true').length,0);

  let release,entered;
  const started=new Promise(resolve=>entered=resolve);
  deps.encodeFromSource=()=>new Promise(resolve=>{release=()=>resolve({blob:{size:100,quality:30},sourcePixelBuffer:{}});entered();});
  const interrupted=controller.startQualitySeries();
  await started;
  controller.cancelQualitySeries();release();await interrupted;
  assert.equal(elements.qualitySeriesRows.children.length,0,'cancelled in-flight point is discarded');
  assert.match(elements.qualitySeriesStatus.textContent,/Остановлено/);
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
