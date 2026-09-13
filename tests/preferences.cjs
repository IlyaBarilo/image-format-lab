// Node-only storage/event fixtures, not browser rendering or real file:// storage.
const assert = require('node:assert/strict');
function events() {
  const handlers=new Map();
  return {addEventListener(name,fn){const list=handlers.get(name)||[];list.push(fn);handlers.set(name,list);},
    emit(name,event={}){for(const fn of handlers.get(name)||[])fn(event);},count(name){return (handlers.get(name)||[]).length;}};
}
(async()=>{
  const {PREFERENCES_KEY,defaultPreferences,normalizePreferences}=await import('../src/core/preferences.mjs');
  const {BATCH_STORAGE_KEY,PROFILE_KEY,DEFAULT_EXPORT_CONFIG}=await import('../src/core/config.mjs');
  const {THEME_STORAGE_KEY}=await import('../src/ui/theme.mjs');
  const {validateComparison}=await import('../src/core/settings.mjs');
  const {createStudy}=await import('../src/ui/study.mjs');
  const {createPreferences}=await import('../src/ui/preferences.mjs');
  const defaults=defaultPreferences(),custom=defaultPreferences();
  custom.comparison.layout=4;custom.comparison.background='black';custom.comparison.autoApply=false;
  custom.comparison.metadataPolicy='none';custom.comparison.variants[1].quality=37;custom.comparison.variants[3].format='avif';
  custom.filesVisible=false;custom.panels={size:'max',previous:'balance',ratio:.52,collapsed:true,lastManual:{size:'balance',ratio:.52}};
  Object.assign(custom.analysis,{type:'profile',channel:'alpha',matte:'black',level:208,gain:16,differenceChannel:'alpha',profileChannel:'y',position:870,
    pair:[2,4],metric:'processingMs',scope:'region',region:{x0:250,y0:0,x1:800,y1:600},line:{x0:1000,y0:0,x1:0,y1:1000},
    displays:{histogram:'delta',waveform:'overlay',parade:'delta',vectorscope:'overlay',profile:'separate'}});
  assert.deepEqual(normalizePreferences(custom),custom);
  assert.equal(defaultPreferences().comparison.variants[1].quality,85);
  for(const value of [null,[],{version:2},'garbage'])assert.deepEqual(normalizePreferences(value),defaults);
  const invalid=structuredClone(custom);
  invalid.comparison.variants[0].format='__proto__';invalid.filesVisible='false';
  invalid.panels={size:'bad',previous:'max',ratio:Infinity,collapsed:1,lastManual:{size:'max',ratio:.4}};
  invalid.analysis={type:'bad',channel:'toString',matte:'bad',level:256,gain:'4',position:-1,profileChannel:'bad',pair:[2,4],metric:'bad',scope:'region',region:{x0:0,y0:0,x1:0,y1:10},line:{x0:0,y0:0,x1:1001,y1:0},displays:{histogram:'bad',vectorscope:'delta'}};
  assert.deepEqual(normalizePreferences(invalid),defaults);
  const extras=structuredClone(custom);extras.files=['private.png'];extras.analysis.pixels=[1,2];extras.panels.left=-100;
  extras.comparison.variants[0].blob='private';extras.analysis.region.secret='private';
  assert.deepEqual(normalizePreferences(extras),custom,'only allowlisted settings cross the storage boundary');
  console.log('PASS schema, independent defaults, bounds, four variants, geometry and field allowlist');

  function use({raw=null,readDenied=false,writeDenied=false,deleteDenied=false}={}){
    const values=new Map([[PROFILE_KEY,'named profiles'],[BATCH_STORAGE_KEY,'saved batch'],[THEME_STORAGE_KEY,'dark'],['unrelated','keep']]);
    if(raw!==null)values.set(PREFERENCES_KEY,raw);
    const writes=[],removed=[],messages=[],pending=new Map();let next=0;
    const storage={getItem(key){if(readDenied)throw Error('denied');return values.get(key)??null;},
      setItem(key,value){if(writeDenied)throw Error('quota');values.set(key,value);writes.push([key,value]);},
      removeItem(key){if(deleteDenied)throw Error('denied');values.delete(key);removed.push(key);}};
    const elements=new Map(),get=id=>{
      if(!elements.has(id)){const classes=new Set();elements.set(id,{...events(),value:'',checked:false,open:false,attrs:{},
        setAttribute(k,v){this.attrs[k]=String(v);},close(){this.open=false;this.emit('close');},
        classList:{contains:k=>classes.has(k),toggle(k,on){if(on)classes.add(k);else classes.delete(k);}},
        closest(selector){return selector==='#resetPreferences'?(id==='resetPreferences'?this:null):this;}});}
      return elements.get(id);
    };
    const document={...events(),getElementById:get,visibilityState:'visible'};
    const window={...events(),localStorage:storage};global.document=document;global.window=window;
    global.setTimeout=fn=>{pending.set(++next,fn);return next;};global.clearTimeout=id=>pending.delete(id);
    const flush=()=>{for(const [id,fn] of [...pending]){pending.delete(id);fn();}};
    const els=Object.fromEntries(['workspace','toggleFiles','autoApply','metadataPolicy','backgroundSelect','batchDialog'].map(id=>[id,get(id)]));
    const file={name:'private.png'},source={pixels:'private pixels'},profiles=[{name:'kept'}],results=[{blob:'kept result'}];
    const app={files:[file],source,profiles,batchRun:{running:false,results},exportConfig:{format:'avif'},variants:defaults.comparison.variants.map(config=>({config:{...config},generation:3,blob:'old result'}))};
    let layout,output,region,resizing=false,renders=0,dirtyCalls=0;
    const studyDeps={validateComparison,markDirty(v){assert.equal(els.autoApply.checked,false,'no auto-encode timers while applying all variants');v.generation++;v.dirty=true;dirtyCalls++;},
      disposeVariantOutput(v){v.blob=null;},buildCellControls(){},buildMetrics(){},updateFormatOptions(){},resetView(){},
      updateLayout(value){app.layout=value;renders++;},formatUnavailableReason(){return '';},studyNotice(){}};
    const study=createStudy({app,els},studyDeps);
    const deps={...study,applyAnalysisLayoutPreferences(v){layout=structuredClone(v);},captureAnalysisLayoutPreferences:()=>layout,
      applyAnalysisOutputPreferences(v){output={displays:structuredClone(v.displays),pair:[...v.pair],metric:v.metric};},captureAnalysisOutputPreferences:()=>output,
      applyAnalysisRegionPreferences(v){region={scope:v.scope,region:structuredClone(v.region),line:structuredClone(v.line)};},captureAnalysisRegionPreferences:()=>region,
      isAnalysisResizing:()=>resizing,showStatus:(...args)=>messages.push(args),updateBatchUI(){},updateAnalysis(){},drawAll(){},
      resetTheme(){try{storage.removeItem(THEME_STORAGE_KEY);return true;}catch{return false;}}};
    const ui=createPreferences({app,els},deps);ui.restoreUserPreferences();ui.attachUserPreferenceEvents();
    return {ui,app,els,get,document,window,values,writes,removed,messages,pending,flush,file,source,profiles,results,
      resize:v=>resizing=v,renders:()=>renders,dirtyCalls:()=>dirtyCalls,
      change(id,value,event='change'){get(id).value=value;document.emit(event,{target:get(id)});}};
  }
  let env=use({raw:JSON.stringify(custom)});
  assert.deepEqual(env.ui.captureUserPreferences(),custom);assert.equal(env.renders(),0,'restore precedes initial controls/rendering');
  assert.equal(env.els.toggleFiles.attrs['aria-expanded'],'false');assert.equal(env.get('analysisPositionValue').textContent,'87%');
  env.ui.attachUserPreferenceEvents();assert.equal(env.document.count('input'),1);assert.equal(env.get('resetPreferences').count('click'),1);
  env.ui.flushUserPreferences();assert.equal(env.writes.length,0);
  env.change('analysisType','histogram');env.change('analysisChannel','r');env.change('analysisLevel','24','input');
  assert.equal(env.pending.size,1);assert.equal(env.writes.length,0);env.flush();assert.equal(env.writes.length,1);
  assert.equal(env.writes[0][0],PREFERENCES_KEY);const saved=JSON.parse(env.writes[0][1]);
  assert.equal(saved.analysis.type,'histogram');assert.equal(saved.analysis.level,24);assert.deepEqual(saved.analysis.displays,custom.analysis.displays);
  assert.ok(!env.writes[0][1].includes('private'));env.ui.flushUserPreferences();assert.equal(env.writes.length,1);
  env=use({raw:JSON.stringify(saved)});assert.deepEqual(env.ui.captureUserPreferences(),saved,'new instance restores saved preferences');
  env.change('analysisLevel','31','input');env.window.emit('pagehide');assert.equal(env.pending.size,0);assert.equal(JSON.parse(env.values.get(PREFERENCES_KEY)).analysis.level,31);
  env.resize(true);env.change('analysisLevel','32');env.flush();assert.equal(env.writes.length,1,'no write during splitter drag');
  env.resize(false);env.document.emit('pointerup',{target:env.get('analysisSplitter')});env.flush();assert.equal(env.writes.length,2);
  env.change('analysisLevel','33');env.document.visibilityState='hidden';env.document.emit('visibilitychange');assert.equal(JSON.parse(env.values.get(PREFERENCES_KEY)).analysis.level,33);
  console.log('PASS restoration, per-graph modes, debouncing, exit/visibility flush and deferred resize persistence');

  env.change('analysisLevel','99');env.els.batchDialog.open=true;env.get('studyDialog').open=true;
  env.get('resetPreferences').emit('click');assert.equal(env.pending.size,0);env.flush();
  assert.deepEqual(env.ui.captureUserPreferences(),defaults);assert.deepEqual(env.app.exportConfig,DEFAULT_EXPORT_CONFIG);
  assert.equal(env.els.batchDialog.open,false);assert.equal(env.get('studyDialog').open,false);
  assert.equal(env.renders(),1);assert.equal(env.dirtyCalls(),4);assert.ok(env.app.variants.every(v=>v.generation===4&&v.blob===null&&v.dirty));
  assert.equal(env.app.files[0],env.file);assert.equal(env.app.source,env.source);assert.equal(env.app.profiles,env.profiles);assert.equal(env.app.batchRun.results,env.results);
  assert.deepEqual(new Set(env.removed),new Set([PREFERENCES_KEY,BATCH_STORAGE_KEY,THEME_STORAGE_KEY]));
  assert.equal(env.values.get(PROFILE_KEY),'named profiles');assert.equal(env.values.get('unrelated'),'keep');
  env.ui.flushUserPreferences();assert.equal(env.values.has(PREFERENCES_KEY),false,'pending pre-reset save cannot restore old values');
  env.app.batchRun.running=true;env.change('analysisType','waveform');env.ui.resetUserPreferences();assert.equal(env.get('analysisType').value,'waveform');
  env.app.batchRun.running=false;env.resize(true);env.ui.resetUserPreferences();assert.equal(env.get('analysisType').value,'waveform');
  console.log('PASS live reset invalidation, pending-write cancellation, preservation of files/profiles/results/foreign keys and active-work guard');

  for(const raw of ['{broken','x'.repeat(65537)]){env=use({raw});assert.deepEqual(env.ui.captureUserPreferences(),defaults);assert.equal(env.messages.length,1);}
  env=use({readDenied:true});assert.deepEqual(env.ui.captureUserPreferences(),defaults);assert.equal(env.messages.length,1);
  env=use({writeDenied:true});env.change('analysisType','waveform');env.flush();env.ui.flushUserPreferences();
  assert.equal(env.get('analysisType').value,'waveform');assert.equal(env.messages.length,1);assert.equal(env.values.has(PREFERENCES_KEY),false);
  env=use({raw:JSON.stringify(custom),deleteDenied:true});env.ui.resetUserPreferences();
  assert.deepEqual(env.ui.captureUserPreferences(),defaults);assert.equal(env.messages.at(-1)[1],true);assert.equal(env.values.get(PROFILE_KEY),'named profiles');
  console.log('PASS malformed/oversized JSON and storage read/write/delete failure fallback');

  const {createBootstrap}=await import('../src/ui/bootstrap.mjs');
  const app={layout:2},order=[];global.document={querySelectorAll:()=>Array.from({length:4},()=>({querySelector:()=>({getContext:()=>({})})}))};
  const deps=new Proxy({restoreUserPreferences(){app.layout=4;app.variants.forEach(v=>v.config.quality=23);order.push('restored');},
    buildCellControls(v){assert.equal(v.config.quality,23);order.push('built');},updateLayout(n){assert.equal(n,4);order.push('layout');},
    attachUserPreferenceEvents(){assert.equal(order.at(-1),'layout');order.push('attached');}},
    {get(target,key){return target[key]||(()=>{});}});
  createBootstrap({app,els:{}},deps).init();assert.equal(order[0],'restored');assert.equal(order.at(-1),'attached');
  console.log('PASS actual bootstrap restores before cell controls and retains saved layout at first render');
})().catch(error=>{console.error(error);process.exitCode=1;});
