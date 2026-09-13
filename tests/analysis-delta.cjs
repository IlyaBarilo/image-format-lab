// Computed scopes, signed differences and real UI controllers on a supplied DOM. No browser.
const assert = require('node:assert/strict');
function recordingCanvas(width=600,height=300) {
  const ops=[],stack=[];let path=[];
  const ctx={globalAlpha:1,lineWidth:1,strokeStyle:'',fillStyle:'',dash:[],
    setTransform(){},clearRect(){},fillRect(){},setLineDash(v){this.dash=v;},beginPath(){path=[];},
    moveTo(...p){path.push(['M',...p]);},lineTo(...p){path.push(['L',...p]);},closePath(){path.push(['Z']);},arc(...p){path.push(['A',...p]);},
    stroke(){ops.push({kind:'stroke',color:this.strokeStyle,path:structuredClone(path)});},fill(){ops.push({kind:'fill',path:structuredClone(path)});},
    fillText(text){ops.push({kind:'text',text});},measureText(text){return {width:text.length*7};},
    save(){stack.push({globalAlpha:this.globalAlpha,lineWidth:this.lineWidth,strokeStyle:this.strokeStyle,fillStyle:this.fillStyle});},restore(){Object.assign(this,stack.pop());},
    createImageData(w,h){return {data:new Uint8ClampedArray(w*h*4)};},putImageData(p){this.pixels=p.data;},
    drawImage(layer){ops.push({kind:'image',pixels:layer.getContext('2d').pixels});}
  };
  return {ops,ctx,dataset:{},width,height,getContext:()=>ctx,getBoundingClientRect:()=>({width,height})};
}

