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
  constructor(){this.handlers={};this.hidden=true;this.disabled=false;this.attrs={};this.box={left:20,top:40,width:100,height:30};}
  getBoundingClientRect(){return {...this.box}}
  addEventListener(k,f){(this.handlers[k]??=[]).push(f)}
  setAttribute(k,v){this.attrs[k]=v}
  contains(e){return e===this||(this===root&&(e===button||e===content))}
  focus(){global.document.activeElement=this;root.fire('focusin')}
  fire(k,e={}){for(const f of this.handlers[k]||[])f({preventDefault(){},stopPropagation(){},...e})}
 }
 const root=new Element(),button=new Element(),content=new Element(),doc=new Element(),panel=new Element();
 root.closest=()=>panel;global.window=new Element();window.innerWidth=1024;window.innerHeight=768;
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
 c.update(snapshot);button.fire('pointerenter');panel.box.height++;resize();assert(content.hidden,'panel resizing closes stale hover content');
 root.fire('focusin');window.innerWidth++;window.fire('resize');assert(content.hidden);
 button.fire('click');doc.fire('scroll',{target:content});assert(!content.hidden,'readout itself stays scrollable');
 doc.fire('scroll',{target:panel});assert(!content.hidden,'a pinned popup stays readable while scrolling');
 doc.fire('pointerdown',{target:panel});assert(content.hidden);
 document.activeElement=panel;button.fire('pointerenter');button.box.top--;doc.fire('scroll',{target:panel});assert(content.hidden,'external scroll closes an unpinned hover popup');
 root.fire('focusin');document.activeElement=content;window.innerHeight++;window.fire('resize');assert(content.hidden&&document.activeElement===button,'closing focused content restores a visible focus');
 // Queued notifications describe an earlier layout, not a new movement after open.
 document.activeElement=panel;button.box.top-=20;doc.fire('scroll',{target:panel});
 button.fire('pointerenter');assert(!content.hidden,'hover after scrolling opens the popup');
 doc.fire('scroll',{target:panel});assert(!content.hidden,'late ancestor scroll with unchanged geometry must not close hover');
 const unrelated=new Element();doc.fire('scroll',{target:unrelated});assert(!content.hidden,'unrelated scrolling must not close hover');
 resize();assert(!content.hidden,'first observer delivery at the opening geometry is harmless');
 resize();window.fire('resize');assert(!content.hidden,'duplicate layout notifications without movement are harmless');
 button.box.top-=5;doc.fire('scroll',{target:panel});assert(content.hidden,'real ancestor movement after hover still closes the popup');
 button.fire('pointerenter');doc.fire('scroll',{target:panel});assert(!content.hidden,'scroll then enter and enter then queued scroll both work');
 panel.box.width++;resize();assert(content.hidden,'a real panel width change closes hover');
 button.fire('pointerenter');window.innerWidth++;window.fire('resize');assert(content.hidden,'a real viewport change closes hover');
 button.fire('pointerenter');button.fire('click');button.box.top--;doc.fire('scroll',{target:panel});assert(!content.hidden,'pinning still allows scrolling with a moved anchor');
 panel.box.height++;resize();assert(content.hidden,'real panel resizing closes a pinned popup');
 root.fire('focusin');document.activeElement=content;doc.fire('scroll',{target:content});assert(!content.hidden,'focused popup content remains scrollable');
 button.box.top--;doc.fire('scroll',{target:panel});assert(!content.hidden,'scroll does not steal focus from the popup');
 panel.box.height++;resize();assert(content.hidden&&document.activeElement===button,'real layout closure restores focus from the content');
 document.activeElement=panel;button.fire('pointerenter');root.fire('pointerleave');await new Promise(r=>setTimeout(r,150));assert(content.hidden,'leaving an unpinned popup still closes it');
 button.fire('pointerenter');doc.fire('pointerdown',{target:panel});assert(content.hidden,'outside pointerdown still closes hover');
 delete global.window;delete global.ResizeObserver;
 console.log('PASS ROI-aware readout, pixel counts/percent/levels, no stale values, hover/focus/click/Escape');
})().catch(e=>{console.error(e);process.exitCode=1});
