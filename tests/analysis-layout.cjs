// Node-only tests. DOM dimensions below are supplied fixtures, not CSS verification.
const assert = require('node:assert/strict');

(async () => {
  const { selectAnalysisSize, resolveAnalysisSplit, analysisSplitKey } = await import('../src/core/analysis-layout.mjs');
  assert.deepEqual(resolveAnalysisSplit(800, 0.6, 200, 180), { total:800,image:320,panel:480,ratio:0.6,min:0.225,max:0.75 });
  assert.equal(resolveAnalysisSplit(800, 4, 200, 180).panel, 600);
  assert.equal(resolveAnalysisSplit(800, -4, 200, 180).panel, 180);
  assert.equal(resolveAnalysisSplit(100, 0.6, 260.2, 200.2).total, 462);
  assert.throws(() => resolveAnalysisSplit(NaN, 0.5, 10, 10));
  const manual = { size:'balance',previous:'balance',ratio:0.48 };
  assert.deepEqual(selectAnalysisSize(selectAnalysisSize(manual,'max'),'max'), manual);
  assert.equal(selectAnalysisSize(manual,'balance').ratio, null);
  assert.throws(() => selectAnalysisSize(manual,'unknown'));
  assert.ok(Math.abs(analysisSplitKey('ArrowUp',0.4)-0.42)<1e-12);
  assert.equal(analysisSplitKey('ArrowDown',0.5,true),0.4);
  assert.equal(analysisSplitKey('Home',0.5),0);
  assert.equal(analysisSplitKey('End',0.5),1);
  assert.equal(analysisSplitKey('Tab',0.5),null);
  for (const total of [0,300,900,1200.5]) for (const image of [60,220,670.5]) for (const panel of [180,340.2]) for (const ratio of [-1,0,0.35,0.6,1,2]) {
    const value = resolveAnalysisSplit(total,ratio,image,panel);
    assert.equal(value.image+value.panel,value.total);
    assert.ok(value.image>=image && value.panel>=panel);
    assert.ok(value.ratio>=value.min-1e-12 && value.ratio<=value.max+1e-12);
  }
  console.log('PASS split bounds, small viewports, pixel rounding, keyboard steps and maximum round-trip');

  const { createAnalysisLayout } = await import('../src/ui/analysis-layout.mjs');
  class Element {
    constructor() {
      this.dataset={};this.attrs=new Map();this.events=new Map();this.hidden=false;this.scrollTop=0;
      this.properties=new Map();this.style={setProperty:(k,v)=>this.properties.set(k,v)};
      const classes=new Set();this.classList={add:n=>classes.add(n),remove:n=>classes.delete(n),contains:n=>classes.has(n),toggle:(n,on)=>on?classes.add(n):classes.delete(n)};
    }
    addEventListener(name,fn) { const list=this.events.get(name)||[];list.push(fn);this.events.set(name,list); }
    emit(name,values={}) { const event={button:0,isPrimary:true,pointerId:1,clientY:400,preventDefault(){this.prevented=true;},stopPropagation(){},...values};for(const fn of this.events.get(name)||[])fn(event);return event; }
    setAttribute(k,v){this.attrs.set(k,String(v));}
    removeAttribute(k){this.attrs.delete(k);}
    getAttribute(k){return this.attrs.get(k)??null;}
    toggleAttribute(k,v){if(v)this.attrs.set(k,'');else this.attrs.delete(k);}
    focus(){document.activeElement=this;}
    scrollIntoView(){this.scrolled=true;}
    hasPointerCapture(id){return this.captured===id;}
    setPointerCapture(id){this.captured=id;}
    releasePointerCapture(id){this.captured=null;this.emit('lostpointercapture',{pointerId:id});}
    getBoundingClientRect(){return this.rect?this.rect():{top:0,width:800,height:0};}
  }
  const stage=new Element(),grid=new Element(),panel=new Element(),body=new Element(),splitter=new Element(),heading=new Element();
  let total=800,columns=2,count=2;
  heading.rect=()=>({height:40});
  const buttons=['compact','balance','max'].map(size=>{const element=new Element();element.dataset.analysisSize=size;return element;});
  const collapseButton=new Element(),manualButton=new Element();
  collapseButton.dataset.analysisSize='collapsed';manualButton.dataset.analysisSize='manual';
  const allButtons=[collapseButton,...buttons,manualButton];
  const cells=Array.from({length:4},(_,i)=>{
    const cell=new Element(),head=new Element(),foot=new Element();
    head.rect=()=>({height:64});foot.rect=()=>({height:48});
    cell.rect=()=>({top:100+Math.floor(i/columns)*200});
    cell.querySelector=selector=>selector==='.cell-head'?head:foot;
    cell.parts=[head,foot];return cell;
  });
  grid.closest=()=>stage;
  grid.querySelectorAll=selector=>selector==='.cell:not(.hidden)'?cells.slice(0,count):cells.flatMap(c=>c.parts);
  panel.querySelectorAll=()=>allButtons;panel.querySelector=selector=>selector==='.analysis-heading'?heading:null;
  const sized=()=>Object.hasOwn(stage.dataset,'analysisSized');
  const controlsHeight=()=>Math.ceil(count/columns)*114+(Math.ceil(count/columns)-1)*12;
  grid.rect=()=>({height:sized()?parseFloat(stage.properties.get('--analysis-preview-height')):body.hidden?total-66:stage.dataset.analysisSize==='max'?controlsHeight():total*(stage.dataset.analysisSize==='balance'?0.4:0.65)});
  panel.rect=()=>({height:sized()?parseFloat(stage.properties.get('--analysis-panel-height')):body.hidden?66:stage.dataset.analysisSize==='max'?total-controlsHeight():total*(stage.dataset.analysisSize==='balance'?0.6:0.35)});
  globalThis.document={getElementById:id=>({analysisPanel:panel,analysisBody:body,analysisSplitter:splitter,analysisCollapse:collapseButton})[id]||null,activeElement:null};
  globalThis.window=new Element();window.scrollY=0;
  globalThis.getComputedStyle=element=>element===grid?{rowGap:'12px'}:element===panel?
    {paddingTop:'12px',paddingBottom:'12px',borderTopWidth:'1px',borderBottomWidth:'1px'}:{borderTopWidth:'1px',borderBottomWidth:'1px'};
  let frames=[],frameId=0,redraws=0,paused=false;
  const order=[],observers=[];
  globalThis.ResizeObserver=class {constructor(callback){observers.push(callback);}observe(){}};
  globalThis.requestAnimationFrame=fn=>{frames.push(fn);return ++frameId;};
  function flush(){for(let n=0;frames.length;n++){assert.ok(n<10,'redraw must settle');const pending=frames;frames=[];for(const fn of pending)fn();}}
  const deps=new Proxy({drawAll:()=>{assert.equal(ui.isAnalysisResizing(),false);redraws++;order.push('canvases');},redrawAnalysis(){order.push('plots');},drawAnalysisRegion(){},
    pauseAnalysisForResize(){paused=true;},resumeAnalysisAfterResize(){if(paused){paused=false;order.push('resume');}},
    expandAnalysis(){if(body.hidden){body.hidden=false;ui.syncAnalysisLayout();}},
    collapseAnalysis(){if(!body.hidden){body.hidden=true;ui.syncAnalysisLayout();}}
  },{get(target,name){assert.ok(name in target,'layout must not call compute/encode dependencies');return target[name];}});
  const ui=createAnalysisLayout({els:{grid}},deps);
  const value=()=>Number(splitter.getAttribute('aria-valuenow'));
  function dragBy(delta,id=1,type='mouse') {
    splitter.emit('pointerdown',{pointerId:id,pointerType:type});
    splitter.emit('pointermove',{pointerId:id,clientY:400+delta,pointerType:type});
    splitter.emit('pointerup',{pointerId:id,clientY:400+delta,pointerType:type});flush();
  }
  ui.attachAnalysisLayoutEvents();flush();assert.equal(splitter.hidden,false);assert.equal(value(),35);
  assert.equal(manualButton.disabled,true,'manual position is unavailable before the first adjustment');
  manualButton.emit('click');flush();assert.equal(value(),35);
  splitter.emit('pointerdown',{pointerId:70});splitter.emit('pointermove',{pointerId:70,clientY:320});
  assert.equal(manualButton.getAttribute('aria-pressed'),'true');
  splitter.emit('pointercancel',{pointerId:70});flush();assert.equal(manualButton.disabled,true,'cancelling the first drag does not create manual memory');
  assert.equal(buttons[0].getAttribute('aria-pressed'),'true');
  splitter.emit('pointerdown',{button:2});assert.equal(splitter.hasPointerCapture(1),false);
  splitter.emit('pointerdown',{isPrimary:false});assert.equal(splitter.hasPointerCapture(1),false);
  dragBy(0);assert.equal(buttons[0].getAttribute('aria-pressed'),'true','a click only focuses');
  dragBy(-80);assert.equal(value(),45);assert.equal(splitter.captured,null);
  assert.equal(buttons[0].getAttribute('aria-pressed'),'false');
  assert.match(splitter.getAttribute('aria-valuetext'),/вручную/);
  buttons[2].emit('click');flush();assert.equal(splitter.hidden,false);assert.equal(value(),100);
  assert.equal(splitter.getAttribute('aria-disabled'),'false');assert.match(splitter.getAttribute('aria-valuetext'),/Максимум/);
  buttons[2].emit('click');flush();assert.equal(value(),45);assert.equal(splitter.hidden,false);
  buttons[2].emit('click');flush();assert.equal(ui.restoreAnalysisLayout(),true);flush();
  assert.equal(value(),45);assert.equal(document.activeElement,splitter);
  body.hidden=true;ui.syncAnalysisLayout();flush();assert.equal(splitter.hidden,false);
  assert.equal(buttons[0].getAttribute('aria-pressed'),'false');assert.equal(panel.hidden,false);
  body.hidden=false;ui.syncAnalysisLayout();flush();assert.equal(value(),45);
  splitter.emit('pointerdown',{pointerId:7,pointerType:'touch'});
  splitter.emit('pointermove',{pointerId:8,clientY:100});assert.equal(value(),45);
  splitter.emit('pointermove',{pointerId:7,clientY:320});assert.equal(value(),55);
  splitter.emit('pointercancel',{pointerId:7});flush();assert.equal(value(),45);
  splitter.emit('pointerdown');splitter.emit('pointermove',{clientY:320});
  splitter.emit('keydown',{key:'Escape'});flush();assert.equal(value(),45);
  splitter.emit('pointerdown');splitter.emit('pointermove',{clientY:320});
  splitter.emit('lostpointercapture');flush();assert.equal(value(),45);
  splitter.emit('pointerdown');splitter.emit('pointermove',{clientY:320});
  window.emit('blur');flush();assert.equal(value(),45);
  dragBy(-40,9,'touch');assert.equal(value(),50);
  splitter.emit('keydown',{key:'ArrowUp'});flush();assert.equal(value(),52);
  assert.equal(splitter.scrolled,true,'keyboard keeps the handle in view');
  splitter.emit('keydown',{key:'ArrowDown',shiftKey:true});flush();assert.equal(value(),42);
  splitter.emit('keydown',{key:'Home'});flush();assert.equal(value(),23.3);
  splitter.emit('keydown',{key:'End'});flush();assert.equal(value(),79.8);
  assert.equal(splitter.emit('keydown',{key:'Tab'}).prevented,undefined);
  splitter.emit('dblclick');flush();assert.equal(value(),35);
  buttons[1].emit('click');flush();assert.equal(value(),60);
  dragBy(80);assert.equal(value(),50);
  splitter.emit('keydown',{key:'Enter'});flush();assert.equal(value(),60);
  buttons[2].emit('click');flush();ui.restoreAnalysisLayout();flush();assert.equal(value(),60);
  assert.equal(stage.dataset.analysisSize,'balance');
  dragBy(80);assert.equal(value(),50);
  total=1200;window.emit('resize');flush();assert.equal(value(),50);
  assert.equal(grid.getBoundingClientRect().height,600);
  total=800;count=4;columns=1;ui.syncAnalysisLayout();flush();
  assert.equal(grid.getBoundingClientRect().height,684,'four stacked controls retain minimum preview height');
  assert.equal(panel.getBoundingClientRect().height,186);
  count=2;columns=2;ui.syncAnalysisLayout();flush();assert.equal(value(),50,'preferred ratio survives temporary bounds');
  assert.ok(redraws>0);
  console.log('PASS real layout controller: mouse/touch, capture cancellation, keyboard, focus, presets, session state, resize and 2/4 limits');

  // Both the strip and header remain available to pull a collapsed panel up.
  count=2;columns=2;buttons[0].emit('click');flush();
  dragBy(400);assert.equal(body.hidden,true);assert.equal(panel.hidden,false);assert.equal(splitter.hidden,false);
  assert.equal(document.activeElement,heading,'collapse by dragging leaves focus on the visible header');
  assert.equal(stage.attrs.has('data-analysis-collapsed'),true);
  assert.equal(ui.restoreAnalysisLayout(),false,'Escape on the collapsed header does not open it');
  assert.equal(value(),0);assert.equal(splitter.getAttribute('aria-disabled'),'false');
  assert.match(splitter.getAttribute('aria-valuetext'),/свёрнуты/);
  dragBy(-3);assert.equal(body.hidden,true,'strip click/jitter does not expand it');
  dragBy(30);assert.equal(body.hidden,true,'pulling a collapsed strip down leaves it collapsed');
  for(const type of ['mouse','touch']) {
    dragBy(-260,20,type);assert.equal(body.hidden,false);assert.equal(splitter.hidden,false);
    assert.ok(value()>35,'strip pull opens to the dragged height');
    dragBy(500,20,type);assert.equal(body.hidden,true);assert.equal(splitter.hidden,false);
  }
  for(const cancel of ['pointercancel','lostpointercapture','Escape','blur']) {
    splitter.emit('pointerdown',{pointerId:21});splitter.emit('pointermove',{pointerId:21,clientY:140});
    assert.equal(body.hidden,false);
    if(cancel==='Escape') splitter.emit('keydown',{key:cancel});
    else if(cancel==='blur') window.emit('blur');
    else splitter.emit(cancel,{pointerId:21});
    flush();assert.equal(body.hidden,true);assert.equal(splitter.hidden,false);assert.equal(value(),0);
  }
  for(const key of ['ArrowDown','Home','Escape']) {
    splitter.emit('keydown',{key});flush();assert.equal(body.hidden,true);
  }
  for(const key of ['ArrowUp','Enter','End']) {
    splitter.emit('keydown',{key});flush();assert.equal(body.hidden,false);
    assert.equal(value(),key==='End'?79.8:35);
    deps.collapseAnalysis();flush();
  }
  splitter.emit('dblclick');flush();assert.equal(body.hidden,false);assert.equal(value(),35);
  deps.collapseAnalysis();flush();
  const pull=(delta,finish='pointerup')=>{
    heading.emit('pointerdown',{pointerId:11});heading.emit('pointermove',{pointerId:11,clientY:400+delta});
    heading.emit(finish,{pointerId:11,clientY:400+delta});flush();
  };
  pull(-3);assert.equal(body.hidden,true,'a header click/jitter does not expand it');
  pull(-260);assert.equal(body.hidden,false);assert.equal(splitter.hidden,false);assert.ok(value()>35);
  heading.emit('pointerdown',{pointerId:11});heading.emit('pointermove',{pointerId:11,clientY:1000});
  heading.emit('keydown',{key:'Escape'});flush();assert.equal(body.hidden,false,'cancelled collapse retains the open panel');
  dragBy(500);assert.equal(body.hidden,true);
  pull(-260,'pointercancel');assert.equal(body.hidden,true,'cancelled pull returns to the collapsed header');
  assert.equal(heading.captured,null);
  heading.emit('pointerdown',{target:{closest:()=>buttons[1]}});assert.equal(heading.captured,null,'buttons do not initiate a header drag');
  for(const button of buttons){
    deps.collapseAnalysis();flush();button.emit('click');flush();
    assert.equal(body.hidden,false);assert.equal(stage.dataset.analysisSize,button.dataset.analysisSize);
  }
  deps.collapseAnalysis();flush();buttons[2].emit('click');flush();
  assert.equal(stage.dataset.analysisSize,'max','maximum reopens as maximum after collapse');
  heading.emit('pointerdown',{pointerId:12});heading.emit('pointermove',{pointerId:12,clientY:1200});
  heading.emit('pointerup',{pointerId:12,clientY:1200});flush();assert.equal(body.hidden,true,'maximum can also collapse by dragging its header');
  assert.equal(splitter.hidden,false,'collapse from maximum also exposes the strip');
  dragBy(-260);assert.equal(body.hidden,false);assert.equal(splitter.hidden,false);
  assert.notEqual(stage.dataset.analysisSize,'max','pulling the strip restores image space');
  console.log('PASS permanent header and strip, collapse and expansion by mouse/touch, cancellation, keyboard reopening, button exclusion and all three sizes');
  for(const layout of [[2,2],[4,2],[4,1]])for(const pointerType of ['mouse','touch']){
    [count,columns]=layout;total=900;buttons[0].emit('click');flush();buttons[2].emit('click');flush();
    assert.equal(splitter.hidden,false);assert.equal(value(),100);assert.equal(sized(),false);
    for(const delta of [0,3,-80]){dragBy(delta,40,pointerType);assert.equal(stage.dataset.analysisSize,'max','click, jitter and upward drag retain maximum');}
    const before=redraws;order.length=0;
    splitter.emit('pointerdown',{pointerId:40,pointerType});
    splitter.emit('pointermove',{pointerId:40,pointerType,clientY:480});
    assert.notEqual(stage.dataset.analysisSize,'max');assert.equal(splitter.hidden,false);assert.equal(splitter.captured,40);
    ui.syncAnalysisLayout();observers.forEach(fn=>fn());flush();
    assert.equal(redraws,before,'restoring previews from maximum waits for release');
    splitter.emit('pointerup',{pointerId:40,pointerType,clientY:480});flush();
    assert.equal(body.hidden,false);assert.equal(splitter.hidden,false);assert.equal(redraws,before+1);
    assert.deepEqual(order,['canvases','resume','plots']);
    assert.ok(grid.getBoundingClientRect().height>=controlsHeight()+48*Math.ceil(count/columns));
  }
  total=800;count=2;columns=2;
  for(const cancel of ['pointercancel','lostpointercapture','Escape','blur']){
    buttons[0].emit('click');flush();dragBy(-80);buttons[2].emit('click');flush();
    splitter.emit('pointerdown',{pointerId:41});splitter.emit('pointermove',{pointerId:41,clientY:520});
    assert.notEqual(stage.dataset.analysisSize,'max');
    if(cancel==='Escape')splitter.emit('keydown',{key:cancel});
    else if(cancel==='blur')window.emit('blur');
    else splitter.emit(cancel,{pointerId:41});
    flush();assert.equal(stage.dataset.analysisSize,'max');assert.equal(value(),100);assert.equal(splitter.hidden,false);assert.equal(sized(),false);
    buttons[2].emit('click');flush();assert.equal(value(),45,'cancel also retains the pre-maximum manual split');
  }
  for(const key of ['ArrowDown','Home','Enter','dblclick']){
    buttons[0].emit('click');flush();dragBy(-80);buttons[2].emit('click');flush();
    for(const retain of ['ArrowUp','End']){splitter.emit('keydown',{key:retain});flush();assert.equal(stage.dataset.analysisSize,'max');assert.equal(value(),100);}
    if(key==='dblclick')splitter.emit(key);else splitter.emit('keydown',{key});
    flush();assert.equal(stage.dataset.analysisSize,'compact');assert.equal(splitter.hidden,false);
    assert.equal(value(),key==='ArrowDown'?45:key==='Home'?23.3:35);
  }
  console.log('PASS maximum splitter: visible, downward mouse/touch drag in 2/4 layouts, deferred redraw, cancellation and keyboard return');
  for(const pointerType of ['mouse','touch'])for(const finish of ['pointerup','pointercancel','lostpointercapture','Escape','blur']){
    buttons[0].emit('click');flush();order.length=0;const before=redraws;
    // Also leave a frame pending before pointerdown, as a real ResizeObserver can do.
    ui.syncAnalysisLayout();
    splitter.emit('pointerdown',{pointerId:30,pointerType});assert.equal(paused,true);
    splitter.emit('pointermove',{pointerId:30,pointerType,clientY:320});
    observers.forEach(fn=>fn());flush();
    assert.equal(value(),45);assert.equal(redraws,before);assert.deepEqual(order,[]);
    ui.syncAnalysisLayout();flush();assert.equal(splitter.captured,30,'analysis/layout feedback must not finish the gesture');
    splitter.emit('pointermove',{pointerId:30,pointerType,clientY:280});flush();
    assert.equal(value(),50);assert.equal(redraws,before);assert.equal(ui.isAnalysisResizing(),true);
    if(finish==='Escape')splitter.emit('keydown',{key:finish});
    else if(finish==='blur')window.emit('blur');
    else splitter.emit(finish,{pointerId:30,pointerType,clientY:280});
    flush();assert.equal(ui.isAnalysisResizing(),false);assert.equal(paused,false);
    assert.equal(value(),finish==='pointerup'?50:35);
    assert.equal(redraws,before+1);assert.deepEqual(order,['canvases','resume','plots'],'commit final canvas dimensions before resuming analysis');
  }
  console.log('PASS deferred rendering during mouse/touch resize, queued frames/observers/feedback, one final redraw and cancellation');

  const selected=()=>{
    const pressed=allButtons.filter(button=>button.getAttribute('aria-pressed')==='true');
    assert.equal(pressed.length,1,'exactly one size segment is selected');
    assert.deepEqual(allButtons.filter(button=>button.classList.contains('active')),pressed);
    return pressed[0].dataset.analysisSize;
  };
  buttons[0].emit('click');flush();assert.equal(selected(),'compact');
  dragBy(-80);assert.equal(selected(),'manual');assert.equal(manualButton.disabled,false);
  buttons[1].emit('click');flush();assert.equal(value(),60);assert.equal(selected(),'balance');
  manualButton.emit('click');flush();assert.equal(value(),45);assert.equal(selected(),'manual');
  collapseButton.emit('click');flush();assert.equal(selected(),'collapsed');assert.equal(body.hidden,true);
  assert.equal(collapseButton.hidden,false);assert.equal(document.activeElement,collapseButton);
  collapseButton.emit('click');flush();assert.equal(body.hidden,true,'collapse segment never toggles open');
  manualButton.emit('click');flush();assert.equal(body.hidden,false);assert.equal(value(),45);assert.equal(selected(),'manual');
  buttons[2].emit('click');flush();assert.equal(selected(),'max');
  manualButton.emit('click');flush();assert.equal(value(),45);assert.equal(selected(),'manual');
  buttons[0].emit('click');flush();splitter.emit('keydown',{key:'ArrowUp'});flush();
  assert.equal(selected(),'manual');assert.equal(value(),37);
  buttons[1].emit('click');flush();manualButton.emit('click');flush();assert.equal(value(),37,'keyboard adjustments also update manual memory');
  for(const cancel of ['pointercancel','lostpointercapture','Escape','blur']){
    buttons[0].emit('click');flush();
    splitter.emit('pointerdown',{pointerId:60});splitter.emit('pointermove',{pointerId:60,clientY:280});
    assert.equal(selected(),'manual','manual is highlighted while dragging');
    if(cancel==='Escape')splitter.emit('keydown',{key:cancel});else if(cancel==='blur')window.emit('blur');else splitter.emit(cancel,{pointerId:60});
    flush();assert.equal(selected(),'compact');manualButton.emit('click');flush();assert.equal(value(),37,'cancelled drag must not replace saved manual position');
  }
  dragBy(500);assert.equal(selected(),'collapsed');manualButton.emit('click');flush();assert.equal(value(),37,'drag-to-collapse keeps the last useful manual position');
  buttons[1].emit('click');flush();dragBy(80);assert.equal(value(),50);
  buttons[0].emit('click');flush();manualButton.emit('click');flush();assert.equal(value(),50);assert.equal(stage.dataset.analysisSize,'balance','manual keeps its responsive base preset');
  total=1200;window.emit('resize');flush();assert.equal(value(),50);
  collapseButton.emit('click');flush();buttons[2].emit('click');flush();assert.equal(selected(),'max');
  manualButton.emit('click');flush();assert.equal(value(),50);assert.equal(selected(),'manual');
  console.log('PASS size segments: one active choice, collapse focus, manual memory across presets/maximum/collapse/resize, live highlight and cancellation');
  const stored=ui.captureAnalysisLayoutPreferences();
  ui.applyAnalysisLayoutPreferences({size:'compact',previous:'compact',ratio:null,lastManual:null,collapsed:false});flush();
  assert.equal(selected(),'compact');assert.equal(manualButton.disabled,true);
  ui.applyAnalysisLayoutPreferences({...stored,collapsed:true});flush();assert.equal(selected(),'collapsed');
  assert.equal(collapseButton.getAttribute('aria-expanded'),'false');
  manualButton.emit('click');flush();assert.equal(selected(),'manual');assert.equal(value(),50);
  const committed=ui.captureAnalysisLayoutPreferences();
  splitter.emit('pointerdown',{pointerId:91});splitter.emit('pointermove',{pointerId:91,clientY:250});
  assert.deepEqual(ui.captureAnalysisLayoutPreferences(),committed,'storage reads the committed split during a drag');
  splitter.emit('pointercancel',{pointerId:91});flush();
  ui.applyAnalysisLayoutPreferences({...stored,size:'max'});flush();assert.equal(selected(),'max');
  buttons[2].emit('click');flush();assert.equal(value(),50);
  console.log('PASS persisted preset, collapse, maximum, manual memory, reset and committed-only drag snapshots');
})().catch(error=>{console.error(error);process.exitCode=1;});
