import { FORMAT_DEFS } from "./../core/config.mjs";

// Dependencies are bound by application.mjs after all components are constructed.
export function createControls({els, app}, deps) {
  function setEmptyState(title, message) {
    els.emptyTitle.textContent = title;
    els.emptyMessage.textContent = message;
    els.emptyState.style.display = "";
  }
  
  function observeCanvasSizes() {
    if (!("ResizeObserver" in window)) {
      deps.resizeCanvases();
      return;
    }
  
    const observer = new ResizeObserver(() => {
      deps.resizeCanvases();
      deps.drawAll();
    });
  
    for (const variant of app.variants) {
      observer.observe(variant.canvas.parentElement);
    }
  }
  
  function buildCellControls(variant) {
    const head = variant.head;
    head.innerHTML = "";
  
    const title = document.createElement("div");
    title.className = "cell-title";
    title.textContent = String(variant.index + 1);
    head.append(title);
  
    const select = document.createElement("select");
    select.className = "select format-select";
    select.title = "Формат варианта";
    head.append(select);
  
    const qualityWrap = document.createElement("label");
    qualityWrap.className = "quality-wrap";
    qualityWrap.title = "Качество кодирования";
    qualityWrap.append(document.createTextNode("Q"));
  
    const quality = document.createElement("input");
    quality.className = "quality";
    quality.type = "range";
    quality.min = "1";
    quality.max = "100";
    quality.step = "1";
    quality.value = String(variant.config.quality);
    qualityWrap.append(quality);
  
    const qualityValue = document.createElement("span");
    qualityValue.className = "quality-value";
    qualityValue.textContent = String(variant.config.quality);
    qualityWrap.append(qualityValue);
    head.append(qualityWrap);
  
    const gifWrap = document.createElement("label");
    gifWrap.className = "gif-wrap";
    gifWrap.title = "Размер палитры GIF";
    gifWrap.append(document.createTextNode("Цвета"));
  
    const gifColors = document.createElement("input");
    gifColors.className = "small-input";
    gifColors.type = "number";
    gifColors.min = "2";
    gifColors.max = "256";
    gifColors.step = "1";
    gifColors.value = String(variant.config.gifColors);
    gifWrap.append(gifColors);
    head.append(gifWrap);
  
    const ditherLabel = document.createElement("label");
    ditherLabel.className = "switch";
    ditherLabel.title = "Floyd-Steinberg dithering для GIF";
    const gifDither = document.createElement("input");
    gifDither.type = "checkbox";
    gifDither.checked = variant.config.gifDither;
    ditherLabel.append(gifDither, document.createTextNode("Dither"));
    head.append(ditherLabel);
  
    const matteWrap = document.createElement("label");
    matteWrap.className = "matte-wrap";
    matteWrap.title = "Заливка прозрачных областей для форматов без альфа-канала";
    matteWrap.append(document.createTextNode("Альфа"));
  
    const matte = document.createElement("select");
    matte.className = "select";
    matte.innerHTML = `
      <option value="white">Белый</option>
      <option value="black">Черный</option>
      <option value="gray">Серый</option>
      <option value="red">Красный</option>
      <option value="green">Зеленый</option>
      <option value="blue">Синий</option>
    `;
    matte.value = variant.config.matte;
    matteWrap.append(matte);
    head.append(matteWrap);
  
    const apply = document.createElement("button");
    apply.className = "icon-btn";
    apply.type = "button";
    apply.title = "Пересчитать этот вариант";
    apply.setAttribute("aria-label", apply.title);
    apply.innerHTML = `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><use href="#viewer-icon-apply"/></svg>`;
    head.append(apply);
  
    variant.controls = {
      select,
      qualityWrap,
      quality,
      qualityValue,
      gifWrap,
      gifColors,
      ditherLabel,
      gifDither,
      matteWrap,
      matte,
      apply
    };
  
    select.addEventListener("change", () => {
      variant.config.format = select.value;
      deps.syncControlsVisibility(variant);
      deps.markDirty(variant);
    });
  
    quality.addEventListener("input", () => {
      variant.config.quality = Number(quality.value);
      qualityValue.textContent = quality.value;
      deps.markDirty(variant);
    });
  
    gifColors.addEventListener("change", () => {
      const value = deps.clamp(Math.round(Number(gifColors.value) || 256), 2, 256);
      gifColors.value = String(value);
      variant.config.gifColors = value;
      deps.markDirty(variant);
    });
  
    gifDither.addEventListener("change", () => {
      variant.config.gifDither = gifDither.checked;
      deps.markDirty(variant);
    });
  
    matte.addEventListener("change", () => {
      variant.config.matte = matte.value;
      deps.markDirty(variant);
    });
  
    apply.addEventListener("click", () => deps.renderVariant(variant));
  }
  
  function updateFormatOptions() {
    for (const variant of app.variants) {
      const select = variant.controls.select;
      const current = variant.config.format;
      select.innerHTML = "";
  
      for (const key of Object.keys(FORMAT_DEFS)) {
        const def = FORMAT_DEFS[key];
        const option = document.createElement("option");
        option.value = key;
        option.textContent = def.label;
        if (def.codec && !app.codecs[def.codec]) {
          option.disabled = true;
          option.textContent = `${def.label} — кодек не готов`;
        }
        if (key === "webp" && app.support.get("image/webp") === false) {
          option.disabled = true;
          option.textContent = "WebP недоступен";
        }
        select.append(option);
      }
      select.value = current;
  
      deps.syncControlsVisibility(variant);
    }
    if (els.batchDialog.open) { deps.updateBatchDialogFormats(); deps.updateBatchDialog(); }
  }
  
  function syncControlsVisibility(variant) {
    const format = variant.config.format;
    const def = FORMAT_DEFS[format];
    const isQuality = Boolean(def.lossy);
    const isGif = format === "gif" || format === "gifenc";
    const needsMatte = def.alpha === "none";
  
    variant.controls.qualityWrap.style.display = isQuality ? "" : "none";
    variant.controls.gifWrap.style.display = isGif ? "" : "none";
    variant.controls.ditherLabel.style.display = format === "gif" ? "" : "none";
    variant.controls.matteWrap.style.display = needsMatte ? "" : "none";
  }
  
  function buildMetrics(variant) {
    variant.foot.innerHTML = "";
    const defs = [
      ["format", "Формат", ""],
      ["size", "Размер", ""],
      ["ratio", "От исход.", ""],
      ["psnr", "PSNR RGB", "PSNR RGB сравнивает все пиксели исходника и результата на белом фоне с учётом прозрачности, независимо от выбранного фона просмотра. Чем выше значение, тем ближе цвета; ∞ — они совпадают на белом фоне.\n\nАльфа-канал (α) задаёт прозрачность пикселей. Δα — средняя абсолютная разница прозрачности по всем пикселям, от 0% до 100%: 0% — прозрачность совпадает; больше — сильнее различается. Это не процент изменённых пикселей.\n\nПример для одного пикселя: полностью прозрачный и непрозрачный белый дают PSNR = ∞, но Δα = 100%.\n\nПри уменьшении сравнение выполняется с уменьшенным исходником."],
      ["time", "Время", ""]
    ];
  
    variant.metricsEls = {};
    for (const [key, label, title] of defs) {
      const metric = document.createElement("div");
      metric.className = "metric";
      if (title) metric.title = title;
      const labelEl = document.createElement("span");
      labelEl.textContent = label;
      if (title) {
        const help = document.createElement("abbr");
        help.className = "help-dot";
        help.textContent = "?";
        help.title = title;
        help.setAttribute("aria-label", title);
        labelEl.append(help);
      }
      const valueEl = document.createElement("span");
      if (key === "psnr") valueEl.className = "psnr-value";
      if (key === "size") valueEl.className = "size-value";
      valueEl.textContent = "—";
      metric.append(labelEl, valueEl);
      variant.foot.append(metric);
      if (title) {
        labelEl.title = title;
        valueEl.title = title;
      }
      variant.metricsEls[key] = valueEl;
    }
  
    const actions = document.createElement("div");
    actions.className = "foot-actions";
  
    const download = document.createElement("button");
    download.className = "icon-btn";
    download.type = "button";
    download.title = "Скачать вариант";
    download.disabled = !deps.isVariantReady(variant);
    download.setAttribute("aria-label", download.title);
    download.innerHTML = `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><use href="#viewer-icon-download"/></svg>`;
    download.addEventListener("click", () => deps.downloadVariant(variant));
  
    actions.append(download);
    variant.foot.append(actions);
    variant.controls.download = download;
  }
  
  function markDirty(variant) {
    clearTimeout(variant.debounce);
    variant.generation++;
    variant.processing = false;
    variant.dirty = true;
    variant.metrics = null;
    deps.updateMetrics(variant);
    if (els.autoApply.checked && app.source && !variant.cell.classList.contains("hidden")) {
      variant.debounce = setTimeout(() => deps.renderVariant(variant), 320);
    }
  }
  
  function isVariantReady(variant) {
    return Boolean(variant.blob && variant.url && !variant.dirty && !variant.processing &&
      !variant.error && variant.resultConfig && variant.resultSource === app.source);
  }
  
  function updateMetrics(variant) {
    const m = variant.metrics || {};
    const label = deps.outputFormatLabel(variant.config.format);
    variant.metricsEls.format.textContent = variant.dirty ? `${label} *` : (m.format || label);
    variant.metricsEls.size.textContent = m.size || "—";
    variant.metricsEls.ratio.textContent = m.ratio || "—";
    variant.metricsEls.psnr.textContent = (m.psnr || "—") + "\nΔα " + (m.alpha || "—");
    variant.metricsEls.format.title = m.format || label;
    variant.metricsEls.time.textContent = m.time || "—";
    variant.controls.download.disabled = !deps.isVariantReady(variant);
    deps.updateAnalysis();
  }
  
  function alphaLabel(format, imageData) {
    const sourceHasAlpha = app.source && app.source.hasAlpha;
    if (!sourceHasAlpha) return "alpha нет";
    const def = FORMAT_DEFS[format];
    if (def.alpha === "none") return "alpha потерян";
    if (def.alpha === "binary") return "alpha 1-bit";
    if (!imageData) return "alpha";
    return deps.detectAlpha(imageData.data) ? "alpha" : "alpha?";
  }
  
  function updateFormatHelp() {
    const rows=Object.entries(FORMAT_DEFS).filter(([key])=>key!=="original").map(([key,def])=>[def.label,key==="heic"?"Встроенные libheif / libde265":"Через браузер",deps.formatUnavailableReason(key)||("Доступно · "+deps.codecLabel(key))]);
    rows.push(["TIFF","Встроенные UTIF / libjpeg-turbo, одна страница","Нет"]);
    document.getElementById("formatHelp").replaceChildren(...rows.map(row=>{const tr=document.createElement("tr");for(const text of row){const td=document.createElement("td");td.textContent=text;tr.append(td);}return tr;}));
  }

  return { setEmptyState, observeCanvasSizes, buildCellControls, updateFormatOptions, syncControlsVisibility, buildMetrics, markDirty, isVariantReady, updateMetrics, alphaLabel, updateFormatHelp };
}
