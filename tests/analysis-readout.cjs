const assert=require('node:assert/strict');
(async()=>{
 const {analysisReadout,differenceSummary,createAnalysisReadout}=await import('../src/ui/analysis-readout.mjs');
 const {createCmykPrintSample}=await import('../src/core/reference-samples.mjs');
 const {cmykStatistics}=await import('../src/core/cmyk.mjs');
 const sample=createCmykPrintSample(),region={x:16,y:8,width:608,height:344};
 const stats=cmykStatistics(sample,sample,260,region);
 const snapshot={source:{name:'test'},settings:{type:'cmyk',scope:'region',display:'separate'},items:[{label:'1 CMYK',data:stats}]};
 const text=analysisReadout(snapshot);
 assert(text.includes('всем пикселям области')&&text.includes('K-only')&&text.includes('Среднее абсолютное отклонение K: 0%'));
 assert(text.includes('X=16, Y=8, 608×344'));
 assert.notEqual(stats.means[3],cmykStatistics(sample).means[3],'fixture separates ROI mean from full image');
 const d={pixelCount:10,bounds:{x:3,y:4,width:5,height:2},changed:[0,7],means:[0,63.75],maxima:[0,255]};
 assert(differenceSummary(d,1).includes('7 пикселей (70%)'));
 assert(differenceSummary(d,1).includes('63,75 уровня из 255'));
 snapshot.settings={type:'difference',scope:'region',display:'separate',differenceChannel:'alpha'};
 snapshot.items=[{label:'1 alpha',data:d}];
 assert(analysisReadout(snapshot).includes('X=3, Y=4, 5×2'));
 const {computeLineProfile}=await import('../src/core/line-profile.mjs');
 const line=computeLineProfile({width:3,height:2,data:new Uint8ClampedArray([0,0,0,0,0,0,0,128,0,0,0,255,0,0,0,255,0,0,0,255,0,0,0,255])},'white',null,{x0:0,y0:0,x1:1000,y1:0});
 snapshot.settings={type:'profile',scope:'full',display:'separate',profileChannel:'alpha'};snapshot.items=[{label:'line',data:line}];
 assert(analysisReadout(snapshot).includes('3 отсчётов линии'));
 assert(analysisReadout(snapshot).includes('α 127,667'));
 snapshot.items=[{label:'2',message:'Расчёт…'}];
 assert(!analysisReadout(snapshot).includes('70%'),'pending must not retain previous counts');
 class Element{
  constructor(){this.handlers={};this.hidden=true;this.disabled=false;this.attrs={};}
  addEventListener(k,f){(this.handlers[k]??=[]).push(f)}
  setAttribute(k,v){this.attrs[k]=v}
  contains(e){return e===this||(this===root&&(e===button||e===content))}
  focus(){global.document.activeElement=this;root.fire('focusin')}
  fire(k,e={}){for(const f of this.handlers[k]||[])f({preventDefault(){},stopPropagation(){},...e})}
 }
 const root=new Element(),button=new Element(),content=new Element(),doc=new Element(),panel=new Element();
 root.closest=()=>panel;global.window=new Element();
 let resize;global.ResizeObserver=class{constructor(callback){resize=callback}observe(el){assert.equal(el,panel)}};
 global.document=doc;
 const c=createAnalysisReadout(root,button,content);c.attach();c.attach();
 c.update(snapshot);button.fire('pointerenter');assert(!content.hidden);assert.equal(button.attrs['aria-expanded'],'true');
 button.fire('click');root.fire('pointerleave');await new Promise(r=>setTimeout(r,150));assert(!content.hidden,'click pins the readout');
 root.fire('keydown',{key:'Escape'});assert(content.hidden);
 root.fire('focusin');assert(!content.hidden);
 root.fire('focusout',{relatedTarget:null});assert(content.hidden);
 button.fire('click');assert(!content.hidden);
 c.update({source:null});assert(button.disabled&&content.hidden&&content.textContent==='');
 assert.equal(button.handlers.pointerenter.length,1);
 c.update(snapshot);button.fire('pointerenter');resize();assert(content.hidden,'panel resizing closes stale hover content');
 root.fire('focusin');window.fire('resize');assert(content.hidden);
 button.fire('click');doc.fire('scroll',{target:content});assert(!content.hidden,'readout itself stays scrollable');
 doc.fire('scroll',{target:panel});assert(!content.hidden,'a pinned popup stays readable while scrolling');
 doc.fire('pointerdown',{target:panel});assert(content.hidden);
 document.activeElement=panel;button.fire('pointerenter');doc.fire('scroll',{target:panel});assert(content.hidden,'external scroll closes an unpinned hover popup');
 root.fire('focusin');document.activeElement=content;window.fire('resize');assert(content.hidden&&document.activeElement===button,'closing focused content restores a visible focus');
 delete global.window;delete global.ResizeObserver;
 console.log('PASS ROI-aware readout, pixel counts/percent/levels, no stale values, hover/focus/click/Escape');
})().catch(e=>{console.error(e);process.exitCode=1});
