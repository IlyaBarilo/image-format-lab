import { normalizeTiffOptions } from '../core/raster-codecs.mjs';
import { normalizeJpegOptions } from '../core/jpeg-encode.mjs';
import { normalizeModernOptions } from '../core/modern-options.mjs';
import { normalizeAvifOptions } from '../core/avif-options.mjs';
import { FORMAT_DEFS } from "./../core/config.mjs";
import { FORMAT_OPTIONS, isBmpFormat, formatOptionValue, formatFromOption } from "./../core/format-options.mjs";

// Dependencies are bound by application.mjs after all components are constructed.
export function createBatchDialog({els, app}, deps) {
  function updateBatchDialogFormats(current = els.batchFormat.value) {
    els.batchFormat.replaceChildren();
    for (const {format: key, value, label} of FORMAT_OPTIONS) {
      if (key === "original") continue;
      const def = FORMAT_DEFS[key];
      const option = document.createElement("option");
      option.value = value;
      const reason = deps.formatUnavailableReason(key);
      option.disabled = Boolean(reason);
      option.textContent = label + (reason ? def.codec ? " — кодек не готов" : " — недоступен" : "");
      els.batchFormat.append(option);
    }
    // Keep an unavailable saved choice visible; never silently change the requested format.
    els.batchFormat.value = formatOptionValue(current);
  }
  
  function openBatchDialog() {
    if (app.batchRun?.running || app.samplePending || !app.files.length || els.batchDialog.open) return;
    const config = app.exportConfig;
    document.getElementById('batchPngDepth').value=config.pngDepth || 'auto';
    document.getElementById('batchPngMode').value=config.format==='pngIndexed'?'palette':config.format==='pngUpng'?'optimized':'rgba';
    document.getElementById('batchPngFilter').value=config.pngFilter || 'default';
    document.getElementById('batchPngLevel').value=String(config.pngLevel??6);
    document.getElementById("batchBmpDepth").value = config.format === 'bmp8' ? '8' : config.format === "bmp32" ? "32" : "24";
    document.getElementById('batchBmpColors').value = String(config.bmpColors ?? 256);
    document.getElementById('batchBmpCompression').value = config.bmpCompression || 'none';
    const jpeg=normalizeJpegOptions(config);
    document.getElementById('batchJpegSubsampling').value=jpeg.jpegSubsampling;
    document.getElementById('batchJpegProgressive').checked=jpeg.jpegProgressive;
    const modern=normalizeModernOptions(config);
    document.getElementById('batchWebpMethod').value=String(modern.webpMethod);
    document.getElementById('batchJxlEffort').value=String(modern.jxlEffort);
    document.getElementById('batchJxlDepth').value=modern.jxlDepth;
    document.getElementById('batchAvifSpeed').value=String(normalizeAvifOptions(config).avifSpeed);
    app.batchTiffDraft = normalizeTiffOptions(config);
    document.getElementById("batchTiffSettings").onclick = () => deps.openTiffSettings(app.batchTiffDraft, options => {
      app.batchTiffDraft = options;
      deps.updateBatchDialog();
    });
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
    const format = formatFromOption(els.batchFormat.value, document.getElementById("batchBmpDepth").value,document.getElementById('batchPngMode').value);
    const def = FORMAT_DEFS[format];
    const limited = els.batchResizeMode.value === "limit";
    const quality = Number(els.batchQualityNumber.value);
    const colors = Number(els.batchGifColors.value);
    const bmpColors = Number(document.getElementById('batchBmpColors').value);
    return {
      pngDepth:document.getElementById('batchPngDepth').value,
      pngFilter:document.getElementById('batchPngFilter').value,
      pngLevel:Number(document.getElementById('batchPngLevel').value),
      ...normalizeTiffOptions(app.batchTiffDraft || app.exportConfig),
      jpegSubsampling:document.getElementById('batchJpegSubsampling').value,
      jpegProgressive:document.getElementById('batchJpegProgressive').checked,
      webpMethod:Number(document.getElementById('batchWebpMethod').value),
      jxlEffort:Number(document.getElementById('batchJxlEffort').value),
      jxlDepth:document.getElementById('batchJxlDepth').value,
      avifSpeed:Number(document.getElementById('batchAvifSpeed').value),
      format,
      quality: def?.lossy || (Number.isInteger(quality) && quality >= 1 && quality <= 100) ? quality : app.exportConfig.quality,
      gifColors: ["gif", "gifenc", "pngIndexed"].includes(format) || (Number.isInteger(colors) && colors >= 2 && colors <= 256) ? colors : app.exportConfig.gifColors,
      gifDither: els.batchGifDither.checked,
      bmpColors: format === 'bmp8' ? bmpColors : app.exportConfig.bmpColors,
      bmpCompression: format === 'bmp8' ? document.getElementById('batchBmpCompression').value : app.exportConfig.bmpCompression,
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
    const gif = ["gif", "gifenc", "pngIndexed"].includes(config.format);
    document.getElementById("batchBmpField").hidden = !isBmpFormat(config.format);
    document.getElementById('batchBmpColorsField').hidden = config.format !== 'bmp8';
    document.getElementById('batchBmpCompressionField').hidden = config.format !== 'bmp8';
    document.getElementById("batchTiffField").hidden = config.format !== "tiff";
    document.getElementById('batchJpegSubsamplingField').hidden=config.format!=='jpeg';
    document.getElementById('batchJpegProgressiveField').hidden=config.format!=='jpeg';
    document.getElementById('batchWebpMethodField').hidden=config.format!=='webpLossless';
    document.getElementById('batchJxlEffortField').hidden=!['jxl','jxlLossless'].includes(config.format);
    document.getElementById('batchJxlDepthField').hidden=config.format!=='jxlLossless';
    document.getElementById('batchAvifSpeedField').hidden=config.format!=='avif';
    document.getElementById('batchWebpMethodValue').textContent=String(config.webpMethod);
    document.getElementById('batchJxlEffortValue').textContent=String(config.jxlEffort);
    document.getElementById('batchAvifSpeedValue').textContent=String(config.avifSpeed);
    document.getElementById('batchPngField').hidden=config.format!=='png';
    document.getElementById('batchPngModeField').hidden=!['png','pngIndexed','pngUpng'].includes(config.format);
    document.getElementById('batchPngFilterField').hidden=!['png','pngIndexed'].includes(config.format);
    document.getElementById('batchPngLevelField').hidden=!['png','pngIndexed'].includes(config.format)||config.pngFilter==='default';
    document.getElementById('batchPngLevelValue').textContent=String(config.pngLevel);
    els.batchQualityField.hidden = !def?.lossy;
    document.getElementById("batchBudgetFields").hidden = !def?.lossy;
    els.batchGifField.hidden = !gif;
    els.batchDitherField.hidden = config.format !== "gif" && config.format !== "pngIndexed";
    els.batchMatteField.hidden = def?.alpha !== "none";
    els.batchDimensions.hidden = els.batchResizeMode.value !== "limit";
    els.batchMetadataHint.textContent = config.format === "jpeg"
      ? "В JPEG можно сохранить только GPano. EXIF и остальные метаданные удаляются."
      : config.format === 'png' ? 'Исходные метаданные удаляются. Точный PNG записывает известную метку sRGB; GPano применяется только к JPEG.'
      : config.format === 'jp2' ? 'При повторной записи JP2 без изменения размеров сохраняется ICC-профиль исходного JP2. EXIF и GPano не переносятся. Q100 — без потерь.'
      : config.format === 'j2k' ? 'J2K — поток без контейнерных метаданных. Q100 — без потерь; меньшие значения — с потерями.'
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
