import { FORMAT_DEFS } from "./../core/config.mjs";

// Dependencies are bound by application.mjs after all components are constructed.
export function createBatchPreview({app, els}, deps) {
  function clearBatchPreview(resetView = true) {
    const preview = app.batchPreview;
    preview.generation++;
    clearTimeout(preview.timer);
    preview.timer = null;
    preview.pending = false;
    preview.requestKey = null;
    preview.bitmap?.close?.();
    preview.bitmap = null;
    preview.blob = null;
    preview.source = null;
    preview.resultConfig = null;
    preview.resultKey = null;
    preview.metrics = null;
    preview.width = preview.height = 0;
    preview.pointer = null;
    if (resetView) {
      preview.zoom = 1;
      preview.centerX = preview.centerY = 0.5;
      preview.viewSourceGeneration = null;
    }
    for (const canvas of [els.batchPreviewBefore, els.batchPreviewAfter]) canvas.width = canvas.height = 1;
    els.batchPreviewSource.textContent = "";
    els.batchPreviewBeforeInfo.textContent = "";
    els.batchPreviewAfterInfo.textContent = "";
    els.batchPreviewMetrics.textContent = "";
    els.batchPreviewStatus.textContent = "";
    els.batchPreviewDownload.disabled = true;
  }
  
  function requestBatchPreview(config, configError) {
    const preview = app.batchPreview;
    const key = JSON.stringify([config, configError, app.sourceGeneration, app.selectedFileId, app.sourceLoading, Boolean(app.source)]);
    if (key === preview.requestKey) return;
    const newSource = preview.viewSourceGeneration !== app.sourceGeneration;
    deps.clearBatchPreview(newSource);
    preview.viewSourceGeneration = app.sourceGeneration;
    preview.requestKey = key;
    const error = configError || (!app.source || app.sourceLoading ? "Для предпросмотра дождитесь открытия текущего файла или выберите другой файл в списке." : "");
    els.batchPreviewStatus.classList.toggle("batch-dialog-error", Boolean(error));
    if (error) {
      els.batchPreviewStatus.textContent = error;
      deps.drawBatchPreview();
      return;
    }
    preview.source = app.source;
    els.batchPreviewSource.textContent = preview.source.name;
    els.batchPreviewBeforeInfo.textContent = `${preview.source.width}×${preview.source.height} px · ${deps.formatBytes(preview.source.size)}`;
    els.batchPreviewStatus.textContent = "Обновляю предпросмотр…";
    preview.pending = true;
    preview.timer = setTimeout(deps.renderBatchPreview, 280);
    deps.drawBatchPreview();
  }
  
  async function renderBatchPreview() {
    const preview = app.batchPreview;
    if (preview.busy || !preview.pending || !els.batchDialog.open || !preview.source) return;
    clearTimeout(preview.timer);
    preview.pending = false;
    preview.busy = true;
    const generation = preview.generation;
    const source = preview.source;
    const sourceGeneration = app.sourceGeneration;
    const config = Object.freeze({ ...deps.readBatchDialogConfig() });
    const current = () => els.batchDialog.open && generation === preview.generation && source === app.source && sourceGeneration === app.sourceGeneration;
    let decoded = null;
    try {
      deps.validateExportConfig(config);
      const encoded = await deps.encodeFromSource(config, source, current);
      if (!current()) return;
      decoded = await deps.decodeVariantForPreview(encoded.blob, encoded.exactPng);
      if (!current()) return;
      if (decoded.imageData.width !== encoded.width || decoded.imageData.height !== encoded.height) throw new Error("Размеры результата не совпадают с ожидаемыми.");
      const { psnr, alpha } = await deps.measurePixels(encoded.sourcePixelBuffer, decoded.pixelBuffer, { allowUnknownColorSpace: true });
      if (!current()) return;
      preview.bitmap = decoded.bitmap;
      decoded = null;
      preview.blob = encoded.blob;
      preview.width = encoded.width;
      preview.height = encoded.height;
      preview.resultConfig = config;
      preview.resultKey = preview.requestKey;
      preview.metrics = { psnr, alpha };
      els.batchPreviewAfterInfo.textContent = `${encoded.width}×${encoded.height} px · ${deps.formatBytes(encoded.blob.size)}`;
      els.batchPreviewMetrics.textContent = `PSNR RGB: ${psnr === Infinity ? "∞" : psnr === null ? "—" : psnr.toFixed(2)} dB · Δα: ${alpha === null ? "—" : alpha.toFixed(2)}%`;
      els.batchPreviewMetrics.title = app.variants[0].metricsEls.psnr.parentElement.title;
      els.batchPreviewStatus.textContent = `${FORMAT_DEFS[config.format].label} · ${encoded.panoramaPreserved ? "GPano сохранены" : "без GPano"}`;
      if(encoded.precisionNote)els.batchPreviewStatus.textContent += ' · '+encoded.precisionNote;
      if (encoded.selectedQuality !== undefined) els.batchPreviewStatus.textContent += ` · подобрано качество ${encoded.selectedQuality}, проб: ${encoded.attempts}`;
    } catch (error) {
      if (!current()) return;
      els.batchPreviewStatus.textContent = "Ошибка предпросмотра: " + (error.message || error);
      els.batchPreviewStatus.classList.add("batch-dialog-error");
    } finally {
      decoded?.bitmap?.close?.();
      preview.busy = false;
      if (current()) deps.drawBatchPreview();
      // Only one preview encoder runs at a time. Superseded work yields to the latest draft.
      if (preview.pending && els.batchDialog.open) {
        clearTimeout(preview.timer);
        preview.timer = setTimeout(deps.renderBatchPreview, 0);
      }
    }
  }
  
  function isBatchPreviewReady() {
    const preview = app.batchPreview;
    return Boolean(els.batchDialog.open && preview.blob && preview.source === app.source && preview.resultKey === preview.requestKey &&
      preview.resultConfig && JSON.stringify(preview.resultConfig) === JSON.stringify(deps.readBatchDialogConfig()));
  }
  
  function drawBatchPreview() {
    if (!els.batchDialog.open) return;
    const preview = app.batchPreview;
    const source = preview.source;
    const dpr = Math.max(1, Math.min(2.5, window.devicePixelRatio || 1));
    for (const [canvas, bitmap] of [[els.batchPreviewBefore, source?.canvas], [els.batchPreviewAfter, preview.bitmap]]) {
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      const ctx = canvas.getContext("2d");
      deps.drawBackground(ctx, canvas.width, canvas.height);
      if (!bitmap || !source) continue;
      const scale = Math.min(canvas.width / source.width, canvas.height / source.height) * 0.94 * preview.zoom;
      const width = source.width * scale, height = source.height * scale;
      const x = canvas.width / 2 - preview.centerX * width, y = canvas.height / 2 - preview.centerY * height;
      ctx.imageSmoothingEnabled = width < bitmap.width;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(bitmap, x, y, width, height);
      deps.drawImageFrame(ctx, x, y, width, height);
    }
    els.batchPreviewDownload.disabled = !deps.isBatchPreviewReady();
    for (const id of ["batchPreviewZoomOut", "batchPreviewZoomIn", "batchPreviewFit"]) document.getElementById(id).disabled = !source;
  }
  
  function attachBatchPreviewEvents() {
    const preview = app.batchPreview;
    const zoom = factor => { if (preview.source) { preview.zoom = deps.clamp(preview.zoom * factor, 0.08, 128); deps.drawBatchPreview(); } };
    document.getElementById("batchPreviewZoomOut").addEventListener("click", () => zoom(1 / 1.5));
    document.getElementById("batchPreviewZoomIn").addEventListener("click", () => zoom(1.5));
    document.getElementById("batchPreviewFit").addEventListener("click", () => {
      preview.zoom = 1; preview.centerX = preview.centerY = 0.5; deps.drawBatchPreview();
    });
    els.batchPreviewDownload.addEventListener("click", () => {
      if (!deps.isBatchPreviewReady()) return;
      try { deps.downloadBlob(preview.blob, deps.uniqueOutputName(preview.source.name, preview.resultConfig.format, new Set())); }
      catch (error) { els.batchPreviewStatus.textContent = "Не удалось скачать: " + (error.message || error); }
    });
    for (const canvas of [els.batchPreviewBefore, els.batchPreviewAfter]) {
      canvas.addEventListener("wheel", event => { if (!preview.source) return; event.preventDefault(); zoom(event.deltaY < 0 ? 1.12 : 1 / 1.12); }, { passive: false });
      canvas.addEventListener("pointerdown", event => {
        if (!preview.source) return;
        preview.pointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
        canvas.setPointerCapture(event.pointerId);
      });
      canvas.addEventListener("pointermove", event => {
        const pointer = preview.pointer;
        if (!pointer || pointer.id !== event.pointerId || !preview.source) return;
        const rect = canvas.getBoundingClientRect(), source = preview.source;
        const scale = Math.min(rect.width / source.width, rect.height / source.height) * 0.94 * preview.zoom;
        preview.centerX -= (event.clientX - pointer.x) / (source.width * scale);
        preview.centerY -= (event.clientY - pointer.y) / (source.height * scale);
        pointer.x = event.clientX; pointer.y = event.clientY;
        deps.drawBatchPreview();
      });
      for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) canvas.addEventListener(type, () => { preview.pointer = null; });
    }
    if ("ResizeObserver" in window) {
      const observer = new ResizeObserver(deps.drawBatchPreview);
      observer.observe(els.batchPreviewBefore);
      observer.observe(els.batchPreviewAfter);
    }
    window.addEventListener("resize", deps.drawBatchPreview);
  }

  return { clearBatchPreview, requestBatchPreview, renderBatchPreview, isBatchPreviewReady, drawBatchPreview, attachBatchPreviewEvents };
}
