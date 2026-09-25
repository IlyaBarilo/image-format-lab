// Real analysis scheduler on a supplied DOM and controlled Worker results; no browser.
const assert = require('node:assert/strict');
(async () => {
  const { createAnalysis } = await import('../src/ui/analysis.mjs');
  class Element {
    constructor() { this.hidden=false;this.dataset={};this.value='';this.attrs=new Map();this.events=new Map();this.width=1;this.height=1; }
    addEventListener(name,fn){this.events.set(name,fn);}
    emit(name){this.events.get(name)?.({target:this});}
    setAttribute(name,value){this.attrs.set(name,String(value));}
    removeAttribute(name){this.attrs.delete(name);}
    getContext(){return new Proxy({}, {get:()=>()=>{},set:()=>true});}
    getBoundingClientRect(){return {width:this.hidden?0:600,height:300};}
    focus(){document.activeElement=this;}
  }
  const elements=new Map(),get=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};
  globalThis.document={getElementById:get,activeElement:null};
  globalThis.devicePixelRatio=1;
  globalThis.Worker=class {};
  const observers=[];
  globalThis.ResizeObserver=class {constructor(callback){observers.push(callback);}observe(){}};
  let frames=[];
  globalThis.requestAnimationFrame=fn=>{frames.push(fn);return frames.length;};
  globalThis.window={addEventListener(){}};
  const panel=get('analysisPanel'),body=get('analysisBody'),collapse=get('analysisCollapse'),compact=new Element();
  get('analysisType').value='histogram';get('analysisChannel').value='rgb';get('analysisMatte').value='white';
  get('analysisLevel').value='128';get('analysisGain').value='4';get('analysisHelpContent').hidden=true;
  const cards=Array.from({length:4},()=>{
    const card=new Element(),parts=new Map();card.querySelector=selector=>{if(!parts.has(selector))parts.set(selector,new Element());return parts.get(selector);};return card;
  });
  panel.querySelectorAll=()=>cards;
  panel.querySelector=selector=>selector==='.analysis-plots'?get('plots'):compact;
  const app={source:null,sourceLoading:false,layout:2,variants:[]};
  let jobs=[],calls=0,published=[],closedEditors=0;
  const settings={display:'overlay',pair:[1,2],metric:'psnrRGB'};
  const deps={
    attachAnalysisRegionEvents(){},attachAnalysisOutputEvents(){},attachAnalysisLayoutEvents(){},syncAnalysisLayout(){},
    syncAnalysisRegion(){},syncAnalysisOutput(){},getAnalysisOutputSettings:()=>settings,
    getAnalysisScope:()=> 'full',
    getAnalysisRegion:()=>({x:0,y:0,width:1,height:1}),getAnalysisLine:()=>({ax:0,ay:0,bx:1,by:1}),
    presentAnalysis:snapshot=>published.push(snapshot),outputFormatLabel:format=>format,isVariantReady:()=>true,
    closeAnalysisRegion(){closedEditors++;},drawAll(){},drawAnalysisRegion(){},
    workerCompute:async(kind,payload)=>{calls++;return new Promise(resolve=>jobs.push({kind,payload,resolve}));}
  };
  const ui=createAnalysis({app},deps);
  const tick=async()=>{await new Promise(resolve=>setImmediate(resolve));const pending=frames;frames=[];pending.forEach(fn=>fn());await new Promise(resolve=>setImmediate(resolve));};
  const source=name=>{
    app.source={name,width:2,height:1,size:8};
    app.variants=Array.from({length:2},(_,i)=>({config:{format:'png'},resultConfig:{format:'png'},measurement:{},imageData:{name:name+i,width:2,height:1,data:new Uint8ClampedArray(8)}}));
  };
  ui.attachAnalysisEvents();await tick();
  assert.equal(body.hidden,false);assert.equal(panel.hidden,false);assert.equal(calls,0);
  assert.ok(cards[0].querySelector('.analysis-info').textContent.includes('Добавьте'));
  assert.equal(elements.has('analysisToggle'),false);assert.equal(elements.has('analysisClose'),false);
  source('old');ui.updateAnalysis();await tick();assert.equal(calls,1,'the visible panel starts automatically');
  const old=jobs.shift();ui.collapseAnalysis();await tick();
  assert.equal(body.hidden,true);assert.equal(panel.hidden,false);assert.equal(collapse.hidden,false);
  assert.equal(collapse.attrs.get('aria-expanded'),'false');
  source('new');get('analysisMatte').value='black';ui.updateAnalysis();await tick();
  assert.equal(calls,1,'updates while collapsed do not schedule Worker work');
  old.resolve({name:'obsolete'});await tick();
  assert.equal(calls,1,'collapsing prevents the next cell from starting');
  assert.ok(ui.getAnalysisSnapshot().items.every(item=>!item.data));
  assert.ok(published.every(snapshot=>snapshot.items.every(item=>item.data?.name!=='obsolete')));
  ui.expandAnalysis();await tick();assert.equal(body.hidden,false);assert.equal(collapse.hidden,false);assert.equal(calls,2);
  assert.equal(jobs[0].payload.pixelBuffer.data,app.variants[0].imageData.data);assert.equal('imageData' in jobs[0].payload,false);assert.equal(jobs[0].payload.matte,'black');
  jobs.shift().resolve({name:'new0'});await tick();assert.equal(calls,3);
  jobs.shift().resolve({name:'new1'});await tick();
  assert.deepEqual(ui.getAnalysisSnapshot().items.map(item=>item.data.name),['new0','new1']);
  ui.collapseAnalysis();await tick();ui.expandAnalysis();await tick();
  assert.equal(calls,3,'reopening unchanged images reuses the completed cache');
  assert.equal(get('analysisMatte').value,'black');assert.equal(closedEditors,2);
  assert.deepEqual(ui.getAnalysisSnapshot().items.map(item=>item.data.name),['new0','new1']);
  console.log('PASS permanent analysis, empty state, visible collapse segment, suspended work, discarded stale output and cached reopening');

  const beforeDelta=calls;
  settings.display='delta';settings.pair=[2,1];ui.redrawAnalysis();await tick();
  assert.deepEqual(ui.getAnalysisSnapshot().settings.pair,[2,1]);
  assert.equal(ui.getAnalysisSnapshot().settings.display,'delta');
  assert.match(get('analysisMethod').textContent,/процентные пункты/);
  assert.equal(calls,beforeDelta,'difference view uses ready scopes without a Worker job');
  settings.display='overlay';settings.pair=[1,2];ui.redrawAnalysis();await tick();

  observers.forEach(fn=>fn()); // A redraw may already be waiting when the user grabs the strip.
  const beforePause=published.length;
  ui.pauseAnalysisForResize();ui.redrawAnalysis();observers.forEach(fn=>fn());await tick();
  assert.equal(published.length,beforePause,'queued/observer redraws are held during a resize');
  assert.deepEqual(ui.getAnalysisSnapshot().items.map(i=>i.data.name),['new0','new1'],'previous graph is retained while resizing');
  ui.resumeAnalysisAfterResize();ui.redrawAnalysis();await tick();assert.equal(calls,3,'resizing full-frame plots does not compute again');

  const fullCalls=calls;ui.updateAnalysisViewport();await tick();assert.equal(calls,fullCalls,'full frame ignores viewport movement');
  let scope='viewport';deps.getAnalysisScope=()=>scope;
  const crop=x=>({unit:'pixels',x,y:0,width:1,height:1});
  let viewports=[{region:crop(0)},{region:crop(1)}];
  deps.getAnalysisViewport=i=>viewports[i];
  // Even a shared raster needs different bins if the two windows expose different pixels.
  app.variants[1].imageData=app.variants[0].imageData;
  const realSetTimeout=globalThis.setTimeout,realClearTimeout=globalThis.clearTimeout;
  const timers=new Map();let timerId=0;
  globalThis.setTimeout=fn=>{timers.set(++timerId,fn);return timerId;};
  globalThis.clearTimeout=id=>timers.delete(id);
  try {
    ui.updateAnalysis();await tick();const obsolete=jobs.shift();
    viewports=[{region:crop(1)},{region:crop(0)}];ui.updateAnalysisViewport();
    viewports=[{region:crop(0)},{region:crop(1)}];ui.updateAnalysisViewport();
    assert.equal(timers.size,1,'rapid movements replace the pending update');
    assert.ok(ui.getAnalysisSnapshot().items.every(i=>!i.data),'old plots/export invalidated immediately');
    const countBefore=calls;await tick();assert.equal(calls,countBefore,'no clone/compute during debounce');
    const timer=[...timers.values()][0];timers.clear();timer();await tick();
    assert.equal(calls,countBefore,'only one Worker job in flight');
    obsolete.resolve({name:'old-viewport'});await tick();
    assert.deepEqual(jobs[0].payload.region,crop(0));jobs.shift().resolve({name:'left'});await tick();
    assert.deepEqual(jobs[0].payload.region,crop(1),'shared raster cache is keyed by crop');jobs.shift().resolve({name:'right'});await tick();
    assert.deepEqual(ui.getAnalysisSnapshot().items.map(i=>i.data.name),['left','right']);
    assert.equal(ui.getAnalysisSnapshot().settings.scope,'viewport');
    assert.deepEqual(ui.getAnalysisSnapshot().settings.viewports.map(v=>v.region),[crop(0),crop(1)]);
    assert.ok(published.every(s=>s.items.every(i=>i.data?.name!=='old-viewport')));
    let stable=calls;ui.updateAnalysisViewport();await tick();assert.equal(timers.size,0);assert.equal(calls,stable);

    viewports=[{region:crop(1)},{region:crop(1)}];ui.updateAnalysisViewport();assert.equal(timers.size,1);
    ui.pauseAnalysisForResize();assert.equal(timers.size,0,'grab cancels a pending viewport timer');
    const held=published.length;
    viewports=[{region:crop(0)},{region:crop(0)}];
    ui.updateAnalysisViewport();ui.redrawAnalysis();observers.forEach(fn=>fn());await tick();
    assert.equal(calls,stable);assert.equal(published.length,held);assert.equal(timers.size,0);
    ui.resumeAnalysisAfterResize();await tick();assert.equal(calls,stable+1);assert.deepEqual(jobs[0].payload.region,crop(0));
    jobs.shift().resolve({name:'final-crop'});await tick();assert.equal(calls,stable+1,'shared crop is computed once after release');
    assert.ok(ui.getAnalysisSnapshot().items.every(i=>i.data.name==='final-crop'));

    viewports=[{region:crop(1)},{region:crop(0)}];ui.updateAnalysis();await tick();
    const inFlight=jobs.shift(),callsAtGrab=calls,publishedAtGrab=published.length;
    ui.pauseAnalysisForResize();viewports=[{region:crop(1)},{region:crop(1)}];
    ui.updateAnalysis();ui.updateAnalysisViewport();observers.forEach(fn=>fn());
    inFlight.resolve({name:'intermediate-crop'});await tick();
    assert.equal(calls,callsAtGrab,'in-flight completion cannot start the next cell during resizing');
    assert.equal(published.length,publishedAtGrab,'in-flight completion cannot paint during resizing');
    ui.resumeAnalysisAfterResize();await tick();assert.equal(calls,callsAtGrab+1);
    assert.deepEqual(jobs[0].payload.region,crop(1));jobs.shift().resolve({name:'released-crop'});await tick();
    assert.ok(ui.getAnalysisSnapshot().items.every(i=>i.data.name==='released-crop'));
    assert.ok(published.every(s=>s.items.every(i=>i.data?.name!=='intermediate-crop')));
    console.log('PASS resize pause retains plots, blocks observers/timers/Worker continuation, resumes final viewport once and skips full-frame recompute');
    stable=calls;
    viewports=[{region:null,message:'Вне просмотра'},{region:null,message:'Вне просмотра'}];ui.updateAnalysisViewport();
    ui.collapseAnalysis();assert.equal(timers.size,0,'collapse cancels pending viewport compute');await tick();
    ui.expandAnalysis();await tick();assert.equal(calls,stable,'empty viewport does not fall back to full frame');
    assert.ok(ui.getAnalysisSnapshot().items.every(i=>!i.data&&i.message==='Вне просмотра'));
    get('analysisType').value='tradeoff';ui.updateAnalysis();await tick();
    assert.equal(calls,stable,'size/metric never schedules viewport pixel work');
    assert.equal('scope' in ui.getAnalysisSnapshot().settings,false);
  } finally { globalThis.setTimeout=realSetTimeout;globalThis.clearTimeout=realClearTimeout; }
  console.log('PASS per-cell viewport scheduling, debounce, stale-result rejection, crop cache isolation, export bounds, empty views and whole-image metrics');
  deps.getAnalysisScope=()=> 'full';get('analysisType').value='histogram';source('precise');
  const {createPixelBuffer}=await import('../src/core/pixel-buffer.mjs');
  const exact=createPixelBuffer({width:2,height:1,sampleType:'uint16',colorSpace:'srgb',data:new Uint16Array([100,101,102,65535,101,102,103,65535])});
  for(const variant of app.variants)variant.pixelBuffer=exact;
  ui.updateAnalysis();await tick();
  assert.equal(jobs[0].payload.pixelBuffer,exact);assert.equal('imageData' in jobs[0].payload,false);
  const precisionCalls=calls;jobs.shift().resolve({name:'precise'});await tick();assert.equal(calls,precisionCalls,'shared descriptor is cached once');
  const floating=createPixelBuffer({width:2,height:1,sampleType:'float32',colorSpace:'srgb',data:new Float32Array([0,0,0,1,1,1,1,1])});
  const range=[-1,1];
  for(const variant of app.variants){variant.pixelBuffer=floating;variant.histogramOptions={range,bins:1024,floatPeak:1};}
  ui.updateAnalysis();await tick();assert.deepEqual(jobs[0].payload.options,{range:[-1,1],bins:1024,floatPeak:1});
  assert.notEqual(jobs[0].payload.options.range,range,'options are captured before asynchronous work');
  jobs.shift().resolve({name:'float'});await tick();const firstFloatCalls=calls;
  for(const variant of app.variants)variant.histogramOptions={range:[0,1],bins:1024,floatPeak:1};
  ui.updateAnalysis();await tick();assert.equal(calls,firstFloatCalls+1,'changed float range invalidates the cached histogram');
  jobs.shift().resolve({name:'float-new-range'});await tick();
  assert.equal(exact.data[0],100);assert.equal(floating.data.byteLength,32);
  console.log('PASS typed descriptor handoff, snapshot of float options and cache isolation from the display raster');
  source('individual');for(const variant of app.variants)variant.pixelBuffer=exact;
  settings.display='separate';deps.getAnalysisRegion=()=>null;
  ui.updateAnalysis();await tick();
  const {computeHistogram}=await import('../src/core/histogram.mjs');
  jobs.shift().resolve(computeHistogram(exact,'black'));await tick();
  for(const card of cards.slice(0,2)){
    assert.equal(card.querySelector('canvas').dataset.bins,'528','first separate rendering measures a visible canvas');
    assert.equal(card.querySelector('canvas').dataset.xMax,'65535');
    assert.equal(card.querySelector('canvas').dataset.yMax,'100');
  }
  console.log('PASS first separate rendering has the correct native axis, group count and common vertical scale');
})().catch(error=>{console.error(error);process.exitCode=1;});
