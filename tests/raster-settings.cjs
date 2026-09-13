const assert=require('node:assert/strict');
class Element {
  constructor(){this.value='';this.checked=false;this.hidden=false;this.open=false;this.style={};this.listeners={};this.children=[];this.classList={contains:()=>false,toggle(){}};this.validity={valid:true};}
  append(...items){this.children.push(...items);}
  replaceChildren(...items){this.children=items;}
  setAttribute(name,value){this[name]=value;}
  addEventListener(name,fn){(this.listeners[name]??=[]).push(fn);}
  emit(name){for(const fn of this.listeners[name]||[])fn({target:this});}
  showModal(){this.open=true;}
  close(){this.open=false;this.emit('close');}
}
(async()=>{
  const {normalizeBatchSettings,validateComparison,parseProfiles}=await import('../src/core/settings.mjs');
  const {DEFAULT_VARIANTS,DEFAULT_EXPORT_CONFIG}=await import('../src/core/config.mjs');
  const {normalizeTiffOptions}=await import('../src/core/raster-codecs.mjs');
  const options={tiffCompression:'lzw',tiffLevel:9,tiffPredictor:false};
  const comparison={layout:2,background:'checker',metadataPolicy:'panorama',variants:DEFAULT_VARIANTS.map(v=>({...v}))};
  comparison.variants[1]={...comparison.variants[1],format:'tiff',...options};
  assert.deepEqual(normalizeTiffOptions(validateComparison(comparison).variants[1]),options);
  assert.deepEqual(normalizeTiffOptions(parseProfiles({version:1,profiles:[{name:'TIFF',settings:comparison}]})[0].settings.variants[1]),options);
  assert.deepEqual(normalizeTiffOptions(normalizeBatchSettings({...DEFAULT_EXPORT_CONFIG,...options})),options);
  assert.deepEqual(normalizeTiffOptions(normalizeBatchSettings({tiffLevel:99,tiffPredictor:'false',tiffCompression:'unknown'})),normalizeTiffOptions());
  assert.throws(()=>validateComparison({...comparison,variants:comparison.variants.map(v=>({...v,tiffLevel:100}))}));
  const elements=new Map(),get=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};
  global.document={getElementById:get,createElement:()=>new Element(),createTextNode:text=>({textContent:text})};
  const {createFormatSettings}=await import('../src/ui/format-settings.mjs');
  const settings=createFormatSettings();let result;
  settings.openTiffSettings(options,value=>{result=value;});
  const dialog=get('tiffSettingsDialog');assert.equal(dialog.open,true);assert.equal(get('tiffLevelField').hidden,true);
  get('tiffCompression').value='none';dialog.emit('input');assert.equal(get('tiffPredictorField').hidden,true);assert.equal(result.tiffCompression,'none');
  get('tiffCompression').value='deflate';get('tiffLevel').value='3';dialog.emit('input');assert.equal(result.tiffLevel,3);assert.equal(get('tiffLevelField').hidden,false);
  dialog.close();const closed=result;dialog.emit('input');assert.equal(result,closed,'Closing releases callback');
  const {createControls}=await import('../src/ui/controls.mjs');let dirty=0;
  const deps={...settings,markDirty(){dirty++;}};
  const controls=createControls({els:{},app:{}},deps);deps.syncControlsVisibility=controls.syncControlsVisibility;
  const variant={index:1,head:new Element(),config:{...comparison.variants[1]}};
  controls.buildCellControls(variant);controls.syncControlsVisibility(variant);assert.equal(variant.controls.tiffSettings.hidden,false);
  variant.controls.tiffSettings.emit('click');get('tiffCompression').value='deflate';get('tiffLevel').value='7';dialog.emit('input');
  assert.equal(variant.config.tiffLevel,7);assert.equal(dirty,1,'A codec option invalidates and schedules comparison');dialog.close();
  variant.config.format='png';controls.syncControlsVisibility(variant);assert.equal(variant.controls.tiffSettings.hidden,true);

  const {createBatchDialog}=await import('../src/ui/batch-dialog.mjs');
  const app={files:[{name:'source.png'}],exportConfig:{...DEFAULT_EXPORT_CONFIG,format:'tiff',...options},storageWarning:false};
  const els=new Proxy({}, {get:(_,key)=>get(key)});els.batchResizeMode.value='original';
  let persisted=0,previews=0;
  const batchDeps={...settings,clearBatchPreview(){},formatUnavailableReason(){return '';},batchFilesLabel:n=>String(n),selectedBatchFiles:()=>app.files,
    validateExportConfig(){},exportConfigDescription:()=>'',uniqueOutputName:()=>'',requestBatchPreview(){previews++;},persistBatchSettings(){persisted++;},updateBatchUI(){}};
  Object.assign(batchDeps,createBatchDialog({app,els},batchDeps));
  const original={...app.exportConfig};batchDeps.openBatchDialog();get('batchTiffSettings').onclick();
  get('tiffCompression').value='none';dialog.emit('input');dialog.close();
  assert.equal(batchDeps.readBatchDialogConfig().tiffCompression,'none');assert.deepEqual(app.exportConfig,original,'Draft must not mutate saved batch settings');
  els.batchDialog.close();batchDeps.openBatchDialog();assert.equal(batchDeps.readBatchDialogConfig().tiffCompression,'lzw','Cancel drops the draft');
  get('batchTiffSettings').onclick();get('tiffLevel').value='2';get('tiffCompression').value='deflate';dialog.emit('input');dialog.close();
  batchDeps.commitBatchDialog(false);assert.equal(persisted,1);assert.equal(app.exportConfig.tiffLevel,2);assert.ok(previews>=3);
  console.log('PASS TIFF profiles, normalization, automatic comparison, conditional controls, batch draft/cancel/save and preview invalidation');
  delete global.document;
})().catch(error=>{console.error(error);process.exitCode=1;});
