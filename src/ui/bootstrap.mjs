import { DEFAULT_VARIANTS } from "./../core/config.mjs";
import { SAMPLE_CATALOG } from '../core/reference-samples.mjs';

// Dependencies are bound by application.mjs after all components are constructed.
export function createBootstrap({app, els}, deps) {
  function init() {
    deps.attachThemeEvents();
    deps.restoreBatchSettings();
    app.variants = [...document.querySelectorAll(".cell")].map((cell, index) => ({
      index,
      cell,
      head: cell.querySelector(".cell-head"),
      foot: cell.querySelector(".cell-foot"),
      canvas: cell.querySelector("canvas"),
      ctx: cell.querySelector("canvas").getContext("2d", app.float16Canvas
        ? { alpha: false, colorSpace: 'srgb', colorType: 'float16' } : { alpha: false }),
      config: { ...DEFAULT_VARIANTS[index] },
      controls: {},
      generation: 0,
      dirty: false,
      url: null,
      bitmap: null,
      imageData: null,
      blob: null,
      metrics: null,
      error: null
    }));
    try { app.float16CanvasReady = app.float16Canvas && app.wipeFloat16 && app.variants.every(variant => variant.ctx?.getContextAttributes?.().colorType === 'float16'); }
    catch { app.float16CanvasReady = false; }
  
    deps.restoreUserPreferences();
    for (const variant of app.variants) {
      deps.buildCellControls(variant);
      deps.buildMetrics(variant);
      deps.attachCanvasEvents(variant.canvas);
    }
  
    deps.attachEvents();
    deps.attachWipeEvents();
    deps.attachDisplayEvents();
    deps.attachFileDropEvents();
    deps.attachBatchPreviewEvents();
    deps.attachStudyEvents();
    deps.attachLicenseEvents();
    deps.attachAnalysisEvents();
    deps.attachPixelInspectorEvents();
    deps.updateFileList();
    deps.updateCodecStatus();
    deps.detectEncoderSupport();
    deps.updateLayout(app.layout);
    deps.observeCanvasSizes();
    deps.drawAll();
    deps.attachUserPreferenceEvents();
    void deps.loadAdditionalCodecs();
  }
  
  function attachEvents() {
    els.metadataPolicy.addEventListener("change", () => {
      for (const variant of app.variants) deps.markDirty(variant);
    });
    els.convertAll.addEventListener("click", deps.openBatchDialog);
    for (const id of ["batchDialogClose", "batchDialogCancel"]) {
      document.getElementById(id).addEventListener("click", () => els.batchDialog.close());
    }
    els.batchDialog.addEventListener("close", () => { if (!els.batchDialog.open) deps.clearBatchPreview(); });
    els.batchForm.addEventListener("input", event => {
      if (event.target === els.batchQuality) els.batchQualityNumber.value = els.batchQuality.value;
      if (event.target === els.batchQualityNumber && els.batchQualityNumber.validity.valid && els.batchQualityNumber.value !== "") {
        els.batchQuality.value = els.batchQualityNumber.value;
      }
      deps.updateBatchDialog();
    });
    els.batchForm.addEventListener("change", () => deps.updateBatchDialog());
    els.batchDialog.addEventListener("keydown", event => {
      if (event.key !== "Tab") return;
      const controls = [...els.batchDialog.querySelectorAll("button, input, select, summary, [tabindex]")]
        .filter(control => !control.disabled && control.tabIndex >= 0 && control.getClientRects().length);
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    });
    els.batchSaveSettings.addEventListener("click", () => deps.commitBatchDialog(false));
    els.batchForm.addEventListener("submit", event => { event.preventDefault(); deps.commitBatchDialog(true); });
    els.cancelBatch.addEventListener("click", () => deps.cancelBatch());
    els.fileInput.addEventListener("change", () => {
      deps.addFiles(els.fileInput.files);
      els.fileInput.value = "";
    });
  
    const samplePicker=document.getElementById('samplePicker');
    const setSampleMenuOpen=open=>{
      els.sampleMenu.hidden=!open;
      els.sampleMenuToggle.setAttribute('aria-expanded',String(open));
    };
    async function addSample(id){
      if (app.batchRun?.running || app.samplePending) return;
      const generation = app.listGeneration;
      app.samplePending = true;
      deps.updateBatchUI();
      try {
        const file = await deps.createSampleFile(id);
        if (generation === app.listGeneration) deps.addFiles([file]);
      } catch (error) { deps.showStatus("Не удалось создать образец: " + (error.message || error), true); }
      finally { app.samplePending = false; deps.updateBatchUI(); }
    }
    for(const sample of SAMPLE_CATALOG){
      const button=document.createElement('button'),label=document.createElement('strong'),description=document.createElement('span');
      button.type='button';button.className='sample-menu-item';button.dataset.sampleId=sample.id;
      label.textContent=sample.label;
      description.textContent=`${sample.size} · ${sample.description}`;
      button.append(label,description);
      button.addEventListener('click',async()=>{
        setSampleMenuOpen(false);
        await addSample(sample.id);
        if(document.activeElement===button||document.activeElement===document.body)els.sampleMenuToggle.focus();
      });
      els.sampleMenu.append(button);
    }
    els.sampleImage.addEventListener('click',()=>{setSampleMenuOpen(false);void addSample('canvas');});
    els.sampleMenuToggle.addEventListener('click',()=>setSampleMenuOpen(els.sampleMenu.hidden));
    els.sampleMenuToggle.addEventListener('keydown',event=>{
      if(event.key==='ArrowDown'){event.preventDefault();setSampleMenuOpen(true);els.sampleMenu.querySelector('button')?.focus();}
    });
    els.sampleMenu.addEventListener('keydown',event=>{
      if(!['ArrowDown','ArrowUp'].includes(event.key))return;
      event.preventDefault();
      const buttons=[...els.sampleMenu.querySelectorAll('button')],index=buttons.indexOf(document.activeElement);
      buttons[(index+(event.key==='ArrowDown'?1:buttons.length-1))%buttons.length].focus();
    });
    document.addEventListener('keydown',event=>{
      if(event.key==='Escape'&&!els.sampleMenu.hidden){event.preventDefault();setSampleMenuOpen(false);els.sampleMenuToggle.focus();}
    });
    document.addEventListener('pointerdown',event=>{if(!samplePicker.contains(event.target)&&!els.sampleMenu.contains(event.target))setSampleMenuOpen(false);});
  
    els.toggleFiles.addEventListener("click", () => {
      const hidden = els.workspace.classList.toggle("files-hidden");
      els.toggleFiles.setAttribute("aria-expanded", String(!hidden));
      deps.drawAll();
    });
    els.previousFile.addEventListener("click", () => deps.selectAdjacentFile(-1));
    els.nextFile.addEventListener("click", () => deps.selectAdjacentFile(1));
    els.clearFiles.addEventListener("click", () => deps.clearFiles());
    els.fileList.addEventListener("keydown", (event) => {
      const button = event.target.closest(".file-select");
      if (!button || !["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const index = app.files.findIndex(item => item.id === button.closest(".file-row").dataset.fileId);
      const target = event.key === "Home" ? 0 : event.key === "End" ? app.files.length - 1
        : deps.clamp(index + (event.key === "ArrowUp" ? -1 : 1), 0, app.files.length - 1);
      deps.selectFile(app.files[target].id);
      app.fileRows.get(app.files[target].id).querySelector(".file-select").focus();
    });
  
    els.retryCodecs.addEventListener("click", () => deps.loadAdditionalCodecs());
  
    els.layout2.addEventListener("click", () => { deps.setWipeMode(false, false); deps.updateLayout(2); });
    els.layout4.addEventListener("click", () => { deps.setWipeMode(false, false); deps.updateLayout(4); });
  
    els.backgroundSelect.addEventListener("change", () => {
      app.background = els.backgroundSelect.value;
      deps.drawAll();
    });
  
  
    els.resetView.addEventListener("click", () => {
      deps.resetView();
      deps.drawAll();
    });
  
    els.fitView.addEventListener("click", () => {
      deps.resetView();
      deps.drawAll();
    });
  
    window.addEventListener("resize", () => {
      deps.resizeCanvases();
      deps.drawAll();
    });
  
  }

  return { init, attachEvents };
}
