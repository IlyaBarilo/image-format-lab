

// Dependencies are bound by application.mjs after all components are constructed.
export function createFiles({app, els}, deps) {
  function isImageCandidate(file) {
    return file && ((file.type || "").toLowerCase().startsWith("image/") ||
      /\.(jpe?g|png|gif|webp|bmp|avif|heic|heif|tif|tiff|jxl|ico)$/i.test(file.name || ""));
  }
  
  function addFiles(fileList, { openFirst = false } = {}) {
    if (app.batchRun?.running) { deps.showStatus("Дождитесь завершения пакета или отмените обработку."); return; }
    const offered = Array.from(fileList || []);
    if (!offered.length) return;
    const incoming = offered.filter(deps.isImageCandidate);
    if (!incoming.length) { deps.showStatus("Среди добавленных файлов нет изображений.", true); return; }
    const firstAddedId = String(app.nextFileId);
    for (const file of incoming) {
      app.files.push({ id: String(app.nextFileId++), file, name: file.name || "image",
        size: file.size, type: file.type, batchSelected: true, width: null, height: null, status: "idle", error: "" });
    }
    els.workspace.classList.remove("files-hidden");
    els.toggleFiles.setAttribute("aria-expanded", "true");
    deps.updateFileList();
    if (openFirst || incoming.length === 1 || !app.files.some(item => item.id === app.selectedFileId)) {
      deps.selectFile(firstAddedId);
    }
    const skipped = offered.length - incoming.length;
    deps.showStatus(`Добавлено файлов: ${incoming.length}.` + (skipped ? ` Пропущено файлов других типов: ${skipped}.` : ""));
  }
  
  async function selectFile(id) {
    const item = app.files.find(entry => entry.id === id);
    if (!item || (id === app.selectedFileId && (app.sourceLoading || app.source?.file === item.file))) return;
    const previous = app.files.find(entry => entry.id === app.selectedFileId);
    if (previous?.status === "loading") previous.status = previous.width ? "ready" : "idle";
    const selection = ++app.selectionGeneration;
    app.selectedFileId = id;
    item.status = "loading";
    item.error = "";
    const loading = deps.loadFile(item.file, { fileId: id, announce: false });
    deps.updateFileList();
    const row = app.fileRows.get(id);
    if (row) {
      if (row.offsetTop < els.fileList.scrollTop) els.fileList.scrollTop = row.offsetTop;
      else if (row.offsetTop + row.offsetHeight > els.fileList.scrollTop + els.fileList.clientHeight)
        els.fileList.scrollTop = row.offsetTop + row.offsetHeight - els.fileList.clientHeight;
    }
    const loaded = await loading;
    if (selection !== app.selectionGeneration || app.selectedFileId !== id) return;
    if (loaded) {
      item.width = app.source.width;
      item.height = app.source.height;
      item.status = "ready";
    } else {
      item.status = "error";
      item.error = app.sourceError || "Не удалось открыть изображение";
      deps.showStatus(`Не удалось открыть ${item.name}: ${item.error}`, true);
    }
    deps.updateFileList();
  }
  
  function selectAdjacentFile(direction) {
    const index = app.files.findIndex(item => item.id === app.selectedFileId);
    const next = app.files[index + direction];
    if (next) deps.selectFile(next.id);
  }
  
  function removeFile(id) {
    if (app.batchRun?.running) return;
    const index = app.files.findIndex(item => item.id === id);
    if (index < 0) return;
    const focusWasInRow = app.fileRows.get(id)?.contains(document.activeElement);
    const wasSelected = app.selectedFileId === id;
    app.files.splice(index, 1);
    if (!app.files.length) {
      deps.clearFiles();
      if (focusWasInRow) els.toggleFiles.focus();
      return;
    }
    if (wasSelected) deps.selectFile(app.files[Math.min(index, app.files.length - 1)].id);
    deps.updateFileList();
    if (focusWasInRow) app.fileRows.get(app.selectedFileId)?.querySelector(".file-select").focus();
  }
  
  function clearFiles() {
    if (app.batchRun?.running) return;
    app.listGeneration++;
    app.selectionGeneration++;
    app.files = [];
    app.selectedFileId = null;
    deps.disposeSource();
    deps.resetView();
    deps.setEmptyState("Перетащите изображение сюда", "Оно сразу откроется для сравнения. Или нажмите «Добавить» или «Образец» в колонке файлов.");
    deps.updateFileList();
    deps.drawAll();
    deps.showStatus("Список очищен.");
  }
  
  function updateFileList() {
    els.fileCount.textContent = els.fileCountToggle.textContent = String(app.files.length);
    els.fileListEmpty.hidden = app.files.length > 0;
    els.clearFiles.disabled = app.files.length === 0;
    const selectedIndex = app.files.findIndex(item => item.id === app.selectedFileId);
    els.previousFile.disabled = selectedIndex <= 0;
    els.nextFile.disabled = selectedIndex < 0 || selectedIndex >= app.files.length - 1;
    const ids = new Set(app.files.map(item => item.id));
    for (const [id, row] of app.fileRows) {
      if (!ids.has(id)) { row.remove(); app.fileRows.delete(id); }
    }
    for (const item of app.files) {
      let row = app.fileRows.get(item.id);
      if (!row) {
        row = document.createElement("li");
        row.className = "file-row";
        row.dataset.fileId = item.id;
        const button = document.createElement("button");
        button.type = "button";
        button.className = "file-select";
        for (const name of ["file-name", "file-meta", "file-state", "file-batch-state"]) {
          const span = document.createElement("span"); span.className = name; button.append(span);
        }
        button.addEventListener("click", () => deps.selectFile(item.id));
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "icon-btn file-remove";
        remove.textContent = "×";
        remove.title = "Убрать из списка: " + item.name;
        remove.setAttribute("aria-label", remove.title);
        remove.addEventListener("click", () => deps.removeFile(item.id));
        const check = document.createElement("input");
        check.type = "checkbox"; check.className = "file-check";
        check.setAttribute("aria-label", "Включить в пакет: " + item.name);
        check.addEventListener("change", () => { item.batchSelected = check.checked; deps.updateBatchUI(); });
        row.append(check, button, remove);
        app.fileRows.set(item.id, row);
        els.fileList.append(row);
      }
      const selected = item.id === app.selectedFileId;
      row.querySelector(".file-check").checked = item.batchSelected !== false;
      row.querySelector(".file-check").disabled = Boolean(app.batchRun?.running);
      row.classList.toggle("active", selected);
      row.classList.toggle("error", item.status === "error");
      const button = row.querySelector(".file-select");
      if (selected) button.setAttribute("aria-current", "true"); else button.removeAttribute("aria-current");
      button.tabIndex = selected || selectedIndex < 0 && item === app.files[0] ? 0 : -1;
      button.setAttribute("aria-busy", String(item.status === "loading"));
      button.title = item.name + (item.error ? "\n" + item.error + "\nНажмите, чтобы повторить открытие." : "");
      row.querySelector(".file-name").textContent = item.name;
      row.querySelector(".file-meta").textContent = (item.width ? `${item.width}×${item.height} • ` : "") + deps.formatBytes(item.size);
      row.querySelector(".file-state").textContent = item.status === "loading" ? "Открываю…"
        : item.status === "error" ? "Ошибка · нажмите для повтора" : selected ? "Выбран" : "";
      const entry = app.batchRun?.byId.get(item.id);
      row.classList.toggle("batch-error", entry?.status === "error");
      const batchState = row.querySelector(".file-batch-state");
      batchState.textContent = entry ? deps.batchStatusLabel(entry.status) : "";
      batchState.title = entry?.error || entry?.outputName || "";
    }
    deps.updateBatchUI();
  }
  
  function selectedBatchFiles() { return app.files.filter(item=>item.batchSelected!==false); }
  
  function setBatchSelection(selected) {if(app.batchRun?.running)return;for(const item of app.files)item.batchSelected=selected;deps.updateFileList();}

  return { isImageCandidate, addFiles, selectFile, selectAdjacentFile, removeFile, clearFiles, updateFileList, selectedBatchFiles, setBatchSelection };
}
