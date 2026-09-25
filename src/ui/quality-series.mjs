import { DEFAULT_VARIANTS, FORMAT_DEFS } from '../core/config.mjs';
import { SERIES_QUALITIES, runSeriesProbes, seriesBudgetBytes, summarizeQualitySeries } from '../core/quality-series.mjs';

const SVG_NS='http://www.w3.org/2000/svg';
const get=id=>document.getElementById(id);
const psnrText=value=>value===Infinity?'∞':Number.isFinite(value)?value.toFixed(2):'—';
const pointColor=(format,formats)=>format===formats[0]?'var(--scope-first)':'var(--scope-second)';

export function createQualitySeries({app},deps){
  let active=null;

  function svgElement(tag,attributes={},label=''){
    const element=document.createElementNS(SVG_NS,tag);
    for(const [key,value] of Object.entries(attributes))element.setAttribute(key,String(value));
    if(label)element.textContent=label;
    return element;
  }

  function drawChart(run,summary,budgetBytes){
    const chart=get('qualitySeriesChart'),points=run.points.filter(p=>p.status==='ready'&&Number.isFinite(p.bytes));
    chart.replaceChildren();chart.toggleAttribute('hidden',!points.length);
    if(!points.length)return;
    const left=58,right=24,top=30,bottom=42,width=700-left-right,height=280-top-bottom;
    const maxBytes=Math.max(...points.map(p=>p.bytes))*1.1;
    const finite=points.filter(p=>Number.isFinite(p.psnrRGB)).map(p=>p.psnrRGB);
    const maxPSNR=Math.max(1,...finite)*1.1;
    const px=value=>left+value/maxBytes*width;
    const py=value=>top+height-(value===Infinity?maxPSNR:value)/maxPSNR*height;
    chart.append(svgElement('line',{x1:left,y1:top,x2:left,y2:top+height,stroke:'var(--line)'}));
    chart.append(svgElement('line',{x1:left,y1:top+height,x2:left+width,y2:top+height,stroke:'var(--line)'}));
    for(const fraction of [0,0.5,1]){
      const x=left+width*fraction,y=top+height-height*fraction;
      chart.append(svgElement('text',{x,y:top+height+19,fill:'var(--muted)','font-size':12,'text-anchor':'middle'},`${(maxBytes*fraction/1000).toFixed(1)} КБ`));
      chart.append(svgElement('text',{x:left-7,y:y+4,fill:'var(--muted)','font-size':12,'text-anchor':'end'},`${(maxPSNR*fraction).toFixed(0)}`));
    }
    chart.append(svgElement('text',{x:left,y:16,fill:'var(--muted)','font-size':12},'PSNR RGB · dB'));
    if(budgetBytes&&budgetBytes<=maxBytes){
      const x=px(budgetBytes);
      chart.append(svgElement('line',{x1:x,y1:top,x2:x,y2:top+height,stroke:'var(--muted)','stroke-dasharray':'5 4'}));
      chart.append(svgElement('text',{x:Math.min(x+5,left+width-70),y:top+14,fill:'var(--muted)','font-size':11},'Бюджет'));
    }
    for(const format of run.formats){
      const ordered=points.filter(p=>p.format===format).sort((a,b)=>a.quality-b.quality);
      if(ordered.length>1)chart.append(svgElement('polyline',{points:ordered.map(p=>`${px(p.bytes)},${py(p.psnrRGB)}`).join(' '),fill:'none',stroke:pointColor(format,run.formats),'stroke-width':1.6,opacity:0.6}));
      for(const point of ordered){
        const best=summary?.best?.id===point.id,frontier=summary?.frontier.has(point.id);
        const marker=svgElement('circle',{cx:px(point.bytes),cy:py(point.psnrRGB),r:best?7:5.5,fill:frontier?pointColor(format,run.formats):'var(--panel)',stroke:pointColor(format,run.formats),'stroke-width':best?3:2});
        marker.append(svgElement('title',{},`${FORMAT_DEFS[format].label}, качество ${point.quality}: ${(point.bytes/1000).toFixed(1)} КБ, PSNR ${psnrText(point.psnrRGB)} dB${best?', лучший под бюджет':''}${frontier?', недоминируемая точка':''}`));
        chart.append(marker);
      }
    }
    const names=run.formats.map(format=>FORMAT_DEFS[format].label).join(' и ');
    chart.setAttribute('aria-label',`Размер файла по горизонтали, PSNR RGB по вертикали. Серия ${names}. ${points.length} готовых точек. Сплошные точки не уступают другим одновременно по размеру и PSNR.`);
  }

  function render(){
    const run=active,start=get('qualitySeriesStart'),cancel=get('qualitySeriesCancel');
    start.disabled=Boolean(run?.running);cancel.hidden=!run?.running;cancel.disabled=Boolean(run?.cancelRequested);
    const table=get('qualitySeriesTable'),rows=get('qualitySeriesRows'),status=get('qualitySeriesStatus'),description=get('qualitySeriesSummary');
    if(!run){status.textContent='Откройте исходное изображение и запустите серию.';description.textContent='';rows.replaceChildren();table.hidden=true;get('qualitySeriesChart').setAttribute('hidden','');return;}
    status.textContent=run.running?(run.cancelRequested?'Останавливаю после текущей пробы…':`Обработано ${run.points.length}/10${run.current?` · ${run.current}`:''}`):
      run.stopReason||`Серия завершена: ${run.points.filter(p=>p.status==='ready').length} из 10 проб.`;
    let budgetBytes=null,summary=null;
    try{budgetBytes=seriesBudgetBytes(get('qualitySeriesBudget').value);summary=summarizeQualitySeries(run.points,budgetBytes);}
    catch(error){description.textContent=error.message;}
    if(summary){
      const best=summary.best;
      description.textContent=`Исходник: ${run.sourceName}, ${run.width}×${run.height}. ${run.running?'Промежуточный результат. ':''}`+
        (best?`Лучший измеренный результат в ${Math.round(budgetBytes/1000)} КБ: ${FORMAT_DEFS[best.format].label}, качество ${best.quality}, ${(best.bytes/1000).toFixed(1)} КБ, PSNR ${psnrText(best.psnrRGB)} dB.`:`Ни одна готовая точка не укладывается в ${Math.round(budgetBytes/1000)} КБ.`)+
        ` Недоминируемых точек: ${summary.frontier.size}.`;
    }
    const fragment=document.createDocumentFragment();
    for(const point of run.points){
      const row=document.createElement('tr');
      const best=summary?.best?.id===point.id,frontier=summary?.frontier.has(point.id);
      row.dataset.best=String(Boolean(best));row.dataset.frontier=String(Boolean(frontier));
      const values=[FORMAT_DEFS[point.format].label,String(point.quality),point.status==='ready'?`${(point.bytes/1000).toFixed(1)} КБ`:'—',
        point.status==='ready'?point.bpp.toFixed(3):'—',point.status==='ready'?`${psnrText(point.psnrRGB)} dB`:'—',
        point.status==='error'?point.error:best?'Лучший в бюджете':frontier?'Недоминируемая':'—'];
      for(const value of values){const cell=document.createElement('td');cell.textContent=value;row.append(cell);}
      fragment.append(row);
    }
    rows.replaceChildren(fragment);table.hidden=!run.points.length;
    drawChart(run,summary,budgetBytes);
  }

  function cancelQualitySeries(reason='Остановлено пользователем; готовые точки сохранены.'){
    if(!active?.running)return;
    active.cancelRequested=true;active.stopReason=reason;render();
  }

  async function startQualitySeries(){
    if(active?.running)return;
    const source=app.source;
    if(!source||app.sourceLoading){get('qualitySeriesStatus').textContent='Сначала откройте исходное изображение.';return;}
    if(app.batchRun?.running){get('qualitySeriesStatus').textContent='Дождитесь завершения пакетной обработки.';return;}
    if(source.width*source.height>8000000){get('qualitySeriesStatus').textContent='Для серии нужен исходник не больше 8 Мп.';return;}
    const formats=[get('qualitySeriesFirst').value,get('qualitySeriesSecond').value];
    try{
      if(formats[0]===formats[1])throw new Error('Выберите два разных формата серии.');
      seriesBudgetBytes(get('qualitySeriesBudget').value);
      for(const format of formats){const reason=deps.formatUnavailableReason(format);if(reason)throw new Error(reason);}
    }catch(error){get('qualitySeriesStatus').textContent=error.message;return;}
    const generation=app.sourceGeneration;
    const run={sourceName:source.name,width:source.width,height:source.height,formats,points:[],running:true,cancelRequested:false,stopReason:'',current:''};
    active=run;render();
    const current=()=>active===run&&!run.cancelRequested&&app.source===source&&app.sourceGeneration===generation&&!app.batchRun?.running&&
      get('qualitySeriesFirst').value===formats[0]&&get('qualitySeriesSecond').value===formats[1];
    const probe=async(format,quality)=>{
      run.current=`${FORMAT_DEFS[format].label} · ${quality}`;render();
      await new Promise(resolve=>setTimeout(resolve,0));
      if(!current())throw new Error('Серия остановлена.');
      const config={...DEFAULT_VARIANTS[1],format,quality,matte:'white',metadataPolicy:'none',resizeWidth:'',resizeHeight:'',targetKB:''};
      const encoded=await deps.encodeFromSource(config,source,current);
      if(!current())throw new Error('Серия остановлена.');
      const decoded=await deps.decodeVariantForPreview(encoded.blob,encoded.exactPng);
      try{
        if(decoded.imageData.width!==source.width||decoded.imageData.height!==source.height)throw new Error('Размер результата отличается от исходника.');
        const measurement=await deps.measurePixels(encoded.sourcePixelBuffer,decoded.pixelBuffer,{allowUnknownColorSpace:true});
        if(!current())throw new Error('Серия остановлена.');
        return {bytes:encoded.blob.size,bpp:encoded.blob.size*8/(source.width*source.height),psnrRGB:measurement.psnr,alphaErrorPercent:measurement.alpha};
      }finally{decoded.bitmap?.close?.();}
    };
    try{
      const result=await runSeriesProbes(formats,probe,current,(_,points)=>{run.points=points;run.current='';render();});
      if(result.cancelled&&!run.stopReason)run.stopReason=app.source!==source?'Исходник изменился; серия остановлена.':
        app.batchRun?.running?'Начата пакетная обработка; серия остановлена.':'Параметры серии изменились; готовые точки сохранены.';
    }catch(error){run.stopReason=error.message||String(error);}
    finally{run.running=false;run.current='';render();}
  }

  function attachQualitySeriesEvents(){
    get('qualitySeriesStart').addEventListener('click',startQualitySeries);
    get('qualitySeriesCancel').addEventListener('click',()=>cancelQualitySeries());
    for(const id of ['qualitySeriesFirst','qualitySeriesSecond'])get(id).addEventListener('change',()=>cancelQualitySeries('Форматы изменились; готовые точки сохранены.'));
    get('qualitySeriesBudget').addEventListener('input',render);
    get('studyDialog').addEventListener('close',()=>cancelQualitySeries('Окно закрыто; готовые точки сохранены.'));
    render();
  }

  return {attachQualitySeriesEvents,cancelQualitySeries,startQualitySeries};
}
