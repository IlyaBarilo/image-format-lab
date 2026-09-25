const assert=require('node:assert/strict');
class Element {
  constructor(){this.value='';this.checked=false;this.hidden=false;this.open=false;this.style={};this.listeners={};this.children=[];this.classList={contains:()=>false,toggle(){}};this.validity={valid:true};}
  set innerHTML(value){this.children=[];}
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
  const controlsApp={variants:[],codecs:{},support:new Map()};
  const controls=createControls({els:{batchDialog:get('batchDialog')},app:controlsApp},deps);deps.syncControlsVisibility=controls.syncControlsVisibility;
  const variant={index:1,head:new Element(),config:{...comparison.variants[1]}};
  controls.buildCellControls(variant);controls.syncControlsVisibility(variant);
  const c=variant.controls;
  assert.equal(c.tiffCompressionWrap.hidden,false);assert.equal(c.tiffCompression.value,'lzw');
  assert.equal(c.tiffLevelWrap.hidden,true);assert.equal(c.tiffPredictorWrap.hidden,false);assert.equal(c.tiffPredictor.checked,false);
  c.tiffCompression.value='deflate';c.tiffCompression.emit('change');assert.equal(c.tiffLevelWrap.hidden,false);
  c.tiffLevel.value='7';c.tiffLevel.emit('input');assert.equal(c.tiffLevelValue.textContent,'7');
  c.tiffPredictor.checked=true;c.tiffPredictor.emit('change');
  assert.equal(variant.config.tiffLevel,7);assert.equal(variant.config.tiffPredictor,true);assert.equal(dirty,3,'Each inline codec option invalidates and schedules comparison');
  assert.equal(dialog.open,false,'Comparison options do not open a dialog');
  c.tiffCompression.value='none';c.tiffCompression.emit('change');
  assert.equal(c.tiffLevelWrap.hidden,true);assert.equal(c.tiffPredictorWrap.hidden,true);
  variant.config.format='png';controls.syncControlsVisibility(variant);assert.equal(c.tiffCompressionWrap.hidden,true);
  variant.config.format='tiff';c.tiffCompression.value='deflate';c.tiffCompression.emit('change');
  assert.equal(c.tiffLevel.value,'7');assert.equal(c.tiffPredictor.checked,true,'Hidden settings survive format/compression changes');
  controls.buildCellControls(variant);controls.syncControlsVisibility(variant);
  assert.equal(variant.controls.tiffLevel.value,'7','Rebuilt controls restore saved settings');
  const other={index:2,head:new Element(),config:{...DEFAULT_VARIANTS[2]}};
  controls.buildCellControls(other);assert.equal(other.controls.tiffCompressionWrap.hidden,true);
  other.config.format='tiff';controls.syncControlsVisibility(other);
  assert.equal(other.controls.tiffCompression.value,'deflate');assert.equal(other.controls.tiffLevel.value,'6','Cells keep independent settings');

