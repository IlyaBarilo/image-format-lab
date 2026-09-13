import { FORMAT_DEFS } from "./../core/config.mjs";
import { normalizeTiffOptions } from "./../core/raster-codecs.mjs";
import { FORMAT_OPTIONS, isBmpFormat, formatOptionValue, formatFromOption } from "./../core/format-options.mjs";

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

    const bmpDepthWrap = document.createElement("label");
    bmpDepthWrap.className = "bmp-depth-wrap";
    bmpDepthWrap.hidden = !isBmpFormat(variant.config.format);
    bmpDepthWrap.title = "BMP без сжатия: 24 бита — цвет с заливкой прозрачности; 32 бита — цвет и альфа-канал.";
    const bmpDepth = document.createElement("select");
    bmpDepth.className = "select bmp-depth";
    for (const [value, label] of [["24", "24 бита · RGB"], ["32", "32 бита · RGBA"]]) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      bmpDepth.append(option);
    }
    bmpDepth.value = variant.config.format === "bmp32" ? "32" : "24";
    bmpDepthWrap.append(document.createTextNode("Разрядность"), bmpDepth);
    head.append(bmpDepthWrap);
  
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
  
    const tiffOptions = normalizeTiffOptions(variant.config);
    const tiffCompressionWrap = document.createElement("label");
    tiffCompressionWrap.className = "tiff-compression-wrap";
    tiffCompressionWrap.hidden = variant.config.format !== "tiff";
    tiffCompressionWrap.title = "Сжатие TIFF без потерь";
    const tiffCompression = document.createElement("select");
    tiffCompression.className = "select tiff-compression";
    for (const [value, label] of [["none", "Без сжатия"], ["deflate", "Deflate"], ["lzw", "LZW"]]) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      tiffCompression.append(option);
    }
    tiffCompression.value = tiffOptions.tiffCompression;
    tiffCompressionWrap.append(document.createTextNode("Сжатие"), tiffCompression);

    const tiffLevelWrap = document.createElement("label");
    tiffLevelWrap.className = "quality-wrap tiff-level-wrap";
    tiffLevelWrap.hidden = variant.config.format !== "tiff" || tiffOptions.tiffCompression !== "deflate";
    tiffLevelWrap.title = "Уровень Deflate: 1–9. Влияет на размер файла и время обработки; пиксели сохраняются без потерь.";
    const tiffLevel = document.createElement("input");
    tiffLevel.className = "tiff-level";
    tiffLevel.type = "range";
    tiffLevel.min = "1";
    tiffLevel.max = "9";
    tiffLevel.step = "1";
    tiffLevel.value = String(tiffOptions.tiffLevel);
    tiffLevel.setAttribute("aria-label", "Уровень Deflate");
    const tiffLevelValue = document.createElement("span");
    tiffLevelValue.className = "quality-value tiff-level-value";
    tiffLevelValue.textContent = tiffLevel.value;
    tiffLevelWrap.append(document.createTextNode("Уровень"), tiffLevel, tiffLevelValue);

    const tiffPredictorWrap = document.createElement("label");
    tiffPredictorWrap.className = "switch tiff-predictor-wrap";
    tiffPredictorWrap.hidden = variant.config.format !== "tiff" || tiffOptions.tiffCompression === "none";
    tiffPredictorWrap.title = "Предиктор по соседним пикселям для Deflate и LZW: может уменьшить файл без изменения пикселей.";
    const tiffPredictor = document.createElement("input");
    tiffPredictor.className = "tiff-predictor";
    tiffPredictor.type = "checkbox";
    tiffPredictor.checked = tiffOptions.tiffPredictor;
    tiffPredictorWrap.append(tiffPredictor, document.createTextNode("Предиктор"));
    head.append(tiffCompressionWrap, tiffLevelWrap, tiffPredictorWrap);
    variant.controls = {
      bmpDepthWrap,
      bmpDepth,
      tiffCompressionWrap,
      tiffCompression,
      tiffLevelWrap,
      tiffLevel,
      tiffLevelValue,
      tiffPredictorWrap,
      tiffPredictor,
      select,
      qualityWrap,
      quality,
      qualityValue,
      gifWrap,
      gifColors,
      ditherLabel,
      gifDither,
      matteWrap,
      matte
    };

    function updateTiffSettings() {
      Object.assign(variant.config, normalizeTiffOptions({tiffCompression: tiffCompression.value,
        tiffLevel: Number(tiffLevel.value), tiffPredictor: tiffPredictor.checked}));
      deps.syncControlsVisibility(variant);
      deps.markDirty(variant);
    }
    tiffCompression.addEventListener("change", updateTiffSettings);
    tiffLevel.addEventListener("input", updateTiffSettings);
    tiffPredictor.addEventListener("change", updateTiffSettings);
  
    select.addEventListener("change", () => {
      variant.config.format = formatFromOption(select.value, bmpDepth.value);
      deps.syncControlsVisibility(variant);
      deps.markDirty(variant);
    });

    bmpDepth.addEventListener("change", () => {
      if (!isBmpFormat(variant.config.format)) return;
      variant.config.format = formatFromOption("bmp", bmpDepth.value);
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
  
  }
  
  function updateFormatOptions() {
    for (const variant of app.variants) {
      const select = variant.controls.select;
      const current = variant.config.format;
      select.innerHTML = "";
  
      for (const {format: key, value, label} of FORMAT_OPTIONS) {
        const def = FORMAT_DEFS[key];
        const option = document.createElement("option");
        option.value = value;
        option.textContent = label;
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
      select.value = formatOptionValue(current);
  
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

    if (variant.controls.bmpDepthWrap) {
      variant.controls.bmpDepthWrap.hidden = !isBmpFormat(format);
      if (isBmpFormat(format)) variant.controls.bmpDepth.value = format === "bmp32" ? "32" : "24";
      variant.controls.select.value = formatOptionValue(format);
    }
  
    if (variant.controls.tiffCompressionWrap) {
      const options = normalizeTiffOptions(variant.config);
      variant.controls.tiffCompressionWrap.hidden = format !== "tiff";
      variant.controls.tiffLevelWrap.hidden = format !== "tiff" || options.tiffCompression !== "deflate";
      variant.controls.tiffPredictorWrap.hidden = format !== "tiff" || options.tiffCompression === "none";
      variant.controls.tiffCompression.value = options.tiffCompression;
      variant.controls.tiffLevel.value = String(options.tiffLevel);
      variant.controls.tiffLevelValue.textContent = String(options.tiffLevel);
      variant.controls.tiffPredictor.checked = options.tiffPredictor;
    }
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
  
  function markDirty(variant, { schedule = true } = {}) {
    clearTimeout(variant.debounce);
    variant.generation++;
    variant.processing = false;
    variant.dirty = true;
    variant.metrics = null;
    deps.updateMetrics(variant);
    if (schedule && app.source && !variant.cell.classList.contains("hidden")) {
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
    const webpRead = "Браузер; при отказе — встроенный libwebp";
    const read = {
      original: "По правилам формата исходника",
      webp: webpRead, webpLossless: webpRead,
      heic: "Браузер; при отказе — libheif / libde265, основное изображение HEVC",
      avif: "Встроенные libheif / libaom",
      jxl: "Встроенный libjxl", jxlLossless: "Встроенный libjxl",
      bmp24: "Встроенный libnsbmp: палитры, RGB, RLE4/8 и битовые маски в пределах поддержки",
      tiff: "Встроенные libtiff / UTIF / libjpeg-turbo; TIFF/BigTIFF, первая страница",
      ico: "Наибольший PNG внутри ICO — браузер; BMP внутри ICO — встроенный libnsbmp"
    };
    const write = {
      original: "Исходные байты без перекодирования; все метаданные сохраняются",
      jpeg: "Браузер; качество 1–100, с потерями; прозрачность заменяется заливкой",
      png: "Браузер; без потерь, полная прозрачность",
      pngUpng: "Встроенные UPNG / pako; без потерь, полная прозрачность",
      webp: "Браузер; качество 1–100, с потерями; поддерживает прозрачность",
      webpLossless: "Встроенный libwebp; без потерь, полная прозрачность",
      avif: "Встроенные libheif / libaom; качество 1–100, поддерживает прозрачность",
      jxl: "Встроенный libjxl; качество 1–100, поддерживает прозрачность",
      jxlLossless: "Встроенный libjxl; без потерь, полная прозрачность",
      tiff: "Встроенный libtiff; RGBA8 без потерь: без сжатия, Deflate или LZW; уровень Deflate 1–9 и предиктор",
      ico: "7 PNG-размеров: 16, 24, 32, 48, 64, 128, 256 px; пропорции сохраняются, поля прозрачные; маленький исходник не растягивается",
      heic: "Встроенные libheif / Kvazaar; HEVC, SDR 8 бит, 4:2:0; качество 1–100, даже 100 не lossless; прозрачность может сжиматься с потерями",
      gif: "Собственный кодировщик; один кадр, 2–256 цветов, переключаемый дизеринг, двоичная прозрачность",
      gifenc: "Встроенный gifenc; один кадр, 2–256 цветов, без дизеринга, двоичная прозрачность",
      bmp24: "Собственный кодировщик; без сжатия, выбор 24 бит RGB с заливкой или 32 бит RGBA с прозрачностью"
    };
    const rows = FORMAT_OPTIONS.map(({format, label}) => {
      const unavailable = format === "original" ? "" : deps.formatUnavailableReason(format);
      return [label, read[format] || "Через браузер", (unavailable ? unavailable + " · " : "") + write[format]];
    });
    document.getElementById("formatHelp").replaceChildren(...rows.map(row=>{const tr=document.createElement("tr");for(const text of row){const td=document.createElement("td");td.textContent=text;tr.append(td);}return tr;}));
  }

  return { setEmptyState, observeCanvasSizes, buildCellControls, updateFormatOptions, syncControlsVisibility, buildMetrics, markDirty, isVariantReady, updateMetrics, alphaLabel, updateFormatHelp };
}
