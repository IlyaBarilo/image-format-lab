// Own region/line editor, MIT. Application wires this module to the analysis panel.
import { analysisBounds, analysisRegionBounds } from '../core/analysis-region.mjs';
import { DEFAULT_ANALYSIS_LINE, profileEndpoints } from '../core/line-profile.mjs';
import { cropSourcePixels, croppedSourceName } from '../core/crop-source.mjs';
const FULL = { x0: 0, y0: 0, x1: 1000, y1: 1000 };
export function createAnalysisRegion({ app }, deps) {
  const get = id => document.getElementById(id);
  const editor = get('analysisRegionEditor'), canvas = get('analysisRegionCanvas');
  const lineButton = get('analysisLineOpen');
  const cropButton = get('analysisCropSource');
  const scope = get('analysisScope');
  const unit = get('analysisRegionUnit'), unitField=get('analysisRegionUnitField');
  const fields = ['X','Y','Width','Height'].map(name=>get('analysisRegion'+name));
  const error = get('analysisRegionError');
  let region = null, draft = { ...FULL }, source = null, box = null, drag = null;
  let mode = 'region', line = { ...DEFAULT_ANALYSIS_LINE };
  let cropBusy = false;
  let restoreFirstSource = false;
  function getAnalysisScope() { return scope.value; }
  function getAnalysisRegion() { return scope.value === 'region' && region ? { ...region } : null; }
  function lineRegion() { return scope.value === 'viewport' ? deps.getAnalysisViewport(0, source?.imageData).region : getAnalysisRegion(); }
  function getAnalysisLine() { return { ...line }; }
  function captureAnalysisRegionPreferences(){return {scope:scope.value,region:region?{...region}:null,line:{...line}};}
  function applyAnalysisRegionPreferences(value){
    source=app.source;restoreFirstSource=!source;region=value.region?{...value.region}:null;line={...value.line};scope.value=value.scope;
    closeAnalysisRegion();syncAnalysisRegion();
  }
  function syncCropButton(){
    cropButton.hidden = !editor.hidden || !source || app.sourceLoading || scope.value !== 'region' || !region;
    cropButton.disabled = cropBusy || Boolean(app.batchRun?.running);
  }
  function closeAnalysisRegion(focus = false) {
    editor.hidden = true; lineButton.setAttribute('aria-expanded','false'); drag = null;
    // Keep the current label in a hidden option so choosing the visible item
    // again changes the selection and reopens the editor with native controls.
    get('analysisRegionCurrent').selected = scope.value === 'region';
    canvas.width = canvas.height = 1; box = null;
    syncCropButton();
    if(focus)(mode==='line'?lineButton:scope).focus();
  }
  function syncAnalysisRegion() {
    if(source !== app.source) {
      source = app.source;
      if(restoreFirstSource&&source){
        restoreFirstSource=false;
        if(region?.unit==='pixels'&&(region.referenceWidth!==source.width||region.referenceHeight!==source.height)){
          region=null;if(scope.value==='region')scope.value='full';
        }
      }
      else {region=null;if(scope.value==='region')scope.value='full';line={...DEFAULT_ANALYSIS_LINE};}
      closeAnalysisRegion();
    }
    lineButton.disabled = !source || app.sourceLoading;
    syncCropButton();
    if (scope.value === 'viewport' && source) lineButton.disabled ||= !lineRegion();
    lineButton.textContent = Object.keys(line).every(key=>line[key]===DEFAULT_ANALYSIS_LINE[key])?'Линия…':'Линия ✓';
    lineButton.title=`A (${line.x0/10}%, ${line.y0/10}%) → B (${line.x1/10}%, ${line.y1/10}%) внутри выбранной области`;
  }
  function fillFields() {
    const pixels=mode==='region'&&unit.value==='pixels';
    const labels=mode==='line'?['A · X, %','A · Y, %','B · X, %','B · Y, %']
      :pixels?['Слева, px','Сверху, px','Ширина, px','Высота, px']
        :['Слева, %','Сверху, %','Ширина, %','Высота, %'];
    const values=pixels?[draft.x,draft.y,draft.width,draft.height]
      :mode==='line'?[draft.x0,draft.y0,draft.x1,draft.y1]
        :[draft.x0,draft.y0,draft.x1-draft.x0,draft.y1-draft.y0];
    values.forEach((value,i)=>{
      fields[i].parentElement.firstChild.textContent=labels[i]+' ';
      fields[i].step=pixels?'1':'0.1';
      fields[i].min=pixels?(i<2?'0':'1'):mode==='line'||i<2?'0':'0.1';
      fields[i].max=pixels?String(i%2===0?source.width:source.height):mode==='line'||i>=2?'100':'99.9';
      fields[i].value=String(pixels?value:value/10);
    });
  }
  function readFields() {
    if(mode==='region'&&unit.value==='pixels'){
      const values=fields.map(input=>input.value.trim()===''?NaN:Number(input.value));
      if(!values.every(Number.isInteger))throw new Error('Введите целые пиксельные координаты.');
      const [x,y,width,height]=values;
      const value={unit:'pixels',x,y,width,height,referenceWidth:source.width,referenceHeight:source.height};
      try{analysisRegionBounds(source.width,source.height,value);}
      catch{throw new Error('Область должна быть внутри исходного кадра и иметь ненулевой размер.');}
      return value;
    }
    const values = fields.map(input=>input.value.trim()===''?NaN:Number(input.value)*10);
    if(!values.every(v=>Number.isFinite(v)&&Math.abs(v-Math.round(v))<1e-7)) throw new Error('Введите проценты с шагом 0,1.');
    const [x,y,w,h] = values.map(Math.round), value = {x0:x,y0:y,x1:mode==='line'?w:x+w,y1:mode==='line'?h:y+h};
    if(mode==='line'){
      try{profileEndpoints(source?.imageData,lineRegion(),value);}catch{throw new Error('Координаты A и B должны быть от 0 до 100%.');}
      return value;
    }
    try { analysisBounds(source?.imageData,value); } catch {throw new Error('Область должна быть внутри кадра, с шириной и высотой больше нуля.');}
    return value;
  }
  function drawAnalysisRegion() {
    if(editor.hidden || !source || deps.isAnalysisResizing()) return;
    const selectedRegion = mode==='line'?lineRegion():null;
    if (mode==='line' && scope.value==='viewport' && !selectedRegion) { closeAnalysisRegion(); return; }
    const rect=canvas.getBoundingClientRect(), w=rect.width, h=rect.height;
    const dpr=Math.max(1,Math.min(2.5,devicePixelRatio||1));
    canvas.width=Math.max(1,Math.round(w*dpr));canvas.height=Math.max(1,Math.round(h*dpr));
    const ctx=canvas.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);
    ctx.fillStyle='#18212b';ctx.fillRect(0,0,w,h);
    const bounds=analysisBounds(source.imageData,selectedRegion), scale=Math.min(w/bounds.width,h/bounds.height);
    box={x:(w-bounds.width*scale)/2,y:(h-bounds.height*scale)/2,width:bounds.width*scale,height:bounds.height*scale};
    ctx.fillStyle='#fff';ctx.fillRect(box.x,box.y,box.width,box.height);
    ctx.drawImage(source.canvas,bounds.x,bounds.y,bounds.width,bounds.height,box.x,box.y,box.width,box.height);
    if(mode==='line'){
      const a={x:box.x+draft.x0/1000*box.width,y:box.y+draft.y0/1000*box.height},b={x:box.x+draft.x1/1000*box.width,y:box.y+draft.y1/1000*box.height};
      ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.strokeStyle='#111';ctx.lineWidth=4;ctx.stroke();ctx.strokeStyle='#fff';ctx.lineWidth=2;ctx.stroke();
      ctx.font='bold 12px "Segoe UI",sans-serif';
      for(const [p,name] of [[a,'A'],[b,'B']]){ctx.beginPath();ctx.arc(p.x,p.y,4,0,Math.PI*2);ctx.fillStyle='#0f766e';ctx.fill();ctx.strokeStyle='#fff';ctx.lineWidth=1;ctx.stroke();ctx.fillStyle='#111';ctx.fillText(name,Math.min(w-12,Math.max(4,p.x+6)),Math.max(12,p.y-6));}
      canvas.setAttribute('aria-label',`Линия A (${draft.x0/10}%, ${draft.y0/10}%) → B (${draft.x1/10}%, ${draft.y1/10}%) внутри области. Координаты можно изменить в полях.`);
      return;
    }
    const area=analysisRegionBounds(source.width,source.height,draft);
    const x=box.x+area.x/source.width*box.width,y=box.y+area.y/source.height*box.height;
    const rw=area.width/source.width*box.width,rh=area.height/source.height*box.height;
    ctx.fillStyle='#0008';ctx.beginPath();ctx.rect(box.x,box.y,box.width,box.height);ctx.rect(x,y,rw,rh);ctx.fill('evenodd');
    ctx.strokeStyle='#fff';ctx.lineWidth=2;ctx.strokeRect(x,y,rw,rh);
    ctx.strokeStyle='#0f766e';ctx.lineWidth=1;ctx.setLineDash([4,3]);ctx.strokeRect(x,y,rw,rh);
    canvas.setAttribute('aria-label',`Область: X ${area.x}, Y ${area.y}, ширина ${area.width}, высота ${area.height} пикселей исходника. Координаты можно изменить в полях.`);
  }
  function toggleAnalysisLine() { openEditor('line'); }
  function openEditor(nextMode) {
    if(!editor.hidden&&mode===nextMode){closeAnalysisRegion(true);return;}
    if(!source || app.sourceLoading)return;
    if(nextMode === 'line' && scope.value === 'viewport' && !lineRegion()) return;
    closeAnalysisRegion();mode=nextMode;
    const isLine=mode==='line';draft={...(isLine?line:region||FULL)};
    unitField.hidden=isLine;
    if(!isLine)unit.value=draft.unit==='pixels'?'pixels':'percent';
    editor.setAttribute('aria-label',isLine?'Общая линия профиля':'Общая область анализа');
    get('analysisRegionApply').textContent=isLine?'Применить линию':'Применить область';
    get('analysisRegionReset').textContent=isLine?'По центру':'Весь кадр';
    get('analysisLinePresets').hidden=!isLine;
    get('analysisGeometryHint').textContent=isLine?'Проведите линию A→B внутри выбранной области или задайте её концы в процентах. Она общая для всех профилей; экспорт не меняется.':'Выделите область или задайте её координаты. Графики используют область без кадрирования файла; отдельный исходник создаётся после применения. Пиксели относятся к исходнику, а в результатах другого размера область масштабируется.';
    fillFields();error.textContent='';
    editor.hidden=false;syncCropButton();if(isLine)lineButton.setAttribute('aria-expanded','true');drawAnalysisRegion();fields[0].focus();
  }
  function apply(value) {
    if(mode==='line')line={...value};
    else {
      const bounds=analysisRegionBounds(source.width,source.height,value);
      region=bounds.x===0&&bounds.y===0&&bounds.width===source.width&&bounds.height===source.height?null:{...value};
      scope.value=region?'region':'full';
    }
    closeAnalysisRegion(true);syncAnalysisRegion();deps.updateAnalysis();
  }
  function submit() {
    try {apply(readFields());} catch(e){error.textContent=e.message;}
  }
  async function createSourceFromRegion(){
    if(app.batchRun?.running){deps.showStatus('Дождитесь завершения пакета или отмените обработку.');return;}
    if(cropBusy || !app.source || app.sourceLoading)return;
    const selectedRegion=getAnalysisRegion();
    if(!selectedRegion)return;
    const currentSource=app.source,sourceGeneration=app.sourceGeneration;
    const selectedFileId=app.selectedFileId,listGeneration=app.listGeneration;
    cropBusy=true;syncAnalysisRegion();
    try{
      const withIcc=Boolean(currentSource.iccProfile);
      const cropInput=withIcc?currentSource.nativePixelBuffer:currentSource.pixelBuffer;
      if(withIcc&&(!cropInput||cropInput.colorSpace!=='unknown'))
        throw new Error('Исходные отсчёты ICC недоступны; создание области без профиля запрещено.');
      const {bounds,pixels}=cropSourcePixels(cropInput,selectedRegion);
      const blob=await deps.encodeExactPng(pixels,pixels.bitDepth>8?16:8,
        withIcc?{iccProfile:currentSource.iccProfile}:undefined);
      if(currentSource!==app.source || sourceGeneration!==app.sourceGeneration ||
          selectedFileId!==app.selectedFileId || listGeneration!==app.listGeneration ||
          app.batchRun?.running || JSON.stringify(selectedRegion)!==JSON.stringify(getAnalysisRegion()))return;
      const file=new File([blob],croppedSourceName(currentSource.name,bounds),{type:'image/png'});
      deps.registerExactPngFile(file);
      const newId=String(app.nextFileId);
      deps.addFiles([file],{openFirst:true});
      app.fileRows.get(newId)?.querySelector('.file-select')?.focus();
      deps.showStatus(`Создан отдельный исходник ${bounds.width}×${bounds.height} из выбранной области. ${withIcc?'ICC сохранён; прочие метаданные не перенесены.':'Метаданные не перенесены.'}`);
    }catch(error){deps.showStatus(`Не удалось создать исходник из области: ${error.message||error}`,true);}
    finally{cropBusy=false;syncAnalysisRegion();}
  }
  function point(event) {
    if(!box)return null;
    const rect=canvas.getBoundingClientRect(), x=event.clientX-rect.left, y=event.clientY-rect.top;
    return {x:Math.round(Math.max(0,Math.min(1,(x-box.x)/box.width))*1000),
      y:Math.round(Math.max(0,Math.min(1,(y-box.y)/box.height))*1000),
      inside:x>=box.x&&x<=box.x+box.width&&y>=box.y&&y<=box.y+box.height};
  }
  function move(event) {
    if(!drag || event.pointerId!==drag.id)return;
    const p=point(event);if(!p)return;
    if(mode==='line')draft={x0:drag.x,y0:drag.y,x1:p.x,y1:p.y};
    else if(unit.value==='pixels'){
      const x0=Math.min(source.width-1,Math.floor(Math.min(drag.x,p.x)*source.width/1000));
      const y0=Math.min(source.height-1,Math.floor(Math.min(drag.y,p.y)*source.height/1000));
      const x1=Math.max(x0+1,Math.min(source.width,Math.ceil(Math.max(drag.x,p.x)*source.width/1000)));
      const y1=Math.max(y0+1,Math.min(source.height,Math.ceil(Math.max(drag.y,p.y)*source.height/1000)));
      draft={unit:'pixels',x:x0,y:y0,width:x1-x0,height:y1-y0,
        referenceWidth:source.width,referenceHeight:source.height};
    }
    else{const x0=Math.min(drag.x,p.x,999),y0=Math.min(drag.y,p.y,999);draft={x0,y0,x1:Math.max(x0+1,drag.x,p.x),y1:Math.max(y0+1,drag.y,p.y)};}
    fillFields();error.textContent='';drawAnalysisRegion();
  }
  function attachAnalysisRegionEvents() {
    cropButton.addEventListener('click',createSourceFromRegion);
    scope.addEventListener('change', () => {
      closeAnalysisRegion(); syncAnalysisRegion(); deps.updateAnalysis();
      if (scope.value==='region') openEditor('region');
    });
    unit.addEventListener('change',()=>{
      const previous=draft.unit==='pixels'?'pixels':'percent';
      const previousDraft={...draft};
      if(error.textContent){unit.value=previous;return;}
      try{
        if(unit.value==='pixels'){
          const bounds=analysisRegionBounds(source.width,source.height,draft);
          draft={unit:'pixels',...bounds,referenceWidth:source.width,referenceHeight:source.height};
        }else{
          const bounds=analysisRegionBounds(source.width,source.height,draft);
          draft={x0:Math.round(bounds.x*1000/source.width),y0:Math.round(bounds.y*1000/source.height),
            x1:Math.round((bounds.x+bounds.width)*1000/source.width),
            y1:Math.round((bounds.y+bounds.height)*1000/source.height)};
          analysisRegionBounds(source.width,source.height,draft);
        }
        fillFields();error.textContent='';drawAnalysisRegion();
      }catch{draft=previousDraft;unit.value=previous;error.textContent='Эта область слишком мала для точного ввода в процентах; оставьте пиксели.';}
    });
    get('analysisRegionApply').addEventListener('click',submit);
    get('analysisRegionReset').addEventListener('click',()=>apply(mode==='line'?DEFAULT_ANALYSIS_LINE:FULL));
    for(const preset of editor.querySelectorAll('[data-line-preset]'))preset.addEventListener('click',()=>{
      draft=preset.dataset.linePreset==='vertical'?{x0:500,y0:0,x1:500,y1:1000}:preset.dataset.linePreset==='diagonal'?{x0:0,y0:0,x1:1000,y1:1000}:{...DEFAULT_ANALYSIS_LINE};fillFields();error.textContent='';drawAnalysisRegion();
    });
    get('analysisRegionCancel').addEventListener('click',()=>closeAnalysisRegion(true));
    fields.forEach(input=>input.addEventListener('input',()=>{
      try{draft=readFields();error.textContent='';drawAnalysisRegion();}catch(e){error.textContent=e.message;}
    }));
    editor.addEventListener('keydown',event=>{
      if(event.key==='Escape'){event.preventDefault();event.stopPropagation();closeAnalysisRegion(true);}
      if(event.key==='Enter'&&fields.includes(event.target)){event.preventDefault();submit();}
    });
    canvas.addEventListener('pointerdown',event=>{
      if(event.button!==0||drag)return;const p=point(event);if(!p?.inside)return;
      event.preventDefault();drag={...p,id:event.pointerId,previous:{...draft}};canvas.setPointerCapture(event.pointerId);
    });
    canvas.addEventListener('pointermove',move);
    canvas.addEventListener('pointerup',event=>{if(drag?.id!==event.pointerId)return;move(event);drag=null;canvas.releasePointerCapture(event.pointerId);});
    canvas.addEventListener('pointercancel',event=>{if(drag?.id!==event.pointerId)return;draft=drag.previous;drag=null;fillFields();drawAnalysisRegion();});
    canvas.addEventListener('lostpointercapture',()=>{if(drag){draft=drag.previous;drag=null;fillFields();drawAnalysisRegion();}});
    syncAnalysisRegion();
  }
  return {getAnalysisScope,getAnalysisRegion,getAnalysisLine,syncAnalysisRegion,closeAnalysisRegion,toggleAnalysisLine,drawAnalysisRegion,attachAnalysisRegionEvents,captureAnalysisRegionPreferences,applyAnalysisRegionPreferences};
}
