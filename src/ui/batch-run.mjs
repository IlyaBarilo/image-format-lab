

// Dependencies are bound by application.mjs after all components are constructed.
export function createBatchRun({app, els}, deps) {
  function batchFilesLabel(count) {
    const last = count % 10, tail = count % 100;
    return `${count} ${tail >= 11 && tail <= 14 ? "файлов" : last === 1 ? "файл" : last >= 2 && last <= 4 ? "файла" : "файлов"}`;
  }
  
  function batchStatusLabel(status) {
    return { pending: "В очереди", processing: "Конвертирую…", ready: "Готово для ZIP", sent: "Передано браузеру",
      error: "Ошибка конвертации", skipped: "Пропущено после отмены" }[status] || "";
  }
  
  function updateBatchUI() {
    const run = app.batchRun;
    const running = Boolean(run?.running);
    document.getElementById('resetPreferences').disabled = running;
    document.getElementById("batchSelectionCount").textContent = `Для пакета: ${deps.selectedBatchFiles().length}/${app.files.length}`;
    for(const id of ["batchSelectAll","batchSelectNone"]) document.getElementById(id).disabled=running;
    for(const row of app.fileRows.values()) row.querySelector(".file-check").disabled=running;
    document.getElementById("retryBatch").hidden=running || !run?.entries.some(entry=>entry.status==="error");
    els.fileInput.disabled = running;
    document.querySelector('label[for="fileInput"]').setAttribute("aria-disabled", String(running));
    els.sampleImage.disabled = running || app.samplePending;
    els.clearFiles.disabled = running || !app.files.length;
    for (const row of app.fileRows.values()) row.querySelector(".file-remove").disabled = running;
    let configError = "";
    try { deps.validateExportConfig(app.exportConfig); } catch (error) { configError = error.message; }
    els.convertAll.disabled = running || app.samplePending || !app.files.length;
    els.convertAll.title = running ? "Пакет уже обрабатывается" : app.files.length ? `Настроить конвертацию ${app.files.length} файлов` : "Добавьте файлы в список";
    els.convertAll.textContent = running ? "Обработка…" : "Пакетное конвертирование…";
    els.batchPanel.hidden = !run;
    els.batchPanel.parentElement.classList.toggle("has-batch", !els.batchPanel.hidden);
    els.cancelBatch.hidden = !running;
    els.cancelBatch.disabled = Boolean(run?.cancelRequested);
    els.cancelBatch.textContent = run?.cancelRequested ? "Останавливаю…" : "Отмена";
    els.batchProgress.hidden = !run;
    els.batchReport.hidden = !run;
    els.batchRunConfig.hidden = !run;
    els.batchStorageWarning.hidden = !app.storageWarning;
    els.batchStorageWarning.textContent = app.storageNotice;
    deps.updateBatchDialog();
    if (!run) {
      els.batchSummary.textContent = configError || (app.files.length
        ? `В списке: ${app.files.length}. Сохранение использует настройки конвертации.` : "Добавьте файлы для сохранения.");
      return;
    }
    els.batchProgress.max = run.entries.length;
    els.batchProgress.value = run.completed;
    const current = run.entries.find(entry => entry.status === "processing");
    els.batchSummary.textContent = running
      ? `${run.cancelRequested ? "Остановка после текущего файла. " : ""}Обработано ${run.completed}/${run.entries.length}` + (current ? ` · ${current.name}` : "")
      : `${run.cancelled ? "Остановлено" : "Обработка завершена"}. Передано браузеру: ${run.sent}; ошибок: ${run.failed}; пропущено: ${run.entries.length - run.completed}.`;
    els.batchRunConfig.textContent = (running ? "Текущий пакет: " : "Последний пакет: ") + deps.exportConfigDescription(run.config)
      + (running ? ". Набор файлов и параметры зафиксированы; изменения настроек применятся к следующему запуску." : ". Передача браузеру не подтверждает сохранение на диске.");
  }
  
  function updateBatchReport(run) {
    const fragment = document.createDocumentFragment();
    for (const entry of run.entries) {
      const li = document.createElement("li");
      if (entry.status === "error") li.className = "error";
      li.textContent = `${entry.name} → ${entry.outputName}: ${deps.batchStatusLabel(entry.status)}`
        + (entry.error ? ` — ${entry.error}` : entry.status === "sent" ? ` · ${entry.width}×${entry.height} · ${deps.formatBytes(entry.size)}` : "");
      fragment.append(li);
    }
    els.batchResults.replaceChildren(fragment);
  }
  
  function cancelBatch() {
    if (!app.batchRun?.running) return;
    app.batchRun.cancelRequested = true;
    deps.updateBatchUI();
  }
  
  async function convertAllFiles(retry = null) {
    if (app.batchRun?.running || app.samplePending || !app.files.length) return;
    const config = Object.freeze({ ...(retry ? retry.config : app.exportConfig) });
    try { deps.validateExportConfig(config); } catch (error) { deps.showStatus(error.message, true); return; }
    const used = new Set();
    const files = retry ? retry.entries.map(entry=>({entry,item:app.files.find(item=>item.id===entry.id)})).filter(pair=>pair.item) : deps.selectedBatchFiles().map(item=>({item}));
    if(!files.length) {deps.showStatus("Нет отмеченных файлов для обработки.",true);return;}
    const entries = files.map(({item,entry}) => ({ id: item.id, file: item.file, name: item.name,
      outputName: entry?.outputName || deps.uniqueOutputName(item.name, config.format, used), status: "pending", error: "" }));
    const run = { config, entries, byId: new Map(entries.map(entry => [entry.id, entry])),
      running: true, cancelRequested: false, cancelled: false, completed: 0, sent: 0, failed: 0 };
    const archive=[];let archiveBytes=0;
    app.batchRun = run;
    deps.updateBatchReport(run);
    deps.updateFileList();
    try {
      for (const entry of entries) {
        if (run.cancelRequested) break;
        entry.status = "processing";
        deps.updateFileList();
        // Let the progress and cancellation control paint before processing the next image.
        await new Promise(resolve => setTimeout(resolve, 0));
        try {
          const source = await deps.decodeSourceFile(entry.file);
          const encoded = await deps.encodeFromSource(config, source);
          const verified = await deps.decodeVariantForPreview(encoded.blob);
          try {
            if (verified.imageData.width !== encoded.width || verified.imageData.height !== encoded.height)
              throw new Error("Размеры сохранённого файла не совпадают с ожидаемыми");
          } finally { verified.bitmap?.close(); }
          if(config.delivery === "zip") {
            if(archiveBytes+encoded.blob.size>256*1024*1024) throw new Error("Превышен предел ZIP 256 МиБ. Повторите ошибки отдельными файлами или уменьшите набор/размеры.");
            archive.push({name:entry.outputName,blob:encoded.blob,entry});archiveBytes+=encoded.blob.size;
            entry.status="ready";
          } else {deps.downloadBlob(encoded.blob, entry.outputName);entry.status="sent";run.sent++;}
          entry.width = encoded.width;
          entry.height = encoded.height;
          entry.size = encoded.blob.size;
          entry.quality = encoded.selectedQuality ?? config.quality;
        } catch (error) {
          entry.status = "error";
          entry.error = error.message || String(error);
          run.failed++;
        } finally {
          entry.file = null;
          run.completed++;
          deps.updateBatchReport(run);
          deps.updateFileList();
        }
        await new Promise(resolve => setTimeout(resolve, 120));
      }
      if(archive.length) {
        try {
          els.batchSummary.textContent="Подготавливаю ZIP из успешно обработанных файлов…";
          const zip=await deps.createStoredZip(archive);
          deps.downloadBlob(zip,run.cancelRequested||run.failed?"converted-partial.zip":"converted.zip");
          for(const file of archive){file.entry.status="sent";run.sent++;}
        }catch(error){for(const file of archive){file.entry.status="error";file.entry.error="Не удалось передать ZIP: "+error.message;run.failed++;}}
      }
    } finally {
      archive.length=0;
      run.running = false;
      run.cancelled = run.cancelRequested && run.completed < entries.length;
      for (const entry of entries) {
        if (entry.status === "pending") entry.status = "skipped";
        entry.file = null;
      }
      deps.updateBatchReport(run);
      deps.updateFileList();
      deps.showStatus(els.batchSummary.textContent, run.failed > 0);
    }
  }
  
  function retryBatchErrors() {
    const run=app.batchRun;
    if(!run || run.running)return;
    const entries=run.entries.filter(entry=>entry.status==="error");
    const missing=entries.filter(entry=>!app.files.some(item=>item.id===entry.id));
    if(missing.length){deps.showStatus("Для повтора добавьте заново удалённые исходники: "+missing.map(entry=>entry.name).join(", "),true);return;}
    deps.convertAllFiles({config:{...run.config},entries});
  }

  return { batchFilesLabel, batchStatusLabel, updateBatchUI, updateBatchReport, cancelBatch, convertAllFiles, retryBatchErrors };
}
