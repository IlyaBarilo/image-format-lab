import { DEFAULT_VARIANTS, EXPERIMENTS, PROFILE_KEY } from "./../core/config.mjs";
import { REFERENCE_SAMPLES, createReferenceSamplePixels } from '../core/reference-samples.mjs';

// Dependencies are bound by application.mjs after all components are constructed.
export function createStudy({app, els}, deps) {
  function captureComparison() {
    return { layout: app.layout, background: app.background, autoApply: true,
      metadataPolicy: els.metadataPolicy.value, variants: app.variants.map(v => ({ ...v.config })) };
  }
  
  function applyComparison(value) {
    const settings = deps.validateComparison(value);
    // Invalidate all old results first; updateLayout below starts one rendering pass.
    els.metadataPolicy.value = settings.metadataPolicy;
    els.backgroundSelect.value = app.background = settings.background;
    app.variants.forEach((v, i) => { v.config = settings.variants[i]; deps.markDirty(v, { schedule: false }); deps.disposeVariantOutput(v); deps.buildCellControls(v); deps.buildMetrics(v); });
    deps.updateFormatOptions(); deps.resetView(); deps.updateLayout(settings.layout);
    const unavailable = settings.variants.filter(v => v.format !== "original").map(v => deps.formatUnavailableReason(v.format)).filter(Boolean);
    deps.studyNotice(unavailable.length ? unavailable.join(" ") : "Настройки сравнения применены. Параметры пакета сохранены.");
  }
  
  function studyNotice(message) { document.getElementById("studyNotice").textContent = message; }

  function applyExperiment(key) {
    const experiment=EXPERIMENTS[key];
    if(!experiment)throw new Error('Неизвестный эксперимент.');
    const variants=experiment.formats.map((format,i)=>({...DEFAULT_VARIANTS[i],format,quality:85,gifColors:key==='palette'&&i<3?16:256,gifDither:key==='palette'?i!==1:true}));
    deps.applyComparison({layout:4,background:'checker',autoApply:true,metadataPolicy:'panorama',variants});
  }
  
  function saveProfiles() {
    try { localStorage.setItem(PROFILE_KEY, JSON.stringify({version:1, profiles:app.profiles})); deps.studyNotice("Наборы сохранены в этом браузере."); }
    catch { deps.studyNotice("Хранилище недоступно. Наборы действуют в текущем сеансе; сохраните их кнопкой экспорта JSON."); }
    deps.updateProfiles();
  }
  
  function updateProfiles() {
    const select = document.getElementById("profileSelect"), index = select.selectedIndex;
    select.replaceChildren(...app.profiles.map((p,i) => {const option = document.createElement("option"); option.value=i; option.textContent=p.name; return option;}));
    if (app.profiles.length) select.selectedIndex = Math.max(0, Math.min(index, app.profiles.length - 1));
    for (const id of ["profileApply", "profileDelete"]) document.getElementById(id).disabled = !app.profiles.length;
  }
  
  function attachStudyEvents() {
    const $ = id => document.getElementById(id);
    app.profiles = [];
    try { const raw=localStorage.getItem(PROFILE_KEY); if(raw) app.profiles=deps.parseProfiles(JSON.parse(raw)); }
    catch { deps.studyNotice("Не удалось прочитать наборы. Можно импортировать исправный JSON или сохранить новые настройки."); }
    deps.updateProfiles();
    const action=(id,fn)=>$(id).addEventListener("click",()=>{try {fn();} catch(error){deps.studyNotice(error.message);}});
    action("studyOpen",()=>{deps.updateFormatHelp();$("studyDialog").showModal();});
    const question=()=>{$("experimentQuestion").textContent=EXPERIMENTS[$("experimentSelect").value].question;}; question();
    $("experimentSelect").addEventListener("change",question);
    action("experimentApply",()=>applyExperiment($("experimentSelect").value));
    $("referenceSampleCreate").addEventListener('click',async()=>{
      const button=$("referenceSampleCreate"),id=$("referenceSampleSelect").value,definition=REFERENCE_SAMPLES[id];
      if(button.disabled||!definition||app.batchRun?.running)return;
      const listGeneration=app.listGeneration;
      button.disabled=true;
      try{
        const pixels=createReferenceSamplePixels(id);
        const blob=await deps.encodeExactPng(pixels,8);
        if(listGeneration!==app.listGeneration)return;
        const file=new File([blob],definition.fileName,{type:'image/png'});
        deps.addFiles([file]);
        $("experimentSelect").value=definition.experiment;question();
        applyExperiment(definition.experiment);
        deps.studyNotice(`Контрольный образец «${definition.label}» открыт; соответствующий эксперимент применён.`);
        $("studyDialog").close();
      }catch(error){deps.studyNotice(error.message||String(error));}
      finally{button.disabled=false;}
    });
    action("profileSave",()=>{
      const name=$("profileName").value.trim(); if(!name) throw new Error("Введите название набора.");
      const index=app.profiles.findIndex(p=>p.name===name);
      if(index<0&&app.profiles.length>=50) throw new Error("Доступно не больше 50 наборов.");
      const profile={name,settings:deps.validateComparison(deps.captureComparison())};
      if(index<0) app.profiles.push(profile); else app.profiles[index]=profile;
      deps.saveProfiles();
    });
    action("profileApply",()=>deps.applyComparison(app.profiles[Number($("profileSelect").value)].settings));
    action("profileDelete",()=>{app.profiles.splice(Number($("profileSelect").value),1);deps.saveProfiles();});
    action("profileReset",()=>deps.applyComparison({layout:2,background:"checker",autoApply:true,metadataPolicy:"panorama",variants:DEFAULT_VARIANTS}));
    action("profileExport",()=>deps.downloadBlob(new Blob([JSON.stringify({version:1,profiles:app.profiles},null,2)],{type:"application/json"}),"comparison-profiles.json"));
    $("profileImport").addEventListener("change",async()=>{
      const file=$("profileImport").files[0]; $("profileImport").value=""; if(!file) return;
      try {
        if(file.size>200000) throw new Error("Файл наборов слишком большой (предел 200 КБ).");
        const incoming=deps.parseProfiles(JSON.parse(await file.text()));
        if(incoming.length+app.profiles.length>50) throw new Error("После импорта будет больше 50 наборов.");
        for(const p of incoming){let name=p.name,n=2;while(app.profiles.some(v=>v.name===name))name=p.name.slice(0,70)+` (${n++})`;app.profiles.push({...p,name});}
        deps.saveProfiles();
      }catch(error){deps.studyNotice(error.message);}
    });
    action("reportJSON",()=>deps.saveComparisonReport("json")); action("reportCSV",()=>deps.saveComparisonReport("csv"));
    $("reportProtocol").addEventListener('click',async()=>{
      const button=$("reportProtocol");if(button.disabled)return;button.disabled=true;
      try{await deps.saveExperimentProtocol();deps.studyNotice('Протокол опыта сохранён.');}
      catch(error){deps.studyNotice(error.message||String(error));}
      finally{button.disabled=false;}
    });
    action("zoomIn",()=>deps.setComparisonScale(deps.comparisonScale()*1.25));
    action("zoomOut",()=>deps.setComparisonScale(deps.comparisonScale()/1.25));
    action("zoom100",()=>deps.setComparisonScale(1));
    action("batchSelectAll",()=>deps.setBatchSelection(true)); action("batchSelectNone",()=>deps.setBatchSelection(false));
    action("retryBatch",()=>deps.retryBatchErrors());
    for(const v of app.variants) {
      v.canvas.tabIndex=0;v.canvas.setAttribute("aria-label",`Вариант ${v.index+1}. Плюс/минус — масштаб, 0 — вписать, 1 — 100%, стрелки — перемещение.`);
      v.canvas.addEventListener("keydown",event=>{
        if(!app.source) return;
        if(["+","=","-","0","1","ArrowLeft","ArrowRight","ArrowUp","ArrowDown"].includes(event.key))event.preventDefault();else return;
        if(event.key==="+"||event.key==="=")deps.setComparisonScale(deps.comparisonScale()*1.25);
        else if(event.key==="-")deps.setComparisonScale(deps.comparisonScale()/1.25);
        else if(event.key==="0"){deps.resetView();deps.drawAll();}else if(event.key==="1")deps.setComparisonScale(1);
        else {const step=40/deps.comparisonScale();app.view.centerX+=event.key==="ArrowRight"?step:event.key==="ArrowLeft"?-step:0;app.view.centerY+=event.key==="ArrowDown"?step:event.key==="ArrowUp"?-step:0;deps.drawAll();}
      });
    }
  }

  return { captureComparison, applyComparison, studyNotice, saveProfiles, updateProfiles, attachStudyEvents };
}