(async()=>{
  const {analysisDelta,deltaAt}=await import('../src/core/analysis-delta.mjs');
  const {computeHistogram}=await import('../src/core/histogram.mjs');
  const {computeWaveform}=await import('../src/core/waveform.mjs');
  const {computeLineProfile}=await import('../src/core/line-profile.mjs');
  const {createAnalysisCombined}=await import('../src/ui/analysis-combined.mjs');
  const {createAnalysisOutput}=await import('../src/ui/analysis-output.mjs');
  const gray=(values,width=values.length)=>({width,height:values.length/width,data:Uint8ClampedArray.from(values.flatMap(v=>[v,v,v,255]))});
  const pair=(a,b)=>[{cell:1,label:'Первый',data:a},{cell:2,label:'Второй',data:b}];
  const hist=values=>computeHistogram(gray(values));
  const profile=values=>computeLineProfile(gray(values));
  const wave=(values,width)=>computeWaveform(gray(values,width));
  const settings={type:'histogram',channel:'rgb',level:255};
  const items=pair(hist([0,0,255,255]),hist([0,255,255,255])),before=structuredClone(items);
  const changed=analysisDelta(items,settings);
  assert.equal(changed.unit,'percentage-points');assert.equal(changed.maximum,25);
  for(const c of changed.channels){assert.equal(c.values[0],-25);assert.equal(c.values[255],25);assert.equal(c.values.reduce((a,b)=>a+b),0);}
  const reversed=analysisDelta([...items].reverse(),settings);
  changed.channels.forEach((c,i)=>c.values.forEach((v,j)=>assert.equal(reversed.channels[i].values[j],v===0?0:-v)));
  assert.deepEqual(items,before,'original counts stay untouched');
  assert.equal(analysisDelta(pair(hist([0,255]),hist([0,0,255,255])),settings).maximum,0);
  assert.equal(analysisDelta(items,{...settings,channel:'alpha'}).maximum,0);
  const rare=pair(hist([0]),hist([0]));
  for(const item of rare){item.data.pixelCount=40000000;item.data.channels.forEach(c=>{c[0]=40000000;});}
  rare[1].data.channels[0][0]--;rare[1].data.channels[0][255]++;
  assert.ok(Math.abs(analysisDelta(rare,{...settings,channel:'r'}).maximum-.0000025)<1e-10,'one changed pixel in 40 MP remains visible');
  const transparent={width:1,height:1,data:Uint8ClampedArray.from([23,65,99,0])};
  assert.equal(analysisDelta(pair(computeHistogram(transparent,'white'),hist([255])),settings).maximum,0);
  assert.equal(analysisDelta(pair(computeHistogram(transparent,'black'),hist([0])),settings).maximum,0);
  console.log('PASS normalized histogram, signed channel values, reversed pair, alpha/matte and immutable inputs');

  const ps={type:'profile',profileChannel:'r',position:500};
  assert.deepEqual([...analysisDelta(pair(profile([10,20,30]),profile([20,25,70])),ps).channels[0].values],[10,5,40]);
  assert.equal(analysisDelta(pair(profile([0,20]),profile([0,10,20])),ps).maximum,0,'unequal sample counts align along the curve');
  const one=analysisDelta(pair(profile([10]),profile([8,12])),ps);
  assert.deepEqual([...one.channels[0].values],[-2,2]);assert.equal(deltaAt(one.channels[0].values,.5),0);
  assert.equal(analysisDelta(pair(profile([10]),profile([10])),ps).maximum,0);
  assert.equal(analysisDelta(pair(profile([10]),profile([20])),ps).unit,'code-values');
  console.log('PASS profile means, relative interpolation, single point and signed code-value units');

  const ws={type:'waveform'},a=wave([0,255,0,255],2),b=wave([0,0,255,0,255,255],3);
  assert.equal(analysisDelta(pair(a,b),ws).maximum,0,'2-to-3 column resampling uses overlap weights and normalized density');
  assert.equal(analysisDelta(pair(a,wave([0,255,0,255,0,255,0,255],2)),ws).maximum,0,'height does not change column density');
  const spatial=analysisDelta(pair(wave([0,255],2),wave([255,0],2)),ws);
  assert.equal(spatial.maximum,100);assert.equal(spatial.channels[0].index,3);
  assert.equal(spatial.channels[0].values[0],-100);assert.equal(spatial.channels[0].values[255],100);
  assert.equal(spatial.channels[0].values[256],100);assert.equal(spatial.channels[0].values[511],-100);
  for(let x=0;x<spatial.columns;x++)assert.equal(spatial.channels[0].values.slice(x*256,(x+1)*256).reduce((a,b)=>a+b),0);
  const parade=analysisDelta(pair(wave([0],1),computeWaveform({width:1,height:1,data:Uint8ClampedArray.from([255,0,0,255])})),{type:'parade'});
  assert.equal(parade.channels[0].values[255],100);assert.ok(parade.channels.slice(1).every(c=>c.values.every(v=>v===0)));
  assert.throws(()=>analysisDelta(items,{type:'vectorscope'}));assert.throws(()=>analysisDelta([items[0]],settings));
  console.log('PASS Waveform/Parade signed densities, common scale, unequal grids, channel isolation and unsupported modes');

  global.document={createElement:()=>recordingCanvas()};
  const {renderAnalysisDelta}=createAnalysisCombined();
  for(const dpr of [1,2]){
    global.devicePixelRatio=dpr;
    const c=recordingCanvas();renderAnalysisDelta(c,changed,settings);
    assert.equal(c.width,600*dpr);assert.equal(c.dataset.yMin,'-25');assert.equal(c.dataset.yMax,'25');
    const red=c.ops.find(op=>op.kind==='stroke'&&op.color==='#ff4b55');
    assert.ok(red.path[0][2]>152&&red.path.at(-1)[2]<152,'negative below zero, positive above');
    assert.ok(c.ops.indexOf(red)>c.ops.findLastIndex(op=>op.kind==='fill'),'all RGB fills remain below the contours');
    assert.ok(c.ops.some(op=>op.kind==='text'&&op.text==='Δ п.п.'));
    const density=recordingCanvas();renderAnalysisDelta(density,spatial,ws);
    const pixels=density.ops.find(op=>op.kind==='image').pixels;
    let positive=0,negative=0;
    for(let i=0;i<pixels.length;i+=4)if(pixels[i+3]){if(pixels[i]===251)positive++;else if(pixels[i]===56)negative++;else assert.fail('unexpected sign color');}
    assert.ok(positive&&negative);assert.equal(density.dataset.yMin,'0');assert.equal(density.dataset.yMax,'255');
    const equal=recordingCanvas();renderAnalysisDelta(equal,analysisDelta(pair(a,a),ws),ws);
    assert.ok(equal.ops.find(op=>op.kind==='image').pixels.every(v=>v===0),'equal density stays dark');
    const point=recordingCanvas();renderAnalysisDelta(point,analysisDelta(pair(profile([10]),profile([20])),ps),ps);
    assert.ok(point.ops.some(op=>op.kind==='fill'&&op.path[0]?.[0]==='A'));
  }
  console.log('PASS renderer zero axis, signs, units, density colors, equal plots, one point and DPR=1/2');

  const elements=new Map(),created=[],get=id=>{if(!elements.has(id))elements.set(id,{...recordingCanvas(),hidden:false,value:'',textContent:'',style:{},attrs:{},children:[],events:{},
    get options(){return this.children;},get selectedOptions(){return [{textContent:this.value}];},replaceChildren(){this.children=[];},append(c){this.children.push(c);},
    setAttribute(k,v){this.attrs[k]=v;},removeAttribute(k){delete this.attrs[k];},querySelector(){return get('plots');},
    addEventListener(k,fn){(this.events[k]??=[]).push(fn);},async fire(k){for(const fn of this.events[k]||[])await fn();}});return elements.get(id);};
  let delayedPNG=false,pngCallback=null;
  global.document={getElementById:get,createElement:tag=>{
    if(tag!=='canvas')return {style:{}};
    const c=recordingCanvas();c.toBlob=fn=>{if(delayedPNG)pngCallback=fn;else fn(new Blob(['test canvas'],{type:'image/png'}));};created.push(c);return c;
  }};
  const app={layout:4};get('analysisType').value='histogram';get('analysisPair').value='1,2';
  let redraws=0,resizing=false,renders=[],downloads=[],snapshot;
  const ui=createAnalysisOutput({app},{isAnalysisResizing:()=>resizing,redrawAnalysis(){redraws++;},renderAnalysisOverlay(){},
    renderAnalysisDelta(canvas,model,s){renders.push({model,settings:s});},getAnalysisSnapshot:()=>snapshot,downloadBlob(blob,name){downloads.push({blob,name});}});
  ui.attachAnalysisOutputEvents();ui.attachAnalysisOutputEvents();
  const choose=async value=>{
    for(const [v,id] of [['separate','Separate'],['overlay','Overlay'],['delta','Delta']])get('analysisDisplay'+id).checked=v===value;
    await get('analysisDisplay'+({separate:'Separate',overlay:'Overlay',delta:'Delta'})[value]).fire('change');
  };
  const kind=value=>{get('analysisType').value=value;ui.syncAnalysisOutput();};
  for(const type of ['histogram','waveform','parade','profile']){kind(type);await choose('delta');assert.equal(ui.getAnalysisOutputSettings().display,'delta');assert.equal(get('analysisDisplayDeltaField').hidden,false);}
  assert.equal(redraws,4);await choose('delta');assert.equal(redraws,4);
  kind('vectorscope');assert.equal(get('analysisDisplayDelta').disabled,true);assert.equal(get('analysisDisplayDeltaField').hidden,true);
  await choose('delta');assert.equal(redraws,4);assert.equal(ui.getAnalysisOutputSettings().display,'separate');
  for(const type of ['difference','tradeoff']){kind(type);assert.equal(get('analysisDisplayField').hidden,true);}
  kind('histogram');assert.equal(get('analysisDisplayDelta').checked,true);assert.equal(get('analysisPairField').hidden,false);
  get('analysisPair').value='3,4';await get('analysisPair').fire('change');
  assert.equal(get('analysisPair').options.find(o=>o.value==='3,4').textContent,'4 − 3');
  snapshot={version:1,revision:1,source:{name:'fixture',width:4,height:1},method:'Разница графиков.',settings:{...settings,...ui.getAnalysisOutputSettings(),matte:'white',scope:'full'},items:[...items,...items.map(i=>({...i,cell:i.cell+2}))]};
  ui.presentAnalysis(snapshot);assert.deepEqual(renders.at(-1).model.pair,[3,4]);
  assert.match(get('analysisCombinedLegend').children[0].textContent,/Δ 4 − 3/);
  assert.match(get('analysisCombinedChart').attrs['aria-label'],/ячейка 4 минус 3/);
  const cached=renders.at(-1).model;
  snapshot={...snapshot,settings:{...snapshot.settings,level:0}};ui.presentAnalysis(snapshot);assert.equal(renders.at(-1).model,cached);
  await get('analysisJSON').fire('click');
  const json=JSON.parse(await downloads[0].blob.text());assert.deepEqual(json.items.map(i=>i.cell),[3,4]);assert.deepEqual(json.delta.pair,[3,4]);
  assert.equal(json.delta.operation,'second-minus-first');assert.equal(json.delta.channels[0].values[0],-25);assert.equal(json.delta.unit,'percentage-points');
  await get('analysisPNG').fire('click');assert.equal(get('analysisSaveStatus').textContent,'');assert.ok(created.at(-1).ops.some(op=>op.kind==='text'&&op.text.includes('Разница ячеек 4 − 3')));
  delayedPNG=true;const saving=get('analysisPNG').fire('click');assert.ok(pngCallback);
  snapshot={...snapshot,settings:{...snapshot.settings,pair:[1,2]}};pngCallback(new Blob(['late']));await saving;
  assert.equal(downloads.length,2,'changed pair rejects delayed PNG');
  assert.match(get('analysisSaveStatus').textContent,/Анализ изменился/);
  const oldRenders=renders.length;resizing=true;ui.presentAnalysis({...snapshot,items:[]});assert.equal(renders.length,oldRenders);
  resizing=false;ui.presentAnalysis({...snapshot,items:snapshot.items.map(i=>i.cell===2?{...i,data:null,message:'Не применено'}:i)});
  assert.equal(get('analysisCombinedChart').hidden,true);assert.equal(get('analysisJSON').disabled,true);assert.match(get('analysisCombinedInfo').textContent,/Не применено/);
  get('analysisPair').value='3,4';app.layout=2;ui.syncAnalysisOutput();assert.deepEqual(ui.getAnalysisOutputSettings().pair,[1,2]);assert.equal(get('analysisPairField').hidden,true);
  get('analysisBody').hidden=true;ui.presentAnalysis(snapshot);assert.equal(renders.length,oldRenders);assert.equal(get('analysisPNG').disabled,true);
  console.log('PASS per-diagram View mode, pair selection/fallback, cache, unavailable pair, resize pause, JSON values and PNG labels/staleness');
})().catch(error=>{console.error(error);process.exitCode=1;});
