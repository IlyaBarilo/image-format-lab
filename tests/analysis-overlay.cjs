// Real renderer on a recording Canvas context. No browser or native drawing dependency.
const assert=require('node:assert/strict');
(async()=>{
  const {createAnalysisCombined}=await import('../src/ui/analysis-combined.mjs');
  const {createAnalysisOutput}=await import('../src/ui/analysis-output.mjs');
  const {renderAnalysisOverlay}=createAnalysisCombined();
  function recorder(){
    const ops=[],stack=[];let path=[];
    const ctx={globalAlpha:1,lineWidth:1,strokeStyle:'#000',fillStyle:'#000',dash:[],globalCompositeOperation:'source-over',
      beginPath(){path=[];},moveTo:(...p)=>path.push(['M',...p]),lineTo:(...p)=>path.push(['L',...p]),closePath:()=>path.push(['Z']),arc:(...p)=>path.push(['A',...p]),
      fill(){ops.push({kind:'fill',path:structuredClone(path),color:this.fillStyle,alpha:this.globalAlpha});},
      stroke(){ops.push({kind:'stroke',path:structuredClone(path),color:this.strokeStyle,alpha:this.globalAlpha,width:this.lineWidth,dash:[...this.dash]});},
      setLineDash(value){this.dash=[...value];},setTransform(){},fillRect(){},strokeRect(){},fillText(){},clearRect(){},
      save(){stack.push(Object.fromEntries(['globalAlpha','lineWidth','strokeStyle','fillStyle','dash','globalCompositeOperation'].map(k=>[k,this[k]])));},
      restore(){Object.assign(this,stack.pop());},drawImage(){ops.push({kind:'image',composite:this.globalCompositeOperation});},
      createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4)}),putImageData(){}};
    const canvas={dataset:{},width:1,height:1,getContext:()=>ctx,getBoundingClientRect:()=>({width:600,height:300})};
    return {ops,ctx,canvas};
  }
  globalThis.document={createElement:()=>recorder().canvas};
  const histogram=n=>({width:n,height:1,pixelCount:n,bounds:{x:0,y:0,width:n,height:1},channels:Array.from({length:5},(_,c)=>{const v=new Uint32Array(256);v[32+c*32]=n;return v;})});
  const sat=hex=>{const v=hex.slice(1).match(/../g).map(n=>parseInt(n,16));return (Math.max(...v)-Math.min(...v))/Math.max(...v);};
   for(const dpr of [1,2]){
    globalThis.devicePixelRatio=dpr;
    const items=[{data:histogram(4)},{data:histogram(8)}],before=structuredClone(items),r=recorder();
    renderAnalysisOverlay(r.canvas,items,{type:'histogram',channel:'rgb',level:128});
    const fills=r.ops.filter(o=>o.kind==='fill'),contours=r.ops.filter(o=>o.kind==='stroke'&&o.alpha===1&&o.width===2);
    assert.equal(fills.length,3);assert.equal(contours.length,3);
    assert.equal(Number(r.canvas.dataset.yMax),100,'different pixel counts use the same percentage scale');
    for(let c=0;c<3;c++){
      assert.ok(fills[c].alpha>0&&fills[c].alpha<.5,'underlay is translucent');
      assert.ok(sat(fills[c].color)<sat(contours[c].color),'pastel underlay has lower saturation than contour');
      assert.deepEqual(contours[c].dash,[],'comparison contour is solid');
      assert.equal(fills[c].path.at(-1)[0],'Z');assert.deepEqual(fills[c].path.slice(-3,-1).map(p=>p[2]),[272,272]);
      assert.deepEqual(contours[c].path,fills[c].path.slice(0,-3),'coincident distributions stay at exactly the same coordinates');
      assert.ok(r.ops.indexOf(contours[c])>r.ops.indexOf(fills.at(-1)),'all fills stay below all comparison contours');
    }
    assert.deepEqual(items,before,'drawing does not mutate analysis data');
    assert.equal(r.canvas.width,600*dpr);assert.equal(r.canvas.height,300*dpr);
    assert.equal(r.ctx.globalAlpha,1);assert.deepEqual(r.ctx.dash,[]);
    const gray=recorder();renderAnalysisOverlay(gray.canvas,items,{type:'histogram',channel:'alpha',level:255});
     assert.equal(gray.ops.filter(o=>o.kind==='fill').length,1);
   }
   const errorData=n=>({pixelCount:n,channels:[new Uint32Array(256),new Uint32Array(256)]});
   const errorItems=[{data:errorData(4)},{data:errorData(8)}];
   errorItems[0].data.channels[0][0]=4;errorItems[1].data.channels[0][1]=8;
   errorItems[0].data.channels[1][0]=4;errorItems[1].data.channels[1][255]=8;
   for(const channel of ['rgb','alpha']){
     const r=recorder();renderAnalysisOverlay(r.canvas,errorItems,{type:'errorHistogram',errorChannel:channel,level:0});
     assert.equal(r.canvas.dataset.yMax,'100');assert.equal(r.canvas.dataset.xMax,'100');
     const fill=r.ops.find(o=>o.kind==='fill'),contour=r.ops.find(o=>o.kind==='stroke'&&o.width===2&&o.alpha===1);
     assert.ok(fill&&contour);assert.notEqual(fill.color,contour.color);
     if(channel==='rgb')assert.ok(sat(fill.color)<sat(contour.color));
   }
  const profile=n=>({bins:n,sampleCount:n,counts:new Uint32Array(n).fill(1),channels:Array.from({length:5},()=>({mean:new Float32Array(n).fill(128),min:new Uint8Array(n).fill(10),max:new Uint8Array(n).fill(240)}))});
  for(const bins of [1,4]){
    const r=recorder();renderAnalysisOverlay(r.canvas,[{data:profile(bins)},{data:profile(bins)}],{type:'profile',profileChannel:'r',position:500});
    assert.equal(r.canvas.dataset.yMax,'255');
    const ranges=r.ops.filter(o=>o.kind==='stroke'&&o.alpha<1&&o.path.length===bins*2&&o.path.every(p=>p[0]==='M'||p[0]==='L')&&o.path.every((p,i)=>i%2===0||p[1]===o.path[i-1][1]));
    assert.equal(ranges.length,2,'min/max ranges of both profiles retained');
    if(bins===1){assert.ok(r.ops.some(o=>o.kind==='fill'&&o.path[0]?.[0]==='A'));assert.ok(r.ops.some(o=>o.kind==='stroke'&&o.path[0]?.[0]==='A'));}
    else assert.equal(r.ops.filter(o=>o.kind==='fill').length,1);
  }
  for(const type of ['waveform','parade','ycbcrWaveform','vectorscope']){
    const r=recorder(),data=type==='vectorscope'?{size:1,bins:new Uint32Array([1]),pixelCount:1}:{columns:1,columnPixels:new Uint32Array([1]),channels:Array.from({length:6},()=>new Uint32Array(256).fill(1))};
    renderAnalysisOverlay(r.canvas,[{data},{data}],{type});
    assert.equal(r.ops.filter(o=>o.kind==='fill').length,0,'density scopes do not receive area-under-curve fills');
    const layers=r.ops.filter(o=>o.kind==='image');assert.equal(layers.length,['parade','ycbcrWaveform'].includes(type)?6:2);assert.ok(layers.every(o=>o.composite==='lighter'));
  }
  console.log('PASS histogram RGB/alpha fill/contour order, saturation, normalization, DPR=1/2, coincident curves, profile ranges/one sample and density scopes');

  const elements=new Map(),get=id=>{if(!elements.has(id))elements.set(id,{...recorder().canvas,hidden:false,value:'',textContent:'',style:{},children:[],attrs:{},events:{},
    setAttribute(name,value){this.attrs[name]=value;},removeAttribute(name){delete this.attrs[name];},
    addEventListener(name,fn){(this.events[name]??=[]).push(fn);},fire(name){for(const fn of this.events[name]||[])fn();},
    get options(){return this.children;},replaceChildren(){this.children=[];},append(child){this.children.push(child);},querySelector:()=>get('plots')});return elements.get(id);};
  globalThis.document={getElementById:get,createElement:()=>({style:{}})};
  get('analysisType').value='histogram';get('analysisPair').value='1,2';get('analysisPair').dataset.layout='2';
  let resizing=false,redraws=0;
  const output=createAnalysisOutput({app:{layout:2}},{renderAnalysisOverlay(){},isAnalysisResizing:()=>resizing,redrawAnalysis(){redraws++;}});
  output.attachAnalysisOutputEvents();output.attachAnalysisOutputEvents();
  const selectKind=kind=>{get('analysisType').value=kind;output.syncAnalysisOutput();};
  const expectDisplay=value=>{
    assert.equal(output.getAnalysisOutputSettings().display,value);
    assert.equal(get('analysisDisplaySeparate').checked,value==='separate');
    assert.equal(get('analysisDisplayOverlay').checked,value==='overlay');
    assert.equal(get('analysisCombined').hidden,value==='separate');
    assert.equal(get('plots').hidden,value!=='separate');
  };
  const choose=value=>{
    get('analysisDisplaySeparate').checked=value==='separate';
    get('analysisDisplayOverlay').checked=value==='overlay';
    get(value==='separate'?'analysisDisplaySeparate':'analysisDisplayOverlay').fire('change');
  };
  expectDisplay('overlay');
  choose('overlay');assert.equal(redraws,0,'active radio does not redraw');
  get('analysisDisplaySeparate').fire('change');assert.equal(redraws,0,'unchecked radio does not redraw');
  for(const kind of ['waveform','parade','vectorscope']){
    selectKind(kind);expectDisplay('separate');
    choose('overlay');expectDisplay('overlay');
  }
  selectKind('profile');expectDisplay('overlay');
  choose('separate');expectDisplay('separate');choose('overlay');expectDisplay('overlay');
  assert.equal(redraws,5,'each changed choice requests exactly one redraw');
  selectKind('histogram');expectDisplay('overlay');
  choose('separate');expectDisplay('separate');
  for(const kind of ['waveform','parade','vectorscope','profile']){selectKind(kind);expectDisplay('overlay');}
  selectKind('waveform');choose('separate');
  selectKind('histogram');expectDisplay('separate');
  get('analysisBody').hidden=true;output.syncAnalysisOutput();
  get('analysisBody').hidden=false;output.syncAnalysisOutput();expectDisplay('separate');
  for(const kind of ['difference','tradeoff']){
    selectKind(kind);expectDisplay(kind==='difference'?'separate':'metrics');
    assert.equal(get('analysisDisplayField').hidden,true);
    assert.equal(get('analysisDisplaySeparate').disabled,true);assert.equal(get('analysisDisplayOverlay').disabled,true);
    const before=redraws;choose('overlay');assert.equal(redraws,before);
  }
  selectKind('profile');expectDisplay('overlay');assert.equal(get('analysisDisplayField').hidden,false);
  selectKind('waveform');expectDisplay('separate');
  selectKind('histogram');expectDisplay('separate');
  const fresh=createAnalysisOutput({app:{layout:2}},{});
  assert.equal(fresh.getAnalysisOutputSettings().display,'overlay','new session restores histogram default');
  selectKind('profile');assert.equal(fresh.getAnalysisOutputSettings().display,'overlay','new session restores profile default');
  selectKind('histogram');choose('overlay');expectDisplay('overlay');
  console.log('PASS display radios: histogram/profile default overlay, independent diagram choices, checked state, collapse, fixed modes and one redraw per change');
  const snapshot={settings:{type:'histogram',display:'overlay',pair:[1,2],channel:'r',level:32},items:[{cell:1,label:'First',data:histogram(4)},{cell:2,label:'Second',data:histogram(8)}]};
  output.presentAnalysis(snapshot);
  assert.match(get('analysisCombinedLegend').children[0].textContent,/1 ■ заливка/);
  assert.match(get('analysisCombinedLegend').children[1].textContent,/2 □ контур/);
  assert.equal(get('analysisCombinedLegend').children[0].title,'First');
  assert.equal(get('analysisCombinedLegend').children[1].title,'Second');
  const legend=get('analysisCombinedLegend').children;
  resizing=true;output.presentAnalysis({...snapshot,items:[]});assert.equal(get('analysisCombinedLegend').children,legend,'late export completion cannot redraw or clear plots during resizing');
  console.log('PASS explicit fill/contour legend and preserved cell identity');
  resizing=false;
  const savedModes={displays:{histogram:'delta',waveform:'overlay',parade:'delta',profile:'separate',vectorscope:'overlay'},pair:[1,2],metric:'processingMs'};
  output.applyAnalysisOutputPreferences(savedModes);
  for(const [type,display] of Object.entries(savedModes.displays)){selectKind(type);assert.equal(output.getAnalysisOutputSettings().display,display);}
  assert.deepEqual(output.captureAnalysisOutputPreferences().displays,savedModes.displays);
  assert.equal(output.getAnalysisOutputSettings().metric,'processingMs');
  console.log('PASS restoring independent display choices and metric from preferences');
  selectKind('histogram');choose('overlay');
  const chart=get('analysisCombinedChart');chart.hidden=true;
  chart.getBoundingClientRect=()=>({width:chart.hidden?0:600,height:300});
  const precise={width:256,height:256,pixelCount:65536,bounds:{x:0,y:0,width:256,height:256},colorSpace:'srgb',bitDepth:16,
    channels:Array.from({length:4},()=>new Uint32Array(65536).fill(1)),scale:{kind:'integer',min:0,max:65535,bins:65536,alphaMax:65535,white:65535}};
  output.presentAnalysis({...snapshot,settings:{...snapshot.settings,level:0},items:[{cell:1,label:'First',data:precise},{cell:2,label:'Second',data:precise}]});
  assert.match(get('analysisCombinedInfo').textContent,/526 групп/,'a newly visible chart uses its real width');
  assert.match(get('analysisCombinedLegend').children[0].textContent,/0,191%/);
  output.presentAnalysis({...snapshot,items:[{cell:1,label:'First',data:precise},{cell:2,label:'Second',data:{...precise,colorSpace:'display-p3'}}]});
  assert.equal(chart.hidden,true);assert.equal(get('analysisPNG').disabled,true);assert.equal(get('analysisJSON').disabled,true);
  assert.match(get('analysisCombinedInfo').textContent,/пространства/);
  console.log('PASS precise overlay legend on first reveal and disabled export for incompatible colour spaces');
})().catch(error=>{console.error(error);process.exitCode=1;});
