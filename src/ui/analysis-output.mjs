// Own analysis display/export controls, MIT. Modules are wired by application.
import {analysisJSON,tradeoffData,analysisMaximum,ANALYSIS_CHANNELS,SIGNAL_NAMES,spatialChannels} from '../core/analysis-output.mjs';
import {histogramView,histogramBinAt,histogramTick,histogramInterval,histogramSummary,groupHistogramDelta} from '../core/histogram-view.mjs';
import {profileBinAt} from '../core/line-profile.mjs';
import {analysisDelta,deltaAt,DELTA_TYPES} from '../core/analysis-delta.mjs';
import {errorBinInterval,errorHistogramSummary} from '../core/error-histogram.mjs';
const NAMES=['R','G','B','α','Y′','Cb','Cr'];
const graphName=(type,index)=>type==='signalHistogram'?SIGNAL_NAMES[index]:NAMES[index];
const fmt=n=>n===Infinity?'∞':n.toLocaleString('ru-RU',{maximumFractionDigits:3});
const deltaFmt=n=>(n>0?'+':'')+(n!==0&&Math.abs(n)<.001?n.toExponential(2):n.toLocaleString('ru-RU',{maximumSignificantDigits:3}));
export function createAnalysisOutput({app},deps){
  const get=id=>document.getElementById(id),pair=get('analysisPair'),metric=get('analysisMetric');
  const displayInputs=[['separate',get('analysisDisplaySeparate')],['overlay',get('analysisDisplayOverlay')],['delta',get('analysisDisplayDelta')]];
  // Each diagram keeps its own display choice; preferences persist this map.
  const displays=new Map([['histogram','overlay'],['signalHistogram','overlay'],['errorHistogram','overlay'],['profile','overlay'],['cieXy','overlay']]);
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
    return {display:kind==='tradeoff'?'metrics':['difference','errorProfile','ssim','deltaE'].includes(kind)?'separate':displays.get(kind)||'separate',pair:pair.value.split(',').map(Number),metric:metric.value};
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
    get('analysisDisplayField').hidden=['tradeoff','difference','errorProfile','ssim','deltaE'].includes(kind);
    get('analysisDisplayDeltaField').hidden=!DELTA_TYPES.includes(kind);
    for(const [value,input] of displayInputs){input.checked=settings.display===value;input.disabled=['tradeoff','difference','errorProfile','ssim','deltaE'].includes(kind)||(value==='delta'&&!DELTA_TYPES.includes(kind));}
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
    let available=items.some(i=>i.data),histView=null,histError='';
    if(['histogram','signalHistogram'].includes(snapshot.settings.type)&&available){
      // A hidden canvas reports zero width. Show a ready pair before sizing its bins.
      if(shared&&items.length===2&&items.every(i=>i.data))canvas.hidden=false;
      try {histView=histogramView(items,snapshot.settings.channel,Math.max(256,canvas.getBoundingClientRect().width-74),{allowUnknownColorSpace:true});}
      catch(error){histError=error.message;available=false;}
    }
    if(shared){
      canvas.hidden=true;canvas.getContext('2d').clearRect(0,0,canvas.width,canvas.height);canvas.removeAttribute('data-kind');canvas.removeAttribute('data-points');legend.replaceChildren();note.textContent='';
      if(['overlay','delta'].includes(snapshot.settings.display)){
        const delta=snapshot.settings.display==='delta';
        available=!histError&&items.length===2&&items.every(i=>i.data);
        if(available){canvas.hidden=false;
          if(delta){
            const original=deltaModel(items,snapshot.settings),model=groupHistogramDelta(original,Math.max(256,canvas.getBoundingClientRect().width-90)),span=document.createElement('span');
            render=()=>deps.renderAnalysisDelta(canvas,original,snapshot.settings);
            span.textContent=`Δ ${items[1].cell} − ${items[0].cell}`;span.title=`${items[1].label} минус ${items[0].label}`;legend.append(span);
            if(model.columns){
              for(const [text,color] of [['− уменьшение','var(--scope-first)'],['+ прибавление','var(--scope-second)']]){const marker=document.createElement('span');marker.textContent=text;marker.style.color=color;legend.append(marker);}
              const scale=document.createElement('span');scale.textContent=`Шкала ±${deltaFmt(model.maximum).replace(/^\+/,'')} п.п.`;legend.append(scale);
            }else for(const {index,values} of model.channels){
              const value=model.scale?values[histogramBinAt(model.scale,snapshot.settings.level)]:deltaAt(values,snapshot.settings.position/1000),marker=document.createElement('span');
              marker.textContent=`${graphName(snapshot.settings.type,index)} ${deltaFmt(value)} ${model.unit==='code-values'?'ур.':'п.п.'}`;legend.append(marker);
            }
            if(model.maximum===0&&!model.outside?.some(c=>c.below||c.above))note.textContent=model.scale?.grouped?'Группы графиков совпадают; внутри группы различия могут компенсироваться.':'Графики совпадают: разница равна нулю.';
            if(model.outside?.some(c=>c.below||c.above))note.textContent='За пределами диапазона: '+model.outside.map(c=>`${graphName(snapshot.settings.type,c.index)} ниже ${deltaFmt(c.below)}, выше ${deltaFmt(c.above)} п.п.`).join('; ')+'.';
            if(model.scale){get('analysisLevelValue').textContent=histogramTick(model.scale,snapshot.settings.level/255);if(model.scale.grouped||model.scale.normalized||model.scale.kind==='float')note.textContent+=(note.textContent?' ':'')+histogramInterval(model.scale,snapshot.settings.level)+(model.scale.grouped?`; ${model.bins} групп на графике.`:'.');}
          }else{
          render=()=>deps.renderAnalysisOverlay(canvas,items,snapshot.settings);
          const lines=['histogram','signalHistogram','errorHistogram','profile'].includes(snapshot.settings.type);
          if(snapshot.settings.type==='cieXy'&&items.some(item=>item.data.iccReference)){
            const sourceMarker=document.createElement('span');sourceMarker.textContent='● Исходник ICC';sourceMarker.style.color='#c475ff';legend.append(sourceMarker);
          }
          items.forEach((item,i)=>{const span=document.createElement('span'),s=snapshot.settings,d=item.data;
            let values='';
            if(['histogram','signalHistogram'].includes(s.type)){const viewed=histView.items[i].data,bin=histogramBinAt(histView.scale,s.level);values=ANALYSIS_CHANNELS[s.channel].map(c=>`${graphName(s.type,c)} ${fmt(viewed.channels[c][bin]/d.pixelCount*100)}%`).join(' · ');}
            if(s.type==='errorHistogram'){const index=s.errorChannel==='alpha'?1:0;values=`${fmt(d.channels[index][s.level]/d.pixelCount*100)}% · ${s.errorChannel==='alpha'?`MAE α ${fmt(d.metrics.maeAlpha)}%, RMSE α ${fmt(d.metrics.rmseAlpha)}%`:`MAE RGB ${fmt(d.metrics.maeRGB)}%, RMSE RGB ${fmt(d.metrics.rmseRGB)}%`}`;}
            if(s.type==='profile'){const bin=profileBinAt(d,s.position);values=ANALYSIS_CHANNELS[s.profileChannel].map(c=>`${NAMES[c]} ${fmt(d.channels[c].mean[bin])}${d.counts[bin]>1?` [${d.channels[c].min[bin]}–${d.channels[c].max[bin]}]`:''}`).join(' · ');}
            span.textContent=`${item.cell} ${lines?(i?'□ контур':'■ заливка'):'●'}${values?' · '+values:''}`;if(!lines)span.style.color=i?'var(--scope-second)':'var(--scope-first)';span.title=item.label;legend.append(span);
          });
          }
          if(histView&&snapshot.settings.display==='overlay'){
            get('analysisLevelValue').textContent=histogramTick(histView.scale,snapshot.settings.level/255);
            if(histView.scale.grouped||histView.scale.normalized||histView.scale.kind==='float')note.textContent=histogramInterval(histView.scale,snapshot.settings.level)+`; ${histView.scale.bins} групп, доли суммируются.`;
            if(items.some(i=>i.data.underflow?.some(n=>n)||i.data.overflow?.some(n=>n)))note.textContent+=' '+items.map(i=>`${i.cell}: ${histogramSummary(i.data,snapshot.settings.channel)}`).join(' ');
          }
          if(snapshot.settings.type==='errorHistogram'){get('analysisLevelValue').textContent=snapshot.settings.level===0?'0%':`${fmt(snapshot.settings.level/255*100)}%`;note.textContent=errorBinInterval(snapshot.settings.level)+'; группа 0 — только точное совпадение.';}
          if(snapshot.settings.type==='cieXy')note.textContent=items.map(item=>{
            const data=item.data,reference=data.iccReference;
            return `${item.cell}: ${data.exact?'все пиксели':'выборка '+fmt(data.sampleCount)+' из '+fmt(data.pixelCount)}, чёрных ${fmt(data.blackCount)}${data.colorAssumption==='srgb-assumed'?'; sRGB предположен':''}${reference?`; исходник ICC вне sRGB ${fmt(reference.outOfSrgbPercent)}% (${fmt(reference.outOfSrgbCount)} из ${fmt(reference.sampleCount)}), область ${reference.bounds.x}, ${reference.bounds.y}: ${reference.bounds.width}×${reference.bounds.height} px`:''}`;
          }).join('. ')+'. Белый треугольник — sRGB, фиолетовый — первичные цвета ICC, точка — D65.';
          const descriptions=items.map(i=>`${i.label}: ${i.data.width}×${i.data.height}, область ${i.data.bounds.x}, ${i.data.bounds.y}: ${i.data.bounds.width}×${i.data.bounds.height}${i.data.sampleCount?`, ${i.data.sampleCount} отсчётов`:''}${spatialChannels(snapshot.settings.type).length?`; ${i.data.bitDepth||8} бит/канал, ${i.data.levelBins||256} интервалов уровней`:''}${histView?'. '+histogramSummary(i.data,snapshot.settings.channel):''}${snapshot.settings.type==='errorHistogram'?`. ${errorHistogramSummary(i.data)}; ${i.data.bitDepth.source}/${i.data.bitDepth.result} бит/канал${i.data.colorComparison==='unknown-code-values'?'; цветовая метка неизвестна, сравниваются кодовые значения':''}`:''}`);
          if(spatialChannels(snapshot.settings.type).length)note.textContent+=(note.textContent?' ':'')+'Общая нормированная шкала 256 интервалов; точные счётчики ячеек доступны в JSON.';
          get('analysisDetails').textContent=descriptions.join('\n');
          const sizes=new Set(items.map(i=>`${i.data.width}×${i.data.height}`));get('analysisStatus').textContent=sizes.size>1?(snapshot.settings.scope==='viewport'?'Размеры различаются; анализируется видимая часть каждой ячейки без выравнивания содержимого.':'Размеры различаются; используются одинаковые относительные область и линия без выравнивания содержимого.'):'';
          canvas.setAttribute('aria-label',`${delta?`Разница: ячейка ${items[1].cell} минус ${items[0].cell}`:`Наложение ячеек ${items.map(i=>i.cell).join(' и ')}`}. ${snapshot.method} ${descriptions.join('. ')}. ${[...legend.children].map(s=>s.textContent).join('; ')}. ${note.textContent}`);
        }else {lastDelta=null;note.textContent=histError||items.filter(i=>!i.data).map(i=>`${i.cell}: ${i.message||'Расчёт…'}`).join(' ')||'Для сравнения нужны две готовые ячейки.';get('analysisStatus').textContent='';}
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
    let selected=chosen(snapshot);const shared=snapshot.settings.display!=='separate';
    const variantTitles={histogram:'Гистограмма · RGB',signalHistogram:'Гистограмма · Y′CbCr',waveform:'Waveform · Y′',rgbWaveform:'Waveform · RGB вместе',ycbcrWaveform:'Waveform · Y′CbCr вместе',parade:'Parade · RGB',ycbcrParade:'Parade · Y′CbCr'};
    const title=`Анализ · ${variantTitles[snapshot.settings.type]||get('analysisType').selectedOptions[0].textContent}`;
    const header=wrap(ctx,`${snapshot.source.name} · ${snapshot.source.width}×${snapshot.source.height} · ${snapshot.createdAt}`,1152);
    const s=snapshot.settings,b=s.region,line=s.line;
    const reportView=['histogram','signalHistogram'].includes(s.type)?histogramView(selected,s.channel,shared?1152-74:566-72,{allowUnknownColorSpace:true}):null;
    const reportDelta=reportView&&s.display==='delta'?groupHistogramDelta(snapshot.delta||deltaModel(selected,s),1152-90):null;
    if(reportView&&!shared)selected=reportView.items;
    const parameterText=s.type==='tradeoff'?`Метрика: ${get('analysisMetric').selectedOptions[0].textContent}; весь кадр.`:
      `${s.display==='delta'?`Разница ячеек ${s.pair[1]} − ${s.pair[0]}`:s.display==='overlay'?`Наложение ячеек ${s.pair.join(' + ')}`:'Ячейки рядом'}; подложка: ${s.matte==='white'?'белая':'чёрная'}; область: ${s.scope==='viewport'?'видимая часть каждой ячейки':b?`${b.x0/10}%, ${b.y0/10}%, ${(b.x1-b.x0)/10}% × ${(b.y1-b.y0)/10}%`:'весь кадр'}`+
      (s.channel?`; каналы: ${s.channel}, ${reportView?histogramInterval(reportDelta?.scale||reportView.scale,s.level):`уровень ${s.level}`}`:'')+(s.type==='cieXy'?`; цвета: ${s.cieView==='icc'?'показанные SDR + исходник ICC':'показанные SDR'}`:'')+(s.type==='errorHistogram'?`; ошибка: ${s.errorChannel}, ${errorBinInterval(s.level)}`:'')+(line?`; ${s.type==='errorProfile'?'ошибка: '+s.errorChannel:'каналы: '+s.profileChannel}, позиция ${s.position/10}%; A (${line.x0/10}%, ${line.y0/10}%) → B (${line.x1/10}%, ${line.y1/10}%)`:'')+(s.gain?`; канал: ${s.differenceChannel}, усиление ×${s.gain}`:'');
    const viewportText=s.scope==='viewport'?'; '+s.viewports.filter(v=>selected.some(i=>i.cell===v.cell)).map(v=>v.region?`${v.cell}: X ${v.region.x}, Y ${v.region.y}, ${v.region.width}×${v.region.height} px`:`${v.cell}: нет видимых пикселей`).join('; '):'';
    const settings=wrap(ctx,parameterText+viewportText,1152);
    const method=wrap(ctx,snapshot.method,1152);
    const charts=shared?[{available:selected.some(i=>i.data),title:[...legend.children].map(s=>s.textContent).join(' · '),details:selected.map(i=>`${i.label}${i.data?` · ${i.data.width}×${i.data.height}`:''}${i.message?': '+i.message:''}`).join('; ')+(note.textContent?'. '+note.textContent:'')}]:selected.map(item=>({item,available:Boolean(item.data),title:item.label,details:item.message||document.querySelectorAll('.analysis-card canvas')[item.cell-1].getAttribute('aria-label')}));
    if(reportView){
      const scale=reportDelta?.scale||reportView.scale,groupNote=scale.grouped?` Показано ${scale.bins} групп; соседние доли суммируются.`:'';
      const describe=item=>{const d=item.data,b=d.bounds;return `${item.label}: ${d.width}×${d.height}, ${fmt(d.pixelCount)} пикселей${b?`, область ${b.x}, ${b.y}: ${b.width}×${b.height}`:''}. ${histogramSummary(d,s.channel)}`;};
      const values=item=>ANALYSIS_CHANNELS[s.channel].map(c=>`${graphName(s.type,c)} ${fmt(item.data.channels[c][histogramBinAt(scale,s.level)]/item.data.pixelCount*100)}%`).join(' · ');
      if(shared){
        charts[0].title=s.display==='delta'?`Δ ${s.pair[1]} − ${s.pair[0]}`:selected.map((item,i)=>`${item.cell} ${i?'□ контур':'■ заливка'}`).join(' · ');
        charts[0].details=selected.map(describe).join(' ')+groupNote;
        if(reportDelta)charts[0].details+=' '+reportDelta.channels.map(c=>`${graphName(s.type,c.index)} ${deltaFmt(c.values[histogramBinAt(scale,s.level)])} п.п.`).join(' · ');
        else charts[0].details+=' '+reportView.items.map(item=>`${item.cell}: ${values(item)}`).join('; ');
        if(reportDelta?.outside.some(c=>c.below||c.above))charts[0].details+=' Разница вне диапазона: '+reportDelta.outside.map(c=>`${graphName(s.type,c.index)} ниже ${deltaFmt(c.below)}, выше ${deltaFmt(c.above)} п.п.`).join('; ')+'.';
      }else for(const chart of charts)if(chart.item.data){const d=chart.item.data;chart.details=describe(chart.item)+groupNote+' '+values(chart.item)+(d.means?' Средние: '+ANALYSIS_CHANNELS[s.channel].map(c=>`${graphName(s.type,c)} ${fmt(d.means[c])}`).join(' · ')+'.':'');}
    }
    if(s.type==='errorHistogram'){
       const describe=item=>{const d=item.data,b=d.bounds,index=s.errorChannel==='alpha'?1:0;return `${item.label}: ${d.width}×${d.height}, область ${b.x}, ${b.y}: ${b.width}×${b.height}; ${d.bitDepth.source}/${d.bitDepth.result} бит/канал; ошибка ${errorBinInterval(s.level)}: ${fmt(d.channels[index][s.level]/d.pixelCount*100)}% пикселей. ${errorHistogramSummary(d)}.${d.colorComparison==='unknown-code-values'?' Цветовое пространство неизвестно: сравниваются кодовые значения.':''}`;};
       if(shared){charts[0].title=selected.map((item,i)=>`${item.cell} ${i?'□ контур':'■ заливка'}`).join(' · ');charts[0].details=selected.map(describe).join(' ');}
       else for(const chart of charts)if(chart.item.data)chart.details=describe(chart.item);
    }
    if(s.type==='cieXy'){
      const describe=item=>{const d=item.data,r=d.iccReference;return `${item.label}: показанные SDR ${d.sampleCount} из ${d.pixelCount} пикселей; область ${d.bounds.x}, ${d.bounds.y}: ${d.bounds.width}×${d.bounds.height} px${r?`; исходник ICC до ограничения sRGB: вне sRGB ${fmt(r.outOfSrgbPercent)}% (${r.outOfSrgbCount} из ${r.sampleCount}), область ${r.bounds.x}, ${r.bounds.y}: ${r.bounds.width}×${r.bounds.height} px`:''}.`;};
      if(shared)charts[0].details=selected.filter(item=>item.data).map(describe).join(' ');
      else for(const chart of charts)if(chart.item.data)chart.details=describe(chart.item);
    }
    const columns=shared?1:2,chartWidth=(1152-(columns-1)*20)/columns,rows=[];
    const outputSize={width:chartWidth,height:280},maximum=shared?null:analysisMaximum(s.type,selected,['errorHistogram','errorProfile'].includes(s.type)?s.errorChannel:s.channel);
    for(let i=0;i<charts.length;i+=columns){const row=charts.slice(i,i+columns).map(c=>({...c,head:wrap(ctx,c.title,chartWidth),tail:wrap(ctx,c.details||'',chartWidth)}));rows.push({items:row,height:Math.max(...row.map(c=>c.head.length*22+300+c.tail.length*22+20))});}
    output.height=100+(header.length+settings.length+method.length)*22+rows.reduce((s,r)=>s+r.height,0);
    ctx=output.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,output.width,output.height);ctx.fillStyle='#17212b';ctx.textBaseline='top';ctx.font='bold 24px "Segoe UI",sans-serif';ctx.fillText(title,24,22);ctx.font='16px "Segoe UI",sans-serif';
    let y=60;for(const line of [...header,...settings]){ctx.fillText(line,24,y);y+=22;}y+=12;
    for(const row of rows){row.items.forEach((c,i)=>{const x=24+i*(chartWidth+20);let cy=y;for(const line of c.head){ctx.fillText(line,x,cy);cy+=22;}
      if(c.available){
        const chart=document.createElement('canvas');
        if(!shared)deps.renderAnalysisChart(chart,c.item,s,maximum,outputSize);
        else if(s.display==='delta')deps.renderAnalysisDelta(chart,snapshot.delta||deltaModel(selected,s),s,outputSize);
        else if(s.display==='overlay')deps.renderAnalysisOverlay(chart,selected,s,outputSize);
        else deps.renderAnalysisTradeoff(chart,tradeoffData(selected,s.metric,snapshot.source),outputSize);
        ctx.drawImage(chart,x,cy);
      }
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
