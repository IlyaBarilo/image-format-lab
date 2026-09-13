// Own analysis display/export controls, MIT. Modules are wired by application.
import {analysisJSON,tradeoffData,ANALYSIS_CHANNELS} from '../core/analysis-output.mjs';
import {profileBinAt} from '../core/line-profile.mjs';
import {analysisDelta,deltaAt,DELTA_TYPES} from '../core/analysis-delta.mjs';
const NAMES=['R','G','B','α','Y′'];
const fmt=n=>n===Infinity?'∞':n.toLocaleString('ru-RU',{maximumFractionDigits:3});
const deltaFmt=n=>(n>0?'+':'')+(n!==0&&Math.abs(n)<.001?n.toExponential(2):n.toLocaleString('ru-RU',{maximumSignificantDigits:3}));
export function createAnalysisOutput({app},deps){
  const get=id=>document.getElementById(id),pair=get('analysisPair'),metric=get('analysisMetric');
  const displayInputs=[['separate',get('analysisDisplaySeparate')],['overlay',get('analysisDisplayOverlay')],['delta',get('analysisDisplayDelta')]];
  // Each diagram keeps its own display choice; preferences persist this map.
  const displays=new Map([['histogram','overlay'],['profile','overlay']]);
  const combined=get('analysisCombined'),canvas=get('analysisCombinedChart'),legend=get('analysisCombinedLegend'),note=get('analysisCombinedInfo');
  const png=get('analysisPNG'),json=get('analysisJSON'),notice=get('analysisSaveStatus');
  let saving=false,attached=false,lastDelta=null;
  function deltaModel(items,settings){
    const key=[settings.type,settings.channel,settings.profileChannel,...items.map(i=>i.cell)].join(':');
    if(!lastDelta||lastDelta.key!==key||items.some((item,i)=>item.data!==lastDelta.data[i]))lastDelta={key,data:items.map(i=>i.data),model:analysisDelta(items,settings)};
    return lastDelta.model;
  }
  function getAnalysisOutputSettings(){
    const kind=get('analysisType').value;
    return {display:kind==='tradeoff'?'metrics':kind==='difference'?'separate':displays.get(kind)||'separate',pair:pair.value.split(',').map(Number),metric:metric.value};
  }
  function captureAnalysisOutputPreferences(){return {...getAnalysisOutputSettings(),displays:Object.fromEntries(displays)};}
  function applyAnalysisOutputPreferences(value){
    displays.clear();for(const [kind,display] of Object.entries(value.displays))displays.set(kind,display);
    metric.value=value.metric;syncAnalysisOutput();pair.value=value.pair.join(',');syncAnalysisOutput();lastDelta=null;
  }
  function syncAnalysisOutput(){
    const kind=get('analysisType').value,key=String(app.layout);
    if(pair.dataset.layout!==key){const old=pair.value;pair.replaceChildren();for(let a=1;a<=app.layout;a++)for(let b=a+1;b<=app.layout;b++){const option=document.createElement('option');option.value=`${a},${b}`;option.textContent=`${a} + ${b}`;pair.append(option);}pair.value=[...pair.options].some(o=>o.value===old)?old:'1,2';pair.dataset.layout=key;}
    const settings=getAnalysisOutputSettings();
    for(const option of pair.options){const [a,b]=option.value.split(',');option.textContent=settings.display==='delta'?`${b} − ${a}`:`${a} + ${b}`;}
    get('analysisDisplayField').hidden=['tradeoff','difference'].includes(kind);
    get('analysisDisplayDeltaField').hidden=!DELTA_TYPES.includes(kind);
    for(const [value,input] of displayInputs){input.checked=settings.display===value;input.disabled=['tradeoff','difference'].includes(kind)||(value==='delta'&&!DELTA_TYPES.includes(kind));}
    get('analysisPairField').hidden=!['overlay','delta'].includes(settings.display)||app.layout===2;
    get('analysisMetricField').hidden=kind!=='tradeoff';
    combined.hidden=settings.display==='separate';
    get('analysisPanel').querySelector('.analysis-plots').hidden=!combined.hidden;
  }
  function chosen(snapshot){return ['overlay','delta'].includes(snapshot.settings.display)?snapshot.settings.pair.map(cell=>snapshot.items.find(i=>i.cell===cell)).filter(Boolean):snapshot.items;}
  function presentAnalysis(snapshot){
    if (deps.isAnalysisResizing()) return;
    let render = null;
    syncAnalysisOutput();const items=chosen(snapshot),shared=snapshot.settings.display!=='separate';
    if(snapshot.settings.display!=='delta')lastDelta=null;
    let available=items.some(i=>i.data);
    if(shared){
      canvas.hidden=true;canvas.getContext('2d').clearRect(0,0,canvas.width,canvas.height);canvas.removeAttribute('data-kind');canvas.removeAttribute('data-points');legend.replaceChildren();note.textContent='';
      if(['overlay','delta'].includes(snapshot.settings.display)){
        const delta=snapshot.settings.display==='delta';
        available=items.length===2&&items.every(i=>i.data);
        if(available){canvas.hidden=false;
          if(delta){
            const model=deltaModel(items,snapshot.settings),span=document.createElement('span');
            render=()=>deps.renderAnalysisDelta(canvas,model,snapshot.settings);
            span.textContent=`Δ ${items[1].cell} − ${items[0].cell}`;span.title=`${items[1].label} минус ${items[0].label}`;legend.append(span);
            if(model.columns){
              for(const [text,color] of [['− уменьшение','var(--scope-first)'],['+ прибавление','var(--scope-second)']]){const marker=document.createElement('span');marker.textContent=text;marker.style.color=color;legend.append(marker);}
              const scale=document.createElement('span');scale.textContent=`Шкала ±${deltaFmt(model.maximum).replace(/^\+/,'')} п.п.`;legend.append(scale);
            }else for(const {index,values} of model.channels){
              const value=model.type==='histogram'?values[snapshot.settings.level]:deltaAt(values,snapshot.settings.position/1000),marker=document.createElement('span');
              marker.textContent=`${NAMES[index]} ${deltaFmt(value)} ${model.unit==='code-values'?'ур.':'п.п.'}`;legend.append(marker);
            }
            if(model.maximum===0)note.textContent='Графики совпадают: разница равна нулю.';
          }else{
          render=()=>deps.renderAnalysisOverlay(canvas,items,snapshot.settings);
          const lines=['histogram','profile'].includes(snapshot.settings.type);
          items.forEach((item,i)=>{const span=document.createElement('span'),s=snapshot.settings,d=item.data;
            let values='';
            if(s.type==='histogram')values=ANALYSIS_CHANNELS[s.channel].map(c=>`${NAMES[c]} ${fmt(d.channels[c][s.level]/d.pixelCount*100)}%`).join(' · ');
            if(s.type==='profile'){const bin=profileBinAt(d,s.position);values=ANALYSIS_CHANNELS[s.profileChannel].map(c=>`${NAMES[c]} ${fmt(d.channels[c].mean[bin])}${d.counts[bin]>1?` [${d.channels[c].min[bin]}–${d.channels[c].max[bin]}]`:''}`).join(' · ');}
            span.textContent=`${item.cell} ${lines?(i?'□ контур':'■ заливка'):'●'}${values?' · '+values:''}`;if(!lines)span.style.color=i?'var(--scope-second)':'var(--scope-first)';span.title=item.label;legend.append(span);
          });
          }
          const descriptions=items.map(i=>`${i.label}: ${i.data.width}×${i.data.height}, область ${i.data.bounds.x}, ${i.data.bounds.y}: ${i.data.bounds.width}×${i.data.bounds.height}${i.data.sampleCount?`, ${i.data.sampleCount} отсчётов`:''}`);
          get('analysisDetails').textContent=descriptions.join('\n');
          const sizes=new Set(items.map(i=>`${i.data.width}×${i.data.height}`));get('analysisStatus').textContent=sizes.size>1?(snapshot.settings.scope==='viewport'?'Размеры различаются; анализируется видимая часть каждой ячейки без выравнивания содержимого.':'Размеры различаются; используются одинаковые относительные область и линия без выравнивания содержимого.'):'';
          canvas.setAttribute('aria-label',`${delta?`Разница: ячейка ${items[1].cell} минус ${items[0].cell}`:`Наложение ячеек ${items.map(i=>i.cell).join(' и ')}`}. ${snapshot.method} ${descriptions.join('. ')}. ${[...legend.children].map(s=>s.textContent).join('; ')}. ${note.textContent}`);
        }else {lastDelta=null;note.textContent=items.filter(i=>!i.data).map(i=>`${i.cell}: ${i.message||'Расчёт…'}`).join(' ')||'Для сравнения нужны две готовые ячейки.';get('analysisStatus').textContent='';}
      }else{
        const model=tradeoffData(items,snapshot.settings.metric,snapshot.source);available=model.points.length>0;
        if(available){canvas.hidden=false;render=()=>deps.renderAnalysisTradeoff(canvas,model);}
        for(const p of model.points){const span=document.createElement('span');span.textContent=`${p.cell}: ${fmt(p.bytes/1000)} КБ · ${fmt(p.value)} ${model.metric==='psnrRGB'?'dB':model.metric==='processingMs'?'мс':'%'}`;span.title=`${p.label} · ${p.width}×${p.height}`;legend.append(span);}
        note.textContent=model.omitted.map(p=>`${p.cell}: ${p.message}`).join(' ');
        canvas.setAttribute('aria-label',`Размер и ${model.label}. ${model.direction}. ${legend.textContent}. ${note.textContent}`);
        get('analysisDetails').textContent=items.map(i=>{
          const m=i.measurement,number=v=>typeof v==='number'&&!Number.isNaN(v)?fmt(v):'—';
          return `${i.label}: ${i.message||(!m?'Метрики недоступны.':`${m.width}×${m.height}; ${number(m.bytes/1000)} КБ; PSNR ${number(m.psnrRGB)} dB; ошибка α ${number(m.alphaErrorPercent)}%; обработка ${number(m.processingMs)} мс.`)}`;
        }).join('\n');
        const sizes=new Set(model.points.map(p=>`${p.width}×${p.height}`));
        get('analysisStatus').textContent=sizes.size>1?'Размеры результатов различаются. Сопоставляйте их разрешение; недоступные метрики не показаны.':'';
      }
    }
    png.disabled=json.disabled=!available||saving||get('analysisBody').hidden;
    combined.dataset.state=available?'ready':'unavailable';
    // Legends and notices must take their final share before measuring the chart.
    if (!get('analysisBody').hidden) render?.();
  }
  function exportSnapshot(){
    const s=deps.getAnalysisSnapshot(),items=chosen(s);return {...s,items,...(s.settings.display==='delta'?{delta:deltaModel(items,s.settings)}:{}),createdAt:new Date().toISOString()};
  }
  function token(){const s=deps.getAnalysisSnapshot();return `${s.revision}:${JSON.stringify(s.settings)}:${get('analysisBody').hidden}`;}
  function wrap(ctx,text,width){
    const lines=[];
    for(const paragraph of text.split('\n')){let line='';
      for(let word of paragraph.split(/\s+/u).filter(Boolean)){
        if(line&&ctx.measureText(line+' '+word).width>width){lines.push(line);line='';}
        if(ctx.measureText(word).width>width){let piece='';for(const ch of word){if(ctx.measureText(piece+ch).width>width){lines.push(piece);piece=ch;}else piece+=ch;}word=piece;}
        line+=(line?' ':'')+word;
      }
      if(line)lines.push(line);
    }
    return lines;
  }
  function makeAnalysisPNG(snapshot){
    const output=document.createElement('canvas');output.width=1200;let ctx=output.getContext('2d');ctx.font='16px "Segoe UI",sans-serif';
    const selected=chosen(snapshot),shared=snapshot.settings.display!=='separate';
    const title=`Анализ · ${get('analysisType').selectedOptions[0].textContent}`;
    const header=wrap(ctx,`${snapshot.source.name} · ${snapshot.source.width}×${snapshot.source.height} · ${snapshot.createdAt}`,1152);
    const s=snapshot.settings,b=s.region,line=s.line;
    const parameterText=s.type==='tradeoff'?`Метрика: ${get('analysisMetric').selectedOptions[0].textContent}; весь кадр.`:
      `${s.display==='delta'?`Разница ячеек ${s.pair[1]} − ${s.pair[0]}`:s.display==='overlay'?`Наложение ячеек ${s.pair.join(' + ')}`:'Ячейки рядом'}; подложка: ${s.matte==='white'?'белая':'чёрная'}; область: ${s.scope==='viewport'?'видимая часть каждой ячейки':b?`${b.x0/10}%, ${b.y0/10}%, ${(b.x1-b.x0)/10}% × ${(b.y1-b.y0)/10}%`:'весь кадр'}`+
      (s.channel?`; каналы: ${s.channel}, уровень ${s.level}`:'')+(line?`; каналы: ${s.profileChannel}, позиция ${s.position/10}%; A (${line.x0/10}%, ${line.y0/10}%) → B (${line.x1/10}%, ${line.y1/10}%)`:'')+(s.gain?`; канал: ${s.differenceChannel}, усиление ×${s.gain}`:'');
    const viewportText=s.scope==='viewport'?'; '+s.viewports.filter(v=>selected.some(i=>i.cell===v.cell)).map(v=>v.region?`${v.cell}: X ${v.region.x}, Y ${v.region.y}, ${v.region.width}×${v.region.height} px`:`${v.cell}: нет видимых пикселей`).join('; '):'';
    const settings=wrap(ctx,parameterText+viewportText,1152);
    const method=wrap(ctx,snapshot.method,1152);
    const charts=shared?[{canvas,title:[...legend.children].map(s=>s.textContent).join(' · '),details:selected.map(i=>`${i.label}${i.data?` · ${i.data.width}×${i.data.height}`:''}${i.message?': '+i.message:''}`).join('; ')+(note.textContent?'. '+note.textContent:'')}]:selected.map(item=>({canvas:item.data?document.querySelectorAll('.analysis-card canvas')[item.cell-1]:null,title:item.label,details:item.message||document.querySelectorAll('.analysis-card canvas')[item.cell-1].getAttribute('aria-label')}));
    const columns=shared?1:2,chartWidth=(1152-(columns-1)*20)/columns,rows=[];
    for(let i=0;i<charts.length;i+=columns){const row=charts.slice(i,i+columns).map(c=>({...c,head:wrap(ctx,c.title,chartWidth),tail:wrap(ctx,c.details||'',chartWidth)}));rows.push({items:row,height:Math.max(...row.map(c=>c.head.length*22+300+c.tail.length*22+20))});}
    output.height=100+(header.length+settings.length+method.length)*22+rows.reduce((s,r)=>s+r.height,0);
    ctx=output.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,output.width,output.height);ctx.fillStyle='#17212b';ctx.textBaseline='top';ctx.font='bold 24px "Segoe UI",sans-serif';ctx.fillText(title,24,22);ctx.font='16px "Segoe UI",sans-serif';
    let y=60;for(const line of [...header,...settings]){ctx.fillText(line,24,y);y+=22;}y+=12;
    for(const row of rows){row.items.forEach((c,i)=>{const x=24+i*(chartWidth+20);let cy=y;for(const line of c.head){ctx.fillText(line,x,cy);cy+=22;}
      if(c.canvas&&!c.canvas.hidden){const scale=Math.min(chartWidth/c.canvas.width,280/c.canvas.height),w=c.canvas.width*scale,h=c.canvas.height*scale;ctx.fillStyle='#101923';ctx.fillRect(x,cy,chartWidth,280);ctx.drawImage(c.canvas,x+(chartWidth-w)/2,cy+(280-h)/2,w,h);ctx.fillStyle='#17212b';}
      cy+=300;for(const line of c.tail){ctx.fillText(line,x,cy);cy+=22;}});y+=row.height;}
    y+=12;for(const line of method){ctx.fillText(line,24,y);y+=22;}return output;
  }
  async function saveAnalysis(format){
    if(saving||(format==='png'?png:json).disabled)return;
    const start=token(),snapshot=exportSnapshot();saving=true;png.disabled=json.disabled=true;notice.textContent='';
    try{
      const blob=format==='json'?new Blob([analysisJSON(snapshot)],{type:'application/json'}):await new Promise((resolve,reject)=>makeAnalysisPNG(snapshot).toBlob(b=>b?resolve(b):reject(new Error('Не удалось создать PNG.')),'image/png'));
      if(start!==token()){notice.textContent='Анализ изменился. Сохраните актуальный результат ещё раз.';return;}
      deps.downloadBlob(blob,`analysis-${snapshot.settings.type}.${format}`);
    }catch(e){notice.textContent=e.message||String(e);}
    finally{saving=false;presentAnalysis(deps.getAnalysisSnapshot());}
  }
  function attachAnalysisOutputEvents(){
    if(attached)return;attached=true;
    for(const [value,input] of displayInputs)input.addEventListener('change',()=>{
      const kind=get('analysisType').value;
      if(!input.checked||input.disabled||getAnalysisOutputSettings().display===value)return;
      displays.set(kind,value);syncAnalysisOutput();deps.redrawAnalysis();
    });
    for(const field of [pair,metric])field.addEventListener('change',()=>{syncAnalysisOutput();deps.redrawAnalysis();});
    png.addEventListener('click',()=>saveAnalysis('png'));json.addEventListener('click',()=>saveAnalysis('json'));
    syncAnalysisOutput();
  }
  return {getAnalysisOutputSettings,syncAnalysisOutput,presentAnalysis,attachAnalysisOutputEvents,captureAnalysisOutputPreferences,applyAnalysisOutputPreferences};
}
