export function createFilePassport({ app }, deps) {
  const get = id => document.getElementById(id);
  const dialog = get('filePassportDialog'), select = get('filePassportTarget');
  const fileFields = get('filePassportFields'), rasterFields = get('filePassportRaster'), status = get('filePassportStatus');
  const paletteSection=get('filePassportPaletteSection'),paletteGrid=get('filePassportPalette');
  const cache = new WeakMap();
  let target = 'source', attached = false, request = 0, controller = null, current = null, optionsKey = '';
  const same = (a, b) => a && b && a.source === b.source && a.sourceGeneration === b.sourceGeneration && a.blob === b.blob && a.pixels === b.pixels && a.generation === b.generation && a.target === b.target && a.message === b.message;
  const number = value => value.toLocaleString('ru-RU', { maximumFractionDigits: 6 });

  function selected() {
    const source = app.source;
    if (!source) return { target, source: null, message: 'Откройте изображение.' };
    const common = { target, source, sourceGeneration: app.sourceGeneration };
    if (target === 'source') return { ...common, blob: source.file, pixels: source.pixelBuffer, label: source.name };
    const variant = app.variants[Number(target)];
    if (!variant || !deps.isVariantReady(variant)) return { ...common, generation: variant?.generation,
      message: variant?.error ? 'Ошибка обработки. Паспорт результата недоступен.' : 'Дождитесь пересчёта результата.' };
    return { ...common, blob: variant.blob, pixels: variant.pixelBuffer, paletteInfo:variant.paletteInfo, generation: variant.generation,
      label: variant.resultConfig.format === 'original' ? source.name : `Ячейка ${variant.index + 1} · ${deps.outputFormatLabel(variant.resultConfig.format)}` };
  }
  function fields(element, pairs) {
    const nodes = [];
    for (const [label, value] of pairs) {
      const dt = document.createElement('dt'), dd = document.createElement('dd');
      dt.textContent = label; dd.textContent = value; nodes.push(dt, dd);
    }
    element.replaceChildren(...nodes);
  }
  function showPalette(palette){
    const entries=palette?.entries;
    paletteSection.hidden=!Array.isArray(entries)||!entries.length;
    paletteGrid.replaceChildren();
    if(paletteSection.hidden)return;
    const fragment=document.createDocumentFragment();
    for(const entry of entries){
      const item=document.createElement('div');item.className='passport-palette-entry';
      const swatch=document.createElement('span');swatch.className='passport-palette-swatch';
      swatch.style.backgroundColor=entry.alpha===0?'transparent':`rgb(${entry.r}, ${entry.g}, ${entry.b})`;
      if(entry.alpha!==0)swatch.style.backgroundImage='none';
      const hex=[entry.r,entry.g,entry.b].map(n=>n.toString(16).padStart(2,'0').toUpperCase()).join('');
      const label=document.createElement('span');label.textContent=`${entry.index}: #${hex}${entry.alpha===0?' · прозрачно':''}`;
      const count=document.createElement('span');count.textContent=`${number(entry.pixels)} px`;
      item.append(swatch,label,count);fragment.append(item);
    }
    paletteGrid.append(fragment);
  }
  function syncOptions() {
    if (target !== 'source' && Number(target) >= app.layout) target = 'source';
    const choices = [['source', 'Исходник'], ...app.variants.slice(0, app.layout).map(v =>
      [String(v.index), `${v.index + 1} · ${deps.outputFormatLabel(v.config.format)}`])];
    const key = JSON.stringify(choices);
    if (key !== optionsKey) {
      optionsKey = key;
      select.replaceChildren(...choices.map(([value, label]) => {
        const option = document.createElement('option'); option.value = value; option.textContent = label; return option;
      }));
    }
    select.value = target; select.disabled = !app.source;
  }
  function base(snapshot) {
    return [['Файл / результат', snapshot.label], ['Размер полного файла', `${deps.formatBytes(snapshot.blob.size)} (${number(snapshot.blob.size)} байт)`],
      ['MIME, заявленный файлом', snapshot.blob.type || 'Не указан']];
  }
  function raster(snapshot) {
    let info;
    try { info = deps.workingRasterInfo(snapshot.pixels); } catch { info = null; }
    fields(rasterFields, info ? [
      ['Размеры рабочего растра', `${info.width} × ${info.height}`],
      ['Рабочие отсчёты', `RGBA · ${info.bitDepth} бит/канал · ${info.sampleType}`],
      ['Объём одного RGBA-буфера', `${deps.formatBytes(info.byteLength)} (${number(info.byteLength)} байт)`],
      ['Цветовая метка растра', { srgb: 'sRGB', 'display-p3': 'Display P3', unknown: 'Неизвестна' }[info.colorSpace]],
      ['Хранение alpha', info.alphaMode === 'straight' ? 'Независимый канал' : 'RGB умножен на alpha']
    ] : [['Рабочий растр', 'Недоступен']]);
    return info;
  }
  function present(snapshot, info) {
    const rows = base(snapshot), working = raster(snapshot);
    rows.push(['Формат по сигнатуре', info.format || 'Детальный разбор доступен для JPEG и PNG']);
    if (info.width && info.height) rows.push(['Размеры в файле', `${info.width} × ${info.height}`]);
    const bpp = info.bpp ?? (info.status === 'unsupported' && working ? deps.fileBitsPerPixel(snapshot.blob.size, working.width, working.height) : null);
    rows.push(['Бит на пиксель (bpp)', bpp === null ? 'Не определено' : `${number(bpp)} · ${info.bpp !== null ? 'по размерам в файле' : 'по размерам рабочего растра'}`]);
    if (info.bitDepth !== null) rows.push([info.format === 'PNG' && info.colorType === 3 ? 'Разрядность индекса палитры' : 'Разрядность в файле', `${info.bitDepth} бит${info.colorType === 3 ? '' : '/компонент'}`]);
    if (info.format === 'PNG' && info.colorType !== undefined) {
      rows.push(['Цветовой тип PNG', { 0: 'Серый', 2: 'RGB', 3: 'Палитра (индексы)', 4: 'Серый + alpha', 6: 'RGBA' }[info.colorType]],
        ['Чересстрочность', info.interlace ? 'Adam7' : 'Нет'],
        ['Палитра PLTE', info.paletteEntries === null ? (info.status === 'ok' ? 'Нет' : 'Не определено') : `${info.paletteEntries} записей · RGB по 8 бит`],
        ['Прозрачность в файле', info.transparency === 'alpha' ? 'Канал alpha' : info.transparency === 'tRNS' ? 'Блок tRNS' : info.status === 'ok' ? 'Не объявлена' : 'Не определено'],
        ['Цветовые метки PNG', info.colorLabels.join(', ') || (info.status === 'ok' ? 'Не найдены' : 'Не определено')]);
    }
    if (snapshot.paletteInfo) {
      const palette=snapshot.paletteInfo;
      rows.push(['Палитра в файле', `${palette.storedEntries} записей`],
        ['Получено цветов', String(palette.definedEntries)],
        ['Использовано индексов', `${palette.usedEntries} из ${palette.storedEntries}`],
        ['Заданный предел цветов', String(palette.requestedColors)],
        ['Прозрачный индекс', palette.transparentUsed ? 'Использован' : 'Не использован']);
    }
    showPalette(snapshot.paletteInfo);
    if (info.format === 'JPEG' && info.mode) {
      rows.push(['Тип кодирования', info.mode], ['Прогрессивный', info.progressive ? 'Да' : 'Нет'],
        ['Компоненты (по маркерам)', info.colorModel || 'Не определено'],
        ['Коэффициенты H × V', info.components.map(c => `${c.id}: ${c.h} × ${c.v}`).join('; ')],
        ['Цветовая дискретизация', info.sampling || (info.components.length === 1 ? 'Не применяется' : 'Не определена; см. коэффициенты')]);
    }
    if (info.format) for (const [key, label] of [['icc', 'ICC-профиль'], ['exif', 'EXIF'], ['xmp', 'XMP']]) {
      rows.push([label, { present: 'Блок обнаружен; содержимое не проверялось', absent: 'Не обнаружено в разобранной структуре', unknown: 'Не определено' }[info.metadata[key]]]);
    }
    fields(fileFields, rows);
    const state = { ok: 'Прочитаны заголовки и структура файла.', unsupported: 'Для этого формата показаны только общие сведения.',
      partial: 'Паспорт прочитан частично.', invalid: 'В структуре файла обнаружена ошибка.' }[info.status];
    status.textContent = [state, ...info.notes].join(' ');
  }
  function updateFilePassport() {
    if (!dialog.open) return;
    syncOptions();
    const snapshot = selected();
    if (same(current, snapshot)) return;
    current = snapshot; const id = ++request;
    controller?.abort(); controller = null;
    fields(fileFields, []); fields(rasterFields, []);
    showPalette(null);
    if (!snapshot.blob) { status.textContent = snapshot.message || 'Файл недоступен.'; return; }
    fields(fileFields, base(snapshot)); raster(snapshot); status.textContent = 'Читаю свойства файла…';
    const cached = cache.get(snapshot.blob);
    if (cached) { present(snapshot, cached); return; }
    controller = new AbortController();
    deps.inspectFile(snapshot.blob, { signal: controller.signal }).then(info => {
      if (request !== id || !dialog.open || !same(snapshot, selected())) return;
      if (info.status === 'ok' || info.status === 'unsupported') cache.set(snapshot.blob, info);
      present(snapshot, info);
    }).catch(error => {
      if (request !== id || !dialog.open || !same(snapshot, selected()) || error.name === 'AbortError') return;
      status.textContent = 'Не удалось прочитать паспорт: ' + (error.message || String(error));
    });
  }
  function openFilePassport(variant) {
    if (!app.source || dialog.open) return;
    target = variant && variant.config.format !== 'original' ? String(variant.index) : 'source';
    if (!attached) {
      attached = true;
      select.addEventListener('change', () => { target = select.value; updateFilePassport(); });
      dialog.addEventListener('close', () => { controller?.abort(); controller = null; current = null; ++request; fields(fileFields, []); fields(rasterFields, []); showPalette(null); status.textContent = ''; });
    }
    current = null; dialog.showModal(); updateFilePassport();
  }
  return { openFilePassport, updateFilePassport };
}
