import { samplePixel, comparePixelSamples, pixelAtClientPoint, pixelCenterInCanvas } from '../core/pixel-inspector.mjs';

export function createPixelInspector({ app }, deps) {
  const get = id => document.getElementById(id);
  const panel = get('pixelInspector'), body = get('analysisBody');
  const xInput = get('pixelX'), yInput = get('pixelY'), rows = get('pixelRows'), status = get('pixelStatus');
  let source = null, generation = -1, point = null, pointer = null, rendered = '';

  function active() { return panel.open && !body.hidden; }
  function syncSource() {
    if (source === app.source && generation === app.sourceGeneration) return;
    source = app.source; generation = app.sourceGeneration;
    point = null; pointer = null; rendered = '';
    xInput.value = yInput.value = '';
    status.textContent = '';
    xInput.removeAttribute('aria-invalid'); yInput.removeAttribute('aria-invalid');
    render([]);
  }
  function describe(sample) {
    const space = { srgb: 'sRGB', 'display-p3': 'Display P3', unknown: 'пространство неизвестно' }[sample.colorSpace];
    return `${sample.bitDepth} бит${sample.sampleType === 'float32' ? ' float' : ''} · ${sample.peak === null ? 'без заданного диапазона' : `0–${sample.peak}`} · ${space}${sample.alphaMode === 'premultiplied' ? ' · RGB × α' : ''}`;
  }
  function read(pixels) {
    if (!pixels) return { message: 'Точные пиксели недоступны.' };
    try { return { sample: samplePixel(pixels, point.x, point.y) }; }
    catch (error) { return { message: error.message }; }
  }
  function entry(label, pixels, message = '') { return { label, ...(message ? { message } : read(pixels)) }; }
  function snapshot() {
    if (!point || !source) return [];
    const reference = entry('Исходник', source.pixelBuffer);
    const result = [reference];
    for (const variant of app.variants.slice(0, app.layout)) {
      const ready = deps.isVariantReady(variant);
      const label = `${variant.index + 1} · ${deps.outputFormatLabel((ready ? variant.resultConfig : variant.config).format)}`;
      const row = entry(label, variant.pixelBuffer, ready ? '' : variant.error ? 'Ошибка обработки; значения недоступны.' : 'Ожидание пересчёта…');
      if (row.sample) row.delta = reference.sample ? comparePixelSamples(reference.sample, row.sample)
        : { values: null, reason: 'Точный исходник недоступен.' };
      result.push(row);
    }
    return result;
  }
  function signed(value, normalized) {
    if (value === 0) return '0';
    return `${value > 0 ? '+' : '−'}${normalized ? (Math.abs(value) * 100).toFixed(6).replace('.', ',') : Math.abs(value)}${normalized ? '%' : ''}`;
  }
  function render(data) {
    const key = JSON.stringify(data);
    if (key === rendered) return;
    rendered = key;
    const nodes = data.map(row => {
      const tr = document.createElement('tr'), title = document.createElement('th');
      title.scope = 'row'; title.textContent = row.label; tr.append(title);
      if (!row.sample) {
        const td = document.createElement('td'); td.colSpan = 5; td.textContent = row.message; tr.append(td); return tr;
      }
      const detail = document.createElement('td'); detail.className = 'pixel-description';
      detail.textContent = describe(row.sample);
      if (row.delta) {
        const note = document.createElement('small');
        note.textContent = row.delta.values ? `Δ: ${row.delta.unit === 'levels' ? 'уровни' : '% диапазона'}${row.delta.note ? `. ${row.delta.note}` : ''}` : `Δ недоступна: ${row.delta.reason}`;
        detail.append(note);
      }
      tr.append(detail);
      row.sample.rgba.forEach((value, channel) => {
        const td = document.createElement('td'); td.textContent = String(value);
        if (row.delta?.values) {
          const delta = document.createElement('small'); delta.textContent = `Δ ${signed(row.delta.values[channel], row.delta.unit === 'normalized')}`;
          td.append(delta);
        }
        tr.append(td);
      });
      return tr;
    });
    rows.replaceChildren(...nodes);
    get('pixelTable').hidden = !nodes.length;
  }
  function updatePixelInspector({ redraw = false } = {}) {
    syncSource();
    const enabled = Boolean(source?.pixelBuffer);
    xInput.disabled = yInput.disabled = get('pixelShow').disabled = !enabled;
    xInput.max = String(Math.max(0, (source?.width || 1) - 1));
    yInput.max = String(Math.max(0, (source?.height || 1) - 1));
    get('pixelHint').textContent = enabled
      ? 'Щёлкните по готовому изображению или введите X и Y от 0. Перетаскивание перемещает просмотр. Δ = результат − исходник.'
      : 'Откройте изображение для проверки пикселей.';
    render(active() ? snapshot() : []);
    if (redraw && active() && point) deps.redrawPreviews();
  }
  function selectPoint(next) {
    point = next;
    xInput.value = String(next.x); yInput.value = String(next.y);
    xInput.removeAttribute('aria-invalid'); yInput.removeAttribute('aria-invalid');
    status.textContent = `Пиксель X ${next.x}, Y ${next.y}.`;
    updatePixelInspector(); deps.redrawPreviews();
  }
  function showCoordinates(event) {
    event.preventDefault(); syncSource();
    if (!source?.pixelBuffer) return;
    const x = xInput.value.trim() === '' ? NaN : Number(xInput.value), y = yInput.value.trim() === '' ? NaN : Number(yInput.value);
    const validX = Number.isInteger(x) && x >= 0 && x < source.width, validY = Number.isInteger(y) && y >= 0 && y < source.height;
    xInput.setAttribute('aria-invalid', String(!validX)); yInput.setAttribute('aria-invalid', String(!validY));
    if (!validX || !validY) {
      point = null; status.textContent = `Введите целые X от 0 до ${source.width - 1} и Y от 0 до ${source.height - 1}.`;
      updatePixelInspector(); deps.redrawPreviews(); (!validX ? xInput : yInput).focus(); return;
    }
    selectPoint({ x, y });
  }
  function geometry(variant) {
    return { source, image: variant.pixelBuffer, view: app.view, canvas: variant.canvas,
      rect: variant.canvas.getBoundingClientRect(), scale: deps.getDrawScale(variant.canvas) };
  }
  function selectable(variant) {
    return variant && deps.isVariantReady(variant) && variant.pixelBuffer && source
      && variant.pixelBuffer.width === source.width && variant.pixelBuffer.height === source.height;
  }
  function pixelPointerDown(event) {
    syncSource();
    // A second contact cancels selection, leaving normal viewer gestures alone.
    if (pointer || event.isPrimary === false) { pointer = null; return; }
    if (!active() || !source || event.button !== 0) return;
    const variant = app.variants.find(item => item.canvas === event.currentTarget);
    pointer = { id: event.pointerId, canvas: event.currentTarget, x: event.clientX, y: event.clientY, moved: false,
      source, generation, pixels: variant?.pixelBuffer, ready: selectable(variant) };
  }
  function pixelPointerMove(event) {
    if (pointer?.id === event.pointerId && Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) > 4) pointer.moved = true;
  }
  function cancelPixelPointer() { pointer = null; }
  function pixelPointerUp(event) {
    const start = pointer;
    if (!start || start.id !== event.pointerId) return;
    pointer = null; syncSource();
    if (!active() || start.source !== source || start.generation !== generation || start.canvas !== event.currentTarget || start.moved || Math.hypot(event.clientX - start.x, event.clientY - start.y) > 4) return;
    const variant = app.variants.find(item => item.canvas === event.currentTarget);
    if (!start.ready || !selectable(variant) || start.pixels !== variant.pixelBuffer) {
      status.textContent = 'Выберите готовую ячейку с исходными размерами или введите координаты.'; return;
    }
    const next = pixelAtClientPoint(geometry(variant), event.clientX, event.clientY);
    if (next) selectPoint(next);
    else status.textContent = point ? 'Точка вне изображения; сохранён прежний выбор.' : 'Точка вне изображения. Щёлкните по изображению или введите координаты.';
  }
  function drawPixelMarker(variant) {
    syncSource();
    if (!active() || !point || !selectable(variant)) return;
    const geom = geometry(variant), { x, y } = pixelCenterInCanvas(geom, point);
    if (!geom.rect.width || !geom.rect.height || x < 0 || y < 0 || x >= variant.canvas.width || y >= variant.canvas.height) return;
    // Constant CSS size; two strokes remain readable on light and dark pixels.
    const ctx = variant.ctx, dx = variant.canvas.width / geom.rect.width, dy = variant.canvas.height / geom.rect.height;
    ctx.save(); ctx.translate(x, y); ctx.scale(dx, dy);
    ctx.beginPath(); ctx.moveTo(-9, 0); ctx.lineTo(-3, 0); ctx.moveTo(3, 0); ctx.lineTo(9, 0);
    ctx.moveTo(0, -9); ctx.lineTo(0, -3); ctx.moveTo(0, 3); ctx.lineTo(0, 9);
    ctx.strokeStyle = '#000'; ctx.lineWidth = 3; ctx.stroke();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.stroke(); ctx.restore();
  }
  function attachPixelInspectorEvents() {
    get('pixelForm').addEventListener('submit', showCoordinates);
    panel.addEventListener('toggle', () => { pointer = null; updatePixelInspector(); deps.redrawPreviews(); deps.redrawAnalysis(); });
    updatePixelInspector();
  }
  return { attachPixelInspectorEvents, updatePixelInspector, drawPixelMarker,
    pixelPointerDown, pixelPointerMove, pixelPointerUp, cancelPixelPointer };
}
