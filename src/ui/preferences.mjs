import { PREFERENCES_KEY, ANALYSIS_PREFERENCE_FIELDS, defaultPreferences, normalizePreferences } from '../core/preferences.mjs';
import { BATCH_STORAGE_KEY, DEFAULT_EXPORT_CONFIG } from '../core/config.mjs';

// Application wires the feature snapshots together; no files or transient results are stored.
export function createPreferences({app,els},deps){
  const get=id=>document.getElementById(id);
  let enabled=false,restoring=false,timer=null,lastSaved='',warned=false,readFailed=false;
  function captureUserPreferences(){
    const fields=Object.fromEntries(Object.entries(ANALYSIS_PREFERENCE_FIELDS).map(([key,[id,fallback]])=>[key,typeof fallback==='number'?Number(get(id).value):get(id).value]));
    return normalizePreferences({version:1,comparison:deps.captureComparison(),filesVisible:!els.workspace.classList.contains('files-hidden'),
      panels:deps.captureAnalysisLayoutPreferences(),analysis:{...fields,...deps.captureAnalysisOutputPreferences(),...deps.captureAnalysisRegionPreferences()}});
  }
  function applyInterface(value){
    els.workspace.classList.toggle('files-hidden',!value.filesVisible);
    els.toggleFiles.setAttribute('aria-expanded',String(value.filesVisible));
    for(const [key,[id]] of Object.entries(ANALYSIS_PREFERENCE_FIELDS))get(id).value=String(value.analysis[key]);
    get('analysisLevelValue').textContent=String(value.analysis.level);
    get('analysisPositionValue').textContent=(value.analysis.position/10).toLocaleString('ru-RU')+'%';
    deps.applyAnalysisOutputPreferences(value.analysis);
    deps.applyAnalysisRegionPreferences(value.analysis);
    deps.applyAnalysisLayoutPreferences(value.panels);
  }
  function restoreUserPreferences(){
    let value=defaultPreferences();
    try {
      const raw=window.localStorage.getItem(PREFERENCES_KEY);
      if(raw!==null){if(raw.length>65536)throw new Error('Preferences too large');value=normalizePreferences(JSON.parse(raw));}
    } catch {readFailed=true;}
    restoring=true;
    try{
      app.layout=value.comparison.layout;app.background=value.comparison.background;
  els.metadataPolicy.value=value.comparison.metadataPolicy;els.backgroundSelect.value=app.background;
      app.variants.forEach((variant,i)=>{variant.config={...value.comparison.variants[i]};});
      applyInterface(value);
      lastSaved=JSON.stringify(value);
    }finally{restoring=false;}
  }
  function cancelSave(){if(timer!==null)clearTimeout(timer);timer=null;}
  function flushUserPreferences(){
    cancelSave();
    if(!enabled||restoring||deps.isAnalysisResizing())return;
    const serialized=JSON.stringify(captureUserPreferences());
    if(serialized===lastSaved)return;
    try{window.localStorage.setItem(PREFERENCES_KEY,serialized);lastSaved=serialized;warned=false;}
    catch{if(!warned){deps.showStatus('Не удалось сохранить настройки в браузере. Они действуют до закрытия страницы.',true);warned=true;}}
  }
  function requestSave(event){
    if(!enabled||restoring||event.target?.closest?.('#resetPreferences'))return;
    if(!event.target?.closest?.('.appbar, .cell-head, #analysisPanel, #analysisSplitter, #studyDialog, #tiffSettingsDialog'))return;
    cancelSave();timer=setTimeout(flushUserPreferences,150);
  }
  function resetUserPreferences(){
    if(app.batchRun?.running||deps.isAnalysisResizing()){
      deps.showStatus('Завершите обработку пакета или перетаскивание, затем сбросьте настройки.',true);return;
    }
    cancelSave();restoring=true;
    let stored=true;
    try{
      const value=defaultPreferences();
      if(els.batchDialog.open)els.batchDialog.close();
      if(get('studyDialog').open)get('studyDialog').close();
      // Set analysis before comparison changes trigger renders and new viewport sampling.
      app.layout=value.comparison.layout;
      applyInterface(value);
      deps.applyComparison(value.comparison);
      app.exportConfig={...DEFAULT_EXPORT_CONFIG};app.storageNotice='';app.storageWarning=false;
      deps.updateBatchUI();deps.updateAnalysis();deps.drawAll();
      stored=deps.resetTheme();
      for(const key of [PREFERENCES_KEY,BATCH_STORAGE_KEY]){
        try{window.localStorage.removeItem(key);}catch{stored=false;}
      }
      lastSaved=stored?JSON.stringify(captureUserPreferences()):'';
      warned=!stored;
      deps.showStatus(stored?'Начальные настройки восстановлены. Файлы и именованные наборы сохранены.':'Начальные настройки восстановлены на экране. Браузер не разрешил обновить хранилище.',!stored);
    }finally{restoring=false;}
  }
  function attachUserPreferenceEvents(){
    if(enabled)return;enabled=true;
    // Capture runs even when a feature stops propagation. Read after the committed action.
    for(const name of ['input','change','click','pointerup','pointercancel','keydown'])document.addEventListener(name,requestSave,true);
    window.addEventListener('pagehide',flushUserPreferences);
    window.addEventListener('blur',flushUserPreferences);
    document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')flushUserPreferences();});
    get('resetPreferences').addEventListener('click',resetUserPreferences);
    if(readFailed)deps.showStatus('Сохранённые настройки недоступны или повреждены. Используются начальные значения.',true);
  }
  return {restoreUserPreferences,attachUserPreferenceEvents,captureUserPreferences,flushUserPreferences,resetUserPreferences};
}
