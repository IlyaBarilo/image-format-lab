import { FORMAT_DEFS } from "./../core/config.mjs";

// Dependencies are bound by application.mjs after all components are constructed.
export function createBatchDialog({els, app}, deps) {
  function updateBatchDialogFormats(current = els.batchFormat.value) {
    els.batchFormat.replaceChildren();
    for (const [key, def] of Object.entries(FORMAT_DEFS)) {
      if (key === "original") continue;
      const option = document.createElement("option");
      option.value = key;
      const reason = deps.formatUnavailableReason(key);
      option.disabled = Boolean(reason);
      option.textContent = def.label + (reason ? def.codec ? " — кодек не готов" : " — недоступен" : "");
      els.batchFormat.append(option);
    }
    // Keep an unavailable saved choice visible; never silently change the requested format.
    els.batchFormat.value = current;
  }
  
  function openBatchDialog() {
    if (app.batchRun?.running || app.samplePending || !app.files.length || els.batchDialog.open) return;
    const config = app.exportConfig;
    deps.updateBatchDialogFormats(config.format);
    els.batchQuality.value = config.quality;
    els.batchQualityNumber.value = config.quality;
    els.batchGifColors.value = config.gifColors;
    els.batchGifDither.checked = config.gifDither;
    els.batchResizeMode.value = config.resizeWidth || config.resizeHeight ? "limit" : "original";
    els.batchDialogWidth.value = config.resizeWidth;
    els.batchDialogHeight.value = config.resizeHeight;
    els.batchMatte.value = config.matte;
    els.batchMetadata.value = config.metadataPolicy;
    document.getElementById("batchDelivery").value = config.delivery || "files";
    document.getElementById("batchTargetKB").value = config.targetKB || "";
    document.getElementById("batchMinQuality").value = config.minQuality || 40;
    deps.clearBatchPreview();
    els.batchDialog.showModal();
    deps.updateBatchDialog();
  }
  
  function readBatchDialogConfig() {
    const format = els.batchFormat.value;
    const def = FORMAT_DEFS[format];
    const limited = els.batchResizeMode.value === "limit";
    const quality = Number(els.batchQualityNumber.value);
    const colors = Number(els.batchGifColors.value);
    return {
      format,
      quality: def?.lossy || (Number.isInteger(quality) && quality >= 1 && quality <= 100) ? quality : app.exportConfig.quality,
      gifColors: format === "gif" || format === "gifenc" || (Number.isInteger(colors) && colors >= 2 && colors <= 256) ? colors : app.exportConfig.gifColors,
      gifDither: els.batchGifDither.checked,
      matte: els.batchMatte.value,
      metadataPolicy: els.batchMetadata.value,
      resizeWidth: limited ? els.batchDialogWidth.value : "",
      resizeHeight: limited ? els.batchDialogHeight.value : "",
      delivery: document.getElementById("batchDelivery").value,
      targetKB: def?.lossy ? document.getElementById("batchTargetKB").value : "",
      minQuality: Number(document.getElementById("batchMinQuality").value)
    };
  }
  
  function batchDialogError(config) {
    try {
      deps.validateExportConfig(config);
      if (els.batchResizeMode.value === "limit" && !config.resizeWidth && !config.resizeHeight) return "Укажите максимальную ширину или высоту.";
      if (els.batchResizeMode.value === "limit" && (!els.batchDialogWidth.validity.valid || !els.batchDialogHeight.validity.valid)) return "Размеры должны быть целыми числами от 1 до 32768 пикселей.";
      if (!deps.selectedBatchFiles().length) return "Отметьте файлы для пакета в общем списке.";
      if (app.batchRun?.running || app.samplePending) return "Дождитесь завершения текущей операции.";
      return "";
    } catch (error) { return error.message; }
  }
  
  function updateBatchDialog() {
    if (!els.batchDialog.open) return;
    const config = deps.readBatchDialogConfig();
    const def = FORMAT_DEFS[config.format];
    const gif = config.format === "gif" || config.format === "gifenc";
    els.batchQualityField.hidden = !def?.lossy;
    document.getElementById("batchBudgetFields").hidden = !def?.lossy;
    els.batchGifField.hidden = !gif;
    els.batchDitherField.hidden = config.format !== "gif";
    els.batchMatteField.hidden = def?.alpha !== "none";
    els.batchDimensions.hidden = els.batchResizeMode.value !== "limit";
    els.batchMetadataHint.textContent = config.format === "jpeg"
      ? "В JPEG можно сохранить только GPano. EXIF и остальные метаданные удаляются."
      : "В выбранном формате метаданные удаляются. Сохранение GPano применяется только к JPEG.";
    const count = deps.selectedBatchFiles().length;
    els.batchDialogCount.textContent = `Будет обработано: ${deps.batchFilesLabel(count)} из ${app.files.length} — отметки общего списка.`;
    els.batchStart.textContent = `Конвертировать ${deps.batchFilesLabel(count)}`;
    const error = deps.batchDialogError(config);
    els.batchDialogError.textContent = error;
    els.batchDialogError.hidden = !error;
    els.batchStart.disabled = Boolean(error);
    els.batchSaveSettings.disabled = Boolean(error);
    els.batchDialogSummary.textContent = error ? "Проверьте настройки перед сохранением и запуском." : `${deps.batchFilesLabel(count)} → ${deps.exportConfigDescription(config)}; ${config.delivery === "zip" ? "один ZIP" : "отдельные файлы"}`;
    els.batchNameExample.textContent = def && app.files.length
      ? `Пример имени: ${app.files[0].name} → ${deps.uniqueOutputName(app.files[0].name, config.format, new Set())}` : "";
    els.batchStorageNotice.textContent = app.storageNotice || "Настройки сохраняются в этом браузере при сохранении или запуске. Файлы в хранилище не записываются.";
    if (!app.storageWarning && Object.keys(config).some(key => config[key] !== app.exportConfig[key])) {
      els.batchStorageNotice.textContent = "Изменения ещё не сохранены. Нажмите «Сохранить настройки» или запустите конвертацию.";
    }
    els.batchStorageNotice.classList.toggle("batch-storage-warning", app.storageWarning);
    deps.requestBatchPreview(config, error);
  }
  
  function commitBatchDialog(start) {
    const config = deps.readBatchDialogConfig();
    if (deps.batchDialogError(config)) { deps.updateBatchDialog(); return; }
    Object.assign(app.exportConfig, config);
    deps.persistBatchSettings();
    deps.updateBatchUI();
    if (start) {
      deps.clearBatchPreview();
      els.batchDialog.close();
      deps.convertAllFiles();
    }
  }

  return { updateBatchDialogFormats, openBatchDialog, readBatchDialogConfig, batchDialogError, updateBatchDialog, commitBatchDialog };
}
