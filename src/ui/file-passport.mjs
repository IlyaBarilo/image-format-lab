export function createFilePassport({ app }, deps) {
  const get = id => document.getElementById(id);
  const dialog = get('filePassportDialog'), select = get('filePassportTarget');
  const fileFields = get('filePassportFields'), rasterFields = get('filePassportRaster'), status = get('filePassportStatus');
  const paletteSection=get('filePassportPaletteSection'),paletteGrid=get('filePassportPalette');
  const structureSection=get('filePassportStructureSection'),structureSummary=get('filePassportStructureSummary'),structureRows=get('filePassportStructure');
  const timingSection=get('filePassportTimingSection'),timingFields=get('filePassportTiming');
  const cache = new WeakMap();
  const profileHashes=new WeakMap();
  let target = 'source', attached = false, request = 0, controller = null, current = null, optionsKey = '';
  const same = (a, b) => a && b && a.source === b.source && a.sourceGeneration === b.sourceGeneration && a.blob === b.blob && a.pixels === b.pixels && a.generation === b.generation && a.target === b.target && a.message === b.message;
  const number = value => value.toLocaleString('ru-RU', { maximumFractionDigits: 6 });
  const sameBytes=(a,b)=>a===b||Boolean(a&&b&&a.length===b.length&&a.every((value,index)=>value===b[index]));
  function profileIdentity(snapshot){
    const profile=snapshot.cmyk?.iccProfile;
    if(!profile)return null;
    const id=profile.length>=100?Array.from(profile.subarray(84,100),byte=>byte.toString(16).padStart(2,'0')).join(''):'';
    const parts=[`${number(profile.length)} байт`];
    if(id&&!/^0+$/.test(id))parts.push(`ID ${id}`);
    const cached=profileHashes.get(profile);
    if(cached?.hash)parts.push(`SHA-256 ${cached.hash}`);
    else if(!cached&&globalThis.crypto?.subtle){
      profileHashes.set(profile,{pending:true});
      globalThis.crypto.subtle.digest('SHA-256',profile.slice().buffer).then(bytes=>{
        const hash=Array.from(new Uint8Array(bytes),byte=>byte.toString(16).padStart(2,'0')).join('');
        profileHashes.set(profile,{hash});
        if(dialog.open&&same(current,snapshot))raster(snapshot);
      }).catch(()=>profileHashes.set(profile,{unavailable:true}));
    }
    return parts.join(' · ');
  }

  function selected() {
    const source = app.source;
    if (!source) return { target, source: null, message: 'Откройте изображение.' };
    const common = { target, source, sourceGeneration: app.sourceGeneration };
    if (target === 'source') return { ...common, blob: source.file, pixels: source.nativePixelBuffer?.sampleType === 'float32' ? source.nativePixelBuffer : source.pixelBuffer, cmyk:source.cmyk, floatStats:source.floatStats, label: source.name };
    const variant = app.variants[Number(target)];
    if (!variant || !deps.isVariantReady(variant)) return { ...common, generation: variant?.generation,
      message: variant?.error ? 'Ошибка обработки. Паспорт результата недоступен.' : 'Дождитесь пересчёта результата.' };
    return { ...common, blob: variant.blob, pixels: variant.pixelBuffer,cmyk:variant.cmyk, paletteInfo:variant.paletteInfo, measurement:variant.measurement, generation: variant.generation,
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
  function showStructure(layout){
    structureSection.hidden=!layout?.entries?.length;
    structureRows.replaceChildren();
    structureSummary.textContent='';
    if(structureSection.hidden)return;
    const shown=layout.entries.length;
    structureSummary.textContent=`Учтено ${number(layout.coveredBytes)} из ${number(layout.totalBytes)} байт; показано ${number(shown)} участков`
      +(layout.omittedEntries?`, ещё ${number(layout.omittedEntries)} скрыто лимитом списка`:'')
      +(layout.complete?'.':' · разбор неполный.');
    const rows=layout.entries.map(entry=>{
      const row=document.createElement('tr');
      for(const value of [`${number(entry.offset)} (0x${entry.offset.toString(16).toUpperCase()})`,number(entry.bytes),entry.label,entry.detail]){
        const cell=document.createElement('td');cell.textContent=value;row.append(cell);
      }
      return row;
    });
    structureRows.replaceChildren(...rows);
  }
  function showTiming(measurement){
    const stages=measurement?.stages;
    timingSection.hidden=!stages;
    if(!stages){fields(timingFields,[]);return;}
    fields(timingFields,[
      ['До кодирования',`${number(stages.beforeEncodeMs)} мс`],
      ['Подготовка и кодирование',`${number(stages.encodeMs)} мс`],
      ['Чтение результата',`${number(stages.decodeMs)} мс`],
      ['Расчёт метрик',`${number(stages.metricsMs)} мс`],
      ['Прочее',`${number(stages.otherMs)} мс`],
      ['Измерено всего',`${number(stages.totalMs)} мс`]
    ]);
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
    const rows=info ? [
      ['Размеры рабочего растра', `${info.width} × ${info.height}`],
      ['Рабочие отсчёты', `RGBA · ${info.bitDepth} бит/канал · ${info.sampleType}`],
      ['Объём одного RGBA-буфера', `${deps.formatBytes(info.byteLength)} (${number(info.byteLength)} байт)`],
      ['Цветовая метка растра', { srgb: 'sRGB', 'display-p3': 'Display P3', unknown: 'Неизвестна' }[info.colorSpace]],
      ['Хранение alpha', info.alphaMode === 'straight' ? 'Независимый канал' : 'RGB умножен на alpha']
    ] : [['Рабочий растр', 'Недоступен']];
    if(snapshot.cmyk){
      const embedded=snapshot.cmyk.iccProfile,original=snapshot.source?.cmyk?.iccProfile;
      const relation=snapshot.target==='source'?'в исходном файле':original
        ?embedded?(sameBytes(embedded,original)?'сохранён побайтово':'отличается от исходного'):'отсутствует в результате'
        :embedded?'в результате; в исходнике отсутствует':'не задан';
      rows.push(['Исходные каналы','CMYK · 8 бит/канал · без промежуточного RGB'],
        ['Встроенный ICC',embedded?`${relation} · ${profileIdentity(snapshot)}`:`${relation}; профиль не подставляется`],
        ['Тестовый профиль','Отдельные правила анализа; не встроен в файл и не является ICC.'],
        ['Экранный просмотр','RGB-показ не является цветопробой. CMYK-графики считают исходные каналы.']);
    }
    if (snapshot.floatStats) {
      const stats=snapshot.floatStats;
      rows.push(['Диапазон float32 (R, G, B, α)', stats.min.map((value,i)=>`${String(value).replace('.', ',')}…${String(stats.max[i]).replace('.', ',')}`).join(' · ')],
        ['RGB ниже 0 / выше 1', `${number(stats.negative)} / ${number(stats.aboveOne)} отсчётов`],
        ['Экран и сравнение', 'Обычный показ и метрики: SDR 8 бит с обрезкой 0–1. Режим диапазона в меню «Отображение» меняет только экранную шкалу; точные числа — в инспекторе.']);
    }
    fields(rasterFields,rows);
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
    showStructure(info.structure);
    showTiming(snapshot.measurement);
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
    showPalette(null); showStructure(null); showTiming(null);
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
      dialog.addEventListener('close', () => { controller?.abort(); controller = null; current = null; ++request; fields(fileFields, []); fields(rasterFields, []); showPalette(null); showStructure(null); showTiming(null); status.textContent = ''; });
    }
    current = null; dialog.showModal(); updateFilePassport();
  }
  return { openFilePassport, updateFilePassport };
}
