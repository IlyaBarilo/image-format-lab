import { FORMAT_DEFS } from "./../core/config.mjs";
import { normalizeTiffOptions } from "./../core/raster-codecs.mjs";
import { normalizeJpegOptions } from './../core/jpeg-encode.mjs';
import { normalizeModernOptions } from '../core/modern-options.mjs';
import { normalizeAvifOptions } from '../core/avif-options.mjs';
import { FORMAT_OPTIONS, isBmpFormat, isPngFormat, formatOptionValue, formatFromOption } from "./../core/format-options.mjs";

// Dependencies are bound by application.mjs after all components are constructed.
export function createControls({els, app}, deps) {
  let headSizeObserver;

  function syncCellHeadSizes() {
    let size = 52;
    for (const variant of app.variants) {
      if (variant.cell.classList.contains("hidden") || !variant.headContent) continue;
      const style = getComputedStyle(variant.head);
      size = Math.max(size, Math.ceil(variant.headContent.getBoundingClientRect().height +
        parseFloat(style.paddingTop) + parseFloat(style.paddingBottom) + parseFloat(style.borderBottomWidth)));
    }
    const value = `${size}px`;
    if (els.grid.style.getPropertyValue("--cell-head-size") !== value) {
      els.grid.style.setProperty("--cell-head-size", value);
    }
  }

  function setEmptyState(title, message) {
    els.emptyTitle.textContent = title;
    els.emptyMessage.textContent = message;
    els.emptyState.style.display = "";
  }
  
  function observeCanvasSizes() {
    if (!("ResizeObserver" in window)) {
      syncCellHeadSizes();
      deps.resizeCanvases();
      return;
    }

    headSizeObserver = new ResizeObserver(syncCellHeadSizes);
    for (const variant of app.variants) headSizeObserver.observe(variant.headContent);
    syncCellHeadSizes();
  
    const observer = new ResizeObserver(() => {
      deps.resizeCanvases();
      deps.drawAll();
    });
  
    for (const variant of app.variants) {
      observer.observe(variant.canvas.parentElement);
    }
    if(els.wipeOverlay)observer.observe(els.wipeOverlay);
  }
  
  function buildCellControls(variant) {
    const head = variant.head;
    if (headSizeObserver && variant.headContent) headSizeObserver.unobserve(variant.headContent);
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
    bmpDepthWrap.title = "BMP 8 бит — палитра; 24 бита — RGB с заливкой прозрачности; 32 бита — RGBA.";
    const bmpDepth = document.createElement("select");
    bmpDepth.className = "select bmp-depth";
    for (const [value, label] of [["8", "8 бит · палитра"], ["24", "24 бита · RGB"], ["32", "32 бита · RGBA"]]) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      bmpDepth.append(option);
    }
    bmpDepth.value = variant.config.format === 'bmp8' ? '8' : variant.config.format === "bmp32" ? "32" : "24";
    bmpDepthWrap.append(document.createTextNode("Разрядность"), bmpDepth);
    head.append(bmpDepthWrap);
    const bmpColorsWrap = document.createElement('label');
    bmpColorsWrap.className = 'bmp-colors-wrap';
    bmpColorsWrap.hidden = variant.config.format !== 'bmp8';
    bmpColorsWrap.title = 'Максимальное число цветов палитры BMP: 2–256.';
    const bmpColors = document.createElement('input');
    bmpColors.className = 'small-input bmp-colors';
    bmpColors.type = 'number'; bmpColors.min = '2'; bmpColors.max = '256'; bmpColors.step = '1';
    bmpColors.value = String(variant.config.bmpColors ?? 256);
    bmpColorsWrap.append(document.createTextNode('Цвета'), bmpColors);
    const bmpCompressionWrap = document.createElement('label');
    bmpCompressionWrap.className = 'bmp-compression-wrap';
    bmpCompressionWrap.hidden = variant.config.format !== 'bmp8';
    bmpCompressionWrap.title = 'RLE8 сжимает последовательности одинаковых индексов палитры без дополнительных потерь.';
    const bmpCompression = document.createElement('select');
    bmpCompression.className = 'select bmp-compression';
    for (const [value,label] of [['none','Без сжатия'],['rle8','RLE8']]) {
      const option=document.createElement('option');option.value=value;option.textContent=label;bmpCompression.append(option);
    }
    bmpCompression.value = variant.config.bmpCompression || 'none';
    bmpCompressionWrap.append(document.createTextNode('Сжатие'), bmpCompression);
    head.append(bmpColorsWrap, bmpCompressionWrap);
    const pngModeWrap=document.createElement('label');pngModeWrap.className='png-mode-wrap';
    pngModeWrap.title='Полные цвета сохраняют RGBA8/16; палитра ограничивает число цветов и прозрачность; PNG opt использует UPNG для RGBA8.';
    const pngMode=document.createElement('select');pngMode.className='select png-mode';
    for(const [value,label] of [['rgba','Полные цвета'],['palette','Палитра'],['optimized','PNG opt']]){
      const option=document.createElement('option');option.value=value;option.textContent=label;pngMode.append(option);
    }
    pngMode.value=variant.config.format==='pngIndexed'?'palette':variant.config.format==='pngUpng'?'optimized':'rgba';
    pngModeWrap.append(document.createTextNode('Режим'),pngMode);head.append(pngModeWrap);
    const pngDepthWrap=document.createElement('label');
    pngDepthWrap.className='png-depth-wrap';
    pngDepthWrap.hidden=variant.config.format!=='png';
    pngDepthWrap.title='Авто сохраняет разрядность рабочих пикселей. PNG16 — только исходные размеры; показ на экране остаётся 8-битным. Перевод 8 → 16 не восстанавливает детали.';
    const pngDepth=document.createElement('select');pngDepth.className='select png-depth';
    for(const [value,label] of [['auto','Авто'],['8','8 бит/канал'],['16','16 бит/канал']]){
      const option=document.createElement('option');option.value=value;option.textContent=label;pngDepth.append(option);
    }
    pngDepth.value=variant.config.pngDepth || 'auto';
    pngDepthWrap.append(document.createTextNode('Разрядность'),pngDepth);head.append(pngDepthWrap);
    pngDepth.addEventListener('change',()=>{variant.config.pngDepth=pngDepth.value;deps.markDirty(variant);});
    const pngFilterWrap=document.createElement('label');
    pngFilterWrap.className='png-filter-wrap';
    pngFilterWrap.title='Фильтр PNG меняет подготовку строк перед Deflate, но не пиксели. «Как обычно» сохраняет прежний путь кодирования.';
    const pngFilter=document.createElement('select');pngFilter.className='select png-filter';
    for(const [value,label] of [['default','Как обычно'],['adaptive','Адаптивный'],['none','None'],['sub','Sub'],['up','Up'],['average','Average'],['paeth','Paeth']]){
      const option=document.createElement('option');option.value=value;option.textContent=label;pngFilter.append(option);
    }
    pngFilter.value=variant.config.pngFilter||'default';
    pngFilterWrap.append(document.createTextNode('Фильтр'),pngFilter);
    const pngLevelWrap=document.createElement('label');pngLevelWrap.className='quality-wrap png-level-wrap';
    pngLevelWrap.title='Уровень Deflate 1–9: влияет на размер и время обработки без потерь пикселей.';
    const pngLevel=document.createElement('input');pngLevel.className='png-level';pngLevel.type='range';pngLevel.min='1';pngLevel.max='9';pngLevel.value=String(variant.config.pngLevel??6);
    const pngLevelValue=document.createElement('span');pngLevelValue.className='quality-value';pngLevelValue.textContent=pngLevel.value;
    pngLevelWrap.append(document.createTextNode('Уровень'),pngLevel,pngLevelValue);
    head.append(pngFilterWrap,pngLevelWrap);
    pngFilter.addEventListener('change',()=>{variant.config.pngFilter=pngFilter.value;deps.syncControlsVisibility(variant);deps.markDirty(variant);});
    pngLevel.addEventListener('input',()=>{variant.config.pngLevel=Number(pngLevel.value);pngLevelValue.textContent=pngLevel.value;deps.markDirty(variant);});
  
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
    gifWrap.title = "Максимальное число цветов палитры GIF или PNG";
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
    ditherLabel.title = "Дизеринг Флойда — Стейнберга для GIF или PNG с палитрой";
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

    const jpegOptions=normalizeJpegOptions(variant.config);
    const jpegSubsamplingWrap=document.createElement('label');
    jpegSubsamplingWrap.className='jpeg-subsampling-wrap';
    jpegSubsamplingWrap.hidden=variant.config.format!=='jpeg';
    jpegSubsamplingWrap.title='Субдискретизация цветности JPEG. 4:4:4 сохраняет полное разрешение цветовых каналов, но JPEG остаётся с потерями.';
    const jpegSubsampling=document.createElement('select');
    jpegSubsampling.className='select jpeg-subsampling';
    for(const [value,label] of [['420','4:2:0'],['422','4:2:2'],['444','4:4:4']]){
      const option=document.createElement('option');option.value=value;option.textContent=label;jpegSubsampling.append(option);
    }
    jpegSubsampling.value=jpegOptions.jpegSubsampling;
    jpegSubsamplingWrap.append(document.createTextNode('Цветность'),jpegSubsampling);
    const jpegProgressiveWrap=document.createElement('label');
    jpegProgressiveWrap.className='switch jpeg-progressive-wrap';
    jpegProgressiveWrap.hidden=variant.config.format!=='jpeg';
    jpegProgressiveWrap.title='Прогрессивная организация JPEG: изображение уточняется за несколько проходов при загрузке.';
    const jpegProgressive=document.createElement('input');
    jpegProgressive.type='checkbox';jpegProgressive.className='jpeg-progressive';
    jpegProgressive.checked=jpegOptions.jpegProgressive;
    jpegProgressiveWrap.append(jpegProgressive,document.createTextNode('Прогр.'));
    head.append(jpegSubsamplingWrap,jpegProgressiveWrap);

    const modernEffortWrap=document.createElement('label');
    modernEffortWrap.className='quality-wrap modern-effort-wrap';
    const modernEffort=document.createElement('input');
    modernEffort.className='modern-effort';modernEffort.type='range';modernEffort.step='1';
    const modernEffortValue=document.createElement('span');
    modernEffortValue.className='quality-value modern-effort-value';
    modernEffortWrap.append(document.createTextNode('Усилие'),modernEffort,modernEffortValue);
    head.append(modernEffortWrap);

    const avifSpeedWrap=document.createElement('label');
    avifSpeedWrap.className='quality-wrap avif-speed-wrap';
    avifSpeedWrap.title='Скорость AVIF 0–9: большее значение кодирует быстрее, но может увеличить файл или изменить результат. Ноль может работать очень долго. Качество задаётся отдельно.';
    const avifSpeed=document.createElement('input');
    avifSpeed.className='avif-speed';avifSpeed.type='range';avifSpeed.min='0';avifSpeed.max='9';avifSpeed.step='1';
    avifSpeed.setAttribute('aria-label','Скорость AVIF');
    const avifSpeedValue=document.createElement('span');
    avifSpeedValue.className='quality-value avif-speed-value';
    avifSpeedWrap.append(document.createTextNode('Скорость'),avifSpeed,avifSpeedValue);
    head.append(avifSpeedWrap);
  
    const tiffOptions = normalizeTiffOptions(variant.config);
    const tiffCompressionWrap = document.createElement("label");
    tiffCompressionWrap.className = "tiff-compression-wrap";
    tiffCompressionWrap.hidden = variant.config.format !== "tiff";
    tiffCompressionWrap.title = "Сжатие TIFF без потерь";
    const tiffCompression = document.createElement("select");
    tiffCompression.className = "select tiff-compression";
    for (const [value, label] of [["none", "Без сжатия"], ["deflate", "Deflate"], ["lzw", "LZW"], ["packbits", "PackBits"]]) {
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
    tiffPredictorWrap.hidden = variant.config.format !== "tiff" || !["deflate","lzw"].includes(tiffOptions.tiffCompression);
    tiffPredictorWrap.title = "Предиктор по соседним пикселям для Deflate и LZW: может уменьшить файл без изменения пикселей.";
    const tiffPredictor = document.createElement("input");
    tiffPredictor.className = "tiff-predictor";
    tiffPredictor.type = "checkbox";
    tiffPredictor.checked = tiffOptions.tiffPredictor;
    tiffPredictorWrap.append(tiffPredictor, document.createTextNode("Предиктор"));
    head.append(tiffCompressionWrap, tiffLevelWrap, tiffPredictorWrap);
    const content = document.createElement("div");
    content.className = "cell-head-content";
    content.append(...head.childNodes);
    head.append(content);
    variant.headContent = content;
    if (headSizeObserver) headSizeObserver.observe(content);
    variant.controls = {
      pngModeWrap,
      pngMode,
      pngDepthWrap,
      pngDepth,
      pngFilterWrap,
      pngFilter,
      pngLevelWrap,
      pngLevel,
      pngLevelValue,
      bmpDepthWrap,
      bmpDepth,
      bmpColorsWrap,
      bmpColors,
      bmpCompressionWrap,
      bmpCompression,
      tiffCompressionWrap,
      tiffCompression,
      tiffLevelWrap,
      tiffLevel,
      tiffLevelValue,
      tiffPredictorWrap,
      tiffPredictor,
      jpegSubsamplingWrap,
      jpegSubsampling,
      jpegProgressiveWrap,
      jpegProgressive,
      modernEffortWrap,
      modernEffort,
      modernEffortValue,
      avifSpeedWrap,
      avifSpeed,
      avifSpeedValue,
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
    jpegSubsampling.addEventListener('change',()=>{
      variant.config.jpegSubsampling=jpegSubsampling.value;
      deps.markDirty(variant);
    });
    jpegProgressive.addEventListener('change',()=>{
      variant.config.jpegProgressive=jpegProgressive.checked;
      deps.markDirty(variant);
    });
    modernEffort.addEventListener('input',()=>{
      const key=variant.config.format==='webpLossless'?'webpMethod':'jxlEffort';
      variant.config[key]=Number(modernEffort.value);
      modernEffortValue.textContent=modernEffort.value;
      deps.markDirty(variant);
    });
    avifSpeed.addEventListener('input',()=>{
      variant.config.avifSpeed=Number(avifSpeed.value);
      avifSpeedValue.textContent=avifSpeed.value;
      deps.markDirty(variant);
    });
  
    select.addEventListener("change", () => {
      variant.config.format = formatFromOption(select.value, bmpDepth.value, pngMode.value);
      deps.syncControlsVisibility(variant);
      deps.markDirty(variant);
    });

    bmpDepth.addEventListener("change", () => {
      if (!isBmpFormat(variant.config.format)) return;
      variant.config.format = formatFromOption("bmp", bmpDepth.value);
      deps.syncControlsVisibility(variant);
      deps.markDirty(variant);
    });
    pngMode.addEventListener('change',()=>{
      if(select.value!=='png')return;
      variant.config.format=formatFromOption('png',bmpDepth.value,pngMode.value);
      deps.syncControlsVisibility(variant);
      deps.markDirty(variant);
    });
    bmpColors.addEventListener('change', () => {
      const value = deps.clamp(Math.round(Number(bmpColors.value) || 256), 2, 256);
      bmpColors.value = String(value);
      variant.config.bmpColors = value;
      deps.markDirty(variant);
    });
    bmpCompression.addEventListener('change', () => {
      variant.config.bmpCompression = bmpCompression.value;
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
    const isGif = format === "gif" || format === "gifenc" || format === "pngIndexed";
    const needsMatte = def.alpha === "none";

    if (variant.controls.bmpDepthWrap) {
      variant.controls.bmpDepthWrap.hidden = !isBmpFormat(format);
      if (isBmpFormat(format)) variant.controls.bmpDepth.value = format === 'bmp8' ? '8' : format === "bmp32" ? "32" : "24";
      variant.controls.select.value = formatOptionValue(format);
    }
    if(variant.controls.pngModeWrap){variant.controls.pngModeWrap.hidden=!isPngFormat(format);variant.controls.pngMode.value=format==='pngIndexed'?'palette':format==='pngUpng'?'optimized':'rgba';}
    if (variant.controls.bmpColorsWrap) {
      variant.controls.bmpColorsWrap.hidden = format !== 'bmp8';
      variant.controls.bmpCompressionWrap.hidden = format !== 'bmp8';
      variant.controls.bmpColors.value = String(variant.config.bmpColors ?? 256);
      variant.controls.bmpCompression.value = variant.config.bmpCompression || 'none';
    }
    if(variant.controls.pngDepthWrap){variant.controls.pngDepthWrap.hidden=format!=='png';variant.controls.pngDepth.value=variant.config.pngDepth || 'auto';}
    if(variant.controls.pngFilterWrap){
      const png=format==='png'||format==='pngIndexed';
      variant.controls.pngFilterWrap.hidden=!png;
      variant.controls.pngFilter.value=variant.config.pngFilter||'default';
      variant.controls.pngLevelWrap.hidden=!png||variant.controls.pngFilter.value==='default';
      variant.controls.pngLevel.value=String(variant.config.pngLevel??6);
      variant.controls.pngLevelValue.textContent=variant.controls.pngLevel.value;
    }
    if(variant.controls.jpegSubsamplingWrap){
      const options=normalizeJpegOptions(variant.config);
      variant.controls.jpegSubsamplingWrap.hidden=format!=='jpeg';
      variant.controls.jpegProgressiveWrap.hidden=format!=='jpeg';
      variant.controls.jpegSubsampling.value=options.jpegSubsampling;
      variant.controls.jpegProgressive.checked=options.jpegProgressive;
    }
    if(variant.controls.modernEffortWrap){
      const webp=format==='webpLossless',jxl=format==='jxl'||format==='jxlLossless';
      const options=normalizeModernOptions(variant.config);
      variant.controls.modernEffortWrap.hidden=!webp&&!jxl;
      variant.controls.modernEffortWrap.title=webp?'Метод WebP 0–6: большее значение обычно сжимает дольше; пиксели сохраняются без потерь.'
        :'Усилие JPEG XL 1–10: большее значение обычно сжимает дольше; максимум может работать очень медленно. Качество задаётся отдельно.';
      variant.controls.modernEffort.min=webp?'0':'1';
      variant.controls.modernEffort.max=webp?'6':'10';
      variant.controls.modernEffort.setAttribute('aria-label',webp?'Метод WebP lossless':'Усилие JPEG XL');
      variant.controls.modernEffort.value=String(webp?options.webpMethod:options.jxlEffort);
      variant.controls.modernEffortValue.textContent=variant.controls.modernEffort.value;
    }
    if(variant.controls.avifSpeedWrap){
      variant.controls.avifSpeedWrap.hidden=format!=='avif';
      variant.controls.avifSpeed.value=String(normalizeAvifOptions(variant.config).avifSpeed);
      variant.controls.avifSpeedValue.textContent=variant.controls.avifSpeed.value;
    }
  
    if (variant.controls.tiffCompressionWrap) {
      const options = normalizeTiffOptions(variant.config);
      variant.controls.tiffCompressionWrap.hidden = format !== "tiff";
      variant.controls.tiffLevelWrap.hidden = format !== "tiff" || options.tiffCompression !== "deflate";
      variant.controls.tiffPredictorWrap.hidden = format !== "tiff" || !["deflate","lzw"].includes(options.tiffCompression);
      variant.controls.tiffCompression.value = options.tiffCompression;
      variant.controls.tiffLevel.value = String(options.tiffLevel);
      variant.controls.tiffLevelValue.textContent = String(options.tiffLevel);
      variant.controls.tiffPredictor.checked = options.tiffPredictor;
    }
    variant.controls.qualityWrap.style.display = isQuality ? "" : "none";
    variant.controls.gifWrap.style.display = isGif ? "" : "none";
    variant.controls.ditherLabel.style.display = format === "gif" || format === "pngIndexed" ? "" : "none";
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
      const labelEl = document.createElement(key === "format" ? "button" : "span");
      labelEl.textContent = label;
      if (key === "format") {
        labelEl.type = 'button'; labelEl.className = 'file-info-open'; labelEl.textContent = 'Формат ⓘ';
        labelEl.title = 'О файле: свойства исходника и результата';
        labelEl.setAttribute('aria-label', `О файле ячейки ${variant.index + 1}`);
        labelEl.setAttribute('aria-haspopup', 'dialog'); labelEl.setAttribute('aria-controls', 'filePassportDialog');
        labelEl.disabled = !app.source;
        labelEl.addEventListener('click', () => deps.openFilePassport(variant));
        variant.controls.fileInfo = labelEl;
      }
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
    deps.updatePixelInspector?.({ redraw: true });
    if (variant.controls.fileInfo) variant.controls.fileInfo.disabled = !app.source;
    deps.updateFilePassport?.();
  }
  
  function alphaLabel(format, imageData, pixelBuffer) {
    const sourceHasAlpha = app.source && app.source.hasAlpha;
    if (!sourceHasAlpha) return "alpha нет";
    const def = FORMAT_DEFS[format];
    if (def.alpha === "none") return "alpha потерян";
    if (def.alpha === "binary") return "alpha 1-bit";
    if(pixelBuffer?.bitDepth>8)return pixelBuffer.data.some((n,i)=>i%4===3&&n!==2**pixelBuffer.bitDepth-1)?'alpha':'alpha?';
    if (!imageData) return "alpha";
    return deps.detectAlpha(imageData.data) ? "alpha" : "alpha?";
  }
  
  function updateFormatHelp() {
    const webpRead = "Браузер; при отказе — встроенный libwebp";
    const read = {
      png: "PNG16: точные серые/RGB/RGBA, Adam7, sRGB или без цветовых блоков; до 12 Мп / 128 МиБ. PNG8, палитровый PNG и PNG opt — браузер",
      original: "По правилам формата исходника",
      webp: webpRead, webpLossless: webpRead,
      heic: "Браузер; при отказе — libheif / libde265, основное изображение HEVC",
      avif: "Встроенные libheif / libaom",
      jxl: "Встроенный libjxl", jxlLossless: "Встроенный libjxl",
      bmp8: "Встроенный libnsbmp: палитры, RGB, RLE4/8 и битовые маски в пределах поддержки",
      tiff: "Встроенные libtiff / UTIF / libjpeg-turbo; TIFF/BigTIFF, первая страница",
      ico: "Наибольший PNG внутри ICO — браузер; BMP внутри ICO — встроенный libnsbmp"
    };
    const write = {
      original: "Исходные байты без перекодирования; все метаданные сохраняются",
      jpeg: "Встроенный libjpeg-turbo; качество 1–100, 4:4:4 / 4:2:2 / 4:2:0, обычный или прогрессивный JPEG; прозрачность заменяется заливкой",
      png: "Полные цвета: Авто / 8 / 16 бит на канал, точный PNG до 12 Мп; обычный PNG8 — браузер. Палитра: 2–256 цветов, дизеринг, двоичная прозрачность. PNG opt: UPNG / pako, 8 бит/канал",
      webp: "Браузер; качество 1–100, с потерями; поддерживает прозрачность",
      webpLossless: "Встроенный libwebp; без потерь, полная прозрачность; метод 0–6 меняет усилие сжатия",
      avif: "Встроенные libheif / libaom; качество 1–100 и скорость 0–9, поддерживает прозрачность",
      jxl: "Встроенный libjxl; качество 1–100, усилие 1–10, поддерживает прозрачность",
      jxlLossless: "Встроенный libjxl; без потерь, полная прозрачность; усилие 1–10",
      tiff: "Встроенный libtiff; RGBA8 без потерь: без сжатия, Deflate или LZW; уровень Deflate 1–9 и предиктор",
      ico: "7 PNG-размеров: 16, 24, 32, 48, 64, 128, 256 px; пропорции сохраняются, поля прозрачные; маленький исходник не растягивается",
      heic: "Встроенные libheif / Kvazaar; HEVC, SDR 8 бит, 4:2:0; качество 1–100, даже 100 не lossless; прозрачность может сжиматься с потерями",
      gif: "Собственный кодировщик; один кадр, 2–256 цветов, переключаемый дизеринг, двоичная прозрачность",
      gifenc: "Встроенный gifenc; один кадр, 2–256 цветов, без дизеринга, двоичная прозрачность",
      bmp8: "Собственный кодировщик; выбор 8 бит с палитрой до 256 цветов и сжатием RLE8, 24 бит RGB с заливкой или 32 бит RGBA с прозрачностью"
    };
    const rows = FORMAT_OPTIONS.map(({format, label}) => {
      const unavailable = format === "original" ? "" : deps.formatUnavailableReason(format);
      return [label, read[format] || "Через браузер", (unavailable ? unavailable + " · " : "") + write[format]];
    });
    document.getElementById("formatHelp").replaceChildren(...rows.map(row=>{const tr=document.createElement("tr");for(const text of row){const td=document.createElement("td");td.textContent=text;tr.append(td);}return tr;}));
  }

  return { setEmptyState, observeCanvasSizes, syncCellHeadSizes, buildCellControls, updateFormatOptions, syncControlsVisibility, buildMetrics, markDirty, isVariantReady, updateMetrics, alphaLabel, updateFormatHelp };
}