  const bmpSettings=structuredClone(comparison);
  bmpSettings.variants[0].format='bmp24';bmpSettings.variants[1].format='bmp32';
  const restored=parseProfiles({version:1,profiles:[{name:'BMP',settings:bmpSettings}]})[0].settings;
  controlsApp.variants=restored.variants.map((config,index)=>({index,head:new Element(),config}));
  controlsApp.variants.forEach(controls.buildCellControls);controls.updateFormatOptions();
  const [bmp24,bmp32]=controlsApp.variants;
  for(const v of [bmp24,bmp32]){
    assert.equal(v.controls.select.value,'bmp');
    assert.deepEqual(v.controls.select.children.filter(o=>o.textContent.startsWith('BMP')).map(o=>o.value),['bmp']);
    assert.equal(v.controls.bmpDepthWrap.hidden,false);assert.equal(v.controls.qualityWrap.style.display,'none');
  }
  assert.equal(bmp24.controls.bmpDepth.value,'24');assert.equal(bmp24.controls.matteWrap.style.display,'');
  assert.equal(bmp32.controls.bmpDepth.value,'32');assert.equal(bmp32.controls.matteWrap.style.display,'none');
  const dirtyBefore=dirty;
  bmp24.controls.bmpDepth.value='32';bmp24.controls.bmpDepth.emit('change');
  assert.equal(bmp24.config.format,'bmp32');assert.equal(bmp24.controls.matteWrap.style.display,'none');assert.equal(dirty,dirtyBefore+1);
  bmp24.controls.select.value='png';bmp24.controls.select.emit('change');assert.equal(bmp24.controls.bmpDepthWrap.hidden,true);
  bmp24.controls.select.value='bmp';bmp24.controls.select.emit('change');assert.equal(bmp24.config.format,'bmp32','Returning to BMP retains the depth in this cell');
  bmp24.controls.bmpDepth.value='24';bmp24.controls.bmpDepth.emit('change');assert.equal(bmp24.config.format,'bmp24');
  assert.equal(bmp32.config.format,'bmp32','Depth changes remain independent between comparison cells');
  const {normalizePreferences}=await import('../src/core/preferences.mjs');
  const roundtrip=normalizePreferences({version:1,comparison:{...restored,variants:controlsApp.variants.map(v=>v.config)}});
  assert.deepEqual(roundtrip.comparison.variants.slice(0,2).map(v=>v.format),['bmp24','bmp32']);
  assert.equal(normalizeBatchSettings({...DEFAULT_EXPORT_CONFIG,format:'bmp32'}).format,'bmp32');
  controls.updateFormatOptions();assert.equal(bmp32.controls.bmpDepth.value,'32','Codec availability refresh preserves depth');

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
  els.batchDialog.close();app.exportConfig.format='bmp32';batchDeps.openBatchDialog();
  assert.equal(els.batchFormat.value,'bmp');assert.equal(get('batchBmpDepth').value,'32');assert.equal(get('batchBmpField').hidden,false);
  assert.deepEqual(els.batchFormat.children.filter(o=>o.textContent==='BMP').map(o=>o.value),['bmp']);
  assert.equal(els.batchMatteField.hidden,true);assert.equal(els.batchQualityField.hidden,true);
  const previewBefore=previews;
  get('batchBmpDepth').value='24';batchDeps.updateBatchDialog();
  assert.equal(batchDeps.readBatchDialogConfig().format,'bmp24');assert.equal(els.batchMatteField.hidden,false);assert.equal(previews,previewBefore+1);
  assert.equal(app.exportConfig.format,'bmp32','Editing batch depth does not change saved settings');
  els.batchDialog.close();batchDeps.openBatchDialog();assert.equal(get('batchBmpDepth').value,'32','Cancel restores saved depth');
  get('batchBmpDepth').value='24';batchDeps.commitBatchDialog(false);assert.equal(app.exportConfig.format,'bmp24');
  assert.equal(bmp32.config.format,'bmp32','Saving batch depth leaves comparison settings intact');
  els.batchFormat.value='png';batchDeps.updateBatchDialog();assert.equal(get('batchBmpField').hidden,true);
  els.batchFormat.value='bmp';batchDeps.updateBatchDialogFormats();batchDeps.updateBatchDialog();
  assert.equal(batchDeps.readBatchDialogConfig().format,'bmp24','Format refresh keeps the current draft depth');
  els.batchDialog.close();
  const pngComparison=structuredClone(comparison);
  pngComparison.variants[2]={...pngComparison.variants[2],pngDepth:'16'};
  assert.equal(parseProfiles({version:1,profiles:[{name:'PNG16',settings:pngComparison}]}).at(0).settings.variants[2].pngDepth,'16');
  assert.equal(normalizePreferences({version:1,comparison:pngComparison}).comparison.variants[2].pngDepth,'16');
  assert.throws(()=>validateComparison({...pngComparison,variants:pngComparison.variants.map(v=>({...v,pngDepth:'32'}))}));
  assert.equal(normalizeBatchSettings({pngDepth:'32'}).pngDepth,'auto');
  assert.equal(normalizeBatchSettings({pngDepth:16}).pngDepth,'auto');
  assert.equal(normalizeBatchSettings({pngDepth:'16'}).pngDepth,'16');
  const png={index:2,head:new Element(),config:{...pngComparison.variants[2]}};
  controls.buildCellControls(png);assert.equal(png.controls.pngDepth.value,'16');assert.equal(png.controls.pngDepthWrap.hidden,false);
  const beforePng=dirty;png.controls.pngDepth.value='8';png.controls.pngDepth.emit('change');assert.equal(png.config.pngDepth,'8');assert.equal(dirty,beforePng+1);
  png.controls.select.value='pngUpng';png.controls.select.emit('change');assert.equal(png.controls.pngDepthWrap.hidden,true);
  png.controls.select.value='png';png.controls.select.emit('change');assert.equal(png.controls.pngDepth.value,'8');
  controls.buildCellControls(png);assert.equal(png.controls.pngDepth.value,'8');
  app.exportConfig={...DEFAULT_EXPORT_CONFIG,format:'png',pngDepth:'16'};batchDeps.openBatchDialog();
  assert.equal(get('batchPngField').hidden,false);assert.equal(get('batchPngDepth').value,'16');
  const beforePngPreview=previews;get('batchPngDepth').value='8';batchDeps.updateBatchDialog();assert.equal(previews,beforePngPreview+1);
  assert.equal(batchDeps.readBatchDialogConfig().pngDepth,'8');assert.equal(app.exportConfig.pngDepth,'16');
  els.batchDialog.close();batchDeps.openBatchDialog();assert.equal(get('batchPngDepth').value,'16','Cancel restores saved PNG depth');
  get('batchPngDepth').value='auto';batchDeps.commitBatchDialog(false);assert.equal(app.exportConfig.pngDepth,'auto');
  assert.equal(png.config.pngDepth,'8','Batch depth does not mutate comparison');
  els.batchFormat.value='jpeg';batchDeps.updateBatchDialog();assert.equal(get('batchPngField').hidden,true);els.batchDialog.close();
  const {createBatchSettings}=await import('../src/ui/batch-settings.mjs');
  const batchSettings=createBatchSettings({app},{formatUnavailableReason:()=>''});
  assert.throws(()=>batchSettings.validateExportConfig({...app.exportConfig,pngDepth:'32'}),/выберите/);
  assert.match(batchSettings.exportConfigDescription({...app.exportConfig,pngDepth:'16'}),/16 бит/);
  console.log('PASS PNG depth persistence/profiles, independent cells, automatic changes and batch draft/cancel/save');
  console.log('PASS single BMP choice, saved 24/32 profiles/preferences, automatic depth changes, matte visibility, independent cells and batch draft/cancel/save');
  console.log('PASS TIFF profiles, normalization, automatic comparison, conditional controls, batch draft/cancel/save and preview invalidation');
  delete global.document;
})().catch(error=>{console.error(error);process.exitCode=1;});
