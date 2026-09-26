import { createSdrMapper, createFloat16SdrMapper, MAX_DISPLAY_PIXELS, normalizeDisplay } from '../core/display-sdr.mjs';

export function probeFloat16Canvas(documentRef = document) {
  if (typeof Float16Array !== 'function') return false;
  try {
    const canvas = documentRef.createElement('canvas');
    canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d', { alpha: false, colorSpace: 'srgb', colorType: 'float16' });
    if (context?.getContextAttributes?.().colorType !== 'float16') return false;
    const image = context.createImageData(1, 1, { colorSpace: 'srgb', pixelFormat: 'rgba-float16' });
    if (image.pixelFormat !== 'rgba-float16' || !(image.data instanceof Float16Array)) return false;
    image.data.set([0.5, 0, 0, 1]);
    context.putImageData(image, 0, 0);
    const read = context.getImageData(0, 0, 1, 1, { colorSpace: 'srgb', pixelFormat: 'rgba-float16' });
    return read.pixelFormat === 'rgba-float16' && read.data instanceof Float16Array;
  } catch { return false; }
}

function isFloat16Context(context) {
  try { return context?.getContextAttributes?.().colorType === 'float16'; }
  catch { return false; }
}

export function createDisplay({ app, els }, deps) {
  let cache = new WeakMap(), revision = 0, timer = null, float16Failed = false;

  function clearDisplayCache() {
    revision++;
    cache = new WeakMap();
  }

  function displayImage(pixels, fallback, targetContext) {
    if (app.display.mode !== 'sdr' || !pixels || !['uint8', 'uint16'].includes(pixels.sampleType) ||
        pixels.width * pixels.height > MAX_DISPLAY_PIXELS) return fallback;
    const kind = pixels.bitDepth > 8 && app.float16CanvasReady && !float16Failed && isFloat16Context(targetContext) ? 'float16' : 'unorm8';
    let entries = cache.get(pixels);
    if (!entries) { entries = {}; cache.set(pixels, entries); }
    let entry = entries[kind];
    if (entry) return entry.canvas || fallback;
    const token = revision;
    entry = { canvas: null, failed: false };
    entries[kind] = entry;
    const fail = () => {
      entry.failed = true;
      if (kind === 'float16' && !float16Failed) {
        float16Failed = true;
        clearDisplayCache();
        syncDisplayControls();
        setTimeout(() => deps.redrawPreviews(), 0);
      }
    };
    try {
      const canvas = document.createElement('canvas');
      canvas.width = pixels.width;
      canvas.height = pixels.height;
      const context = kind === 'float16'
        ? canvas.getContext('2d', { colorSpace: 'srgb', colorType: 'float16' })
        : canvas.getContext('2d');
      if (!context || (kind === 'float16' && !isFloat16Context(context))) { fail(); return fallback; }
      const rows = Math.min(pixels.height, Math.max(1, Math.floor(65536 / pixels.width)));
      const image = kind === 'float16'
        ? context.createImageData(pixels.width, rows, { colorSpace: 'srgb', pixelFormat: 'rgba-float16' })
        : context.createImageData(pixels.width, rows);
      if (kind === 'float16' && (image.pixelFormat !== 'rgba-float16' || !(image.data instanceof Float16Array))) {
        fail(); return fallback;
      }
      const mapRows = kind === 'float16'
        ? createFloat16SdrMapper(pixels, image.data, app.display)
        : createSdrMapper(pixels, image.data, app.display);
      let row = 0;
      function advance() {
        if (token !== revision || cache.get(pixels)?.[kind] !== entry) return;
        try {
          const next = Math.min(row + rows, pixels.height);
          mapRows(row, next);
          context.putImageData(image, 0, row, 0, 0, pixels.width, next - row);
          row = next;
          if (row < pixels.height) { setTimeout(advance, 0); return; }
          entry.canvas = canvas;
          syncDisplayControls();
          deps.redrawPreviews();
        } catch { fail(); }
      }
      setTimeout(advance, 0);
    } catch { fail(); }
    return fallback;
  }

  function syncDisplayControls() {
    const value = app.display;
    els.displayMode.value = value.mode;
    els.displayBlack.value = String(value.black);
    els.displayWhite.value = String(value.white);
    els.displayExposure.value = String(value.exposure);
    els.displayDither.checked = value.dither;
    els.displayBlackValue.textContent = `${value.black}%`;
    els.displayWhiteValue.textContent = `${value.white}%`;
    els.displayExposureValue.textContent = `${value.exposure > 0 ? '+' : ''}${value.exposure} EV`;
    for (const control of [els.displayBlack, els.displayWhite, els.displayExposure, els.displayDither]) control.disabled = value.mode !== 'sdr';
    els.displayMenuToggle.classList.toggle('active', value.mode === 'sdr');
    const high = app.source?.pixelBuffer?.bitDepth > 8 || app.variants.some(variant => variant.pixelBuffer?.bitDepth > 8);
    const oversized = [app.source, ...app.variants].some(item => item?.pixelBuffer && item.pixelBuffer.width * item.pixelBuffer.height > MAX_DISPLAY_PIXELS);
    const float16Eligible = high && app.float16CanvasReady && !float16Failed &&
      app.variants.every(variant => !variant.pixelBuffer || isFloat16Context(variant.ctx));
    els.displayDither.disabled = value.mode !== 'sdr' || Boolean(float16Eligible);
    els.displayDither.title = float16Eligible ? 'Дизеринг нужен только при выводе через RGBA8.' : '';
    const visibleHigh = app.variants.filter(variant => variant.pixelBuffer?.bitDepth > 8 && !variant.cell?.classList?.contains('hidden'));
    const float16Ready = float16Eligible && (visibleHigh.length
      ? visibleHigh.every(variant => cache.get(variant.pixelBuffer)?.float16?.canvas)
      : Boolean(app.source?.pixelBuffer && cache.get(app.source.pixelBuffer)?.float16?.canvas));
    els.displayOutputNote.textContent = value.mode !== 'sdr'
      ? 'Обычный предпросмотр из RGBA8. Точные пиксели остаются доступными для анализа и сохранения.'
      : oversized
      ? 'Свыше 12 Мп остаётся обычный предпросмотр. Точные пиксели и анализ не меняются.'
      : high && float16Ready ? 'Путь вывода: Canvas float16. Целые 16-битные отсчёты округляются для показа; 10-битный сигнал монитора не подтверждён.'
      : high && float16Eligible ? 'Подготавливаю Canvas float16; пока показана 8-битная копия. Точные отсчёты и файл не меняются.'
      : high ? 'Путь вывода: Canvas RGBA8 с дизерингом. Точные отсчёты, анализ и файл не меняются.'
        : 'Путь вывода: Canvas RGBA8. Исходник имеет до 8 бит/канал; это не HDR и не подтверждение 10-битного сигнала монитора.';
    els.displayMenuToggle.title = els.displayOutputNote.textContent;
  }

  function applyControls(event) {
    if (Number(els.displayBlack.value) >= Number(els.displayWhite.value)) {
      if (event.target === els.displayBlack) els.displayWhite.value = String(Number(els.displayBlack.value) + 1);
      else els.displayBlack.value = String(Number(els.displayWhite.value) - 1);
    }
    const value = normalizeDisplay({ mode: els.displayMode.value, black: Number(els.displayBlack.value),
      white: Number(els.displayWhite.value), exposure: Number(els.displayExposure.value), dither: els.displayDither.checked });
    app.display = value;
    syncDisplayControls();
    clearDisplayCache();
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; deps.redrawPreviews(); }, 120);
  }

  function attachDisplayEvents() {
    const positionMenu = () => {
      if (els.displayMenu.hidden) return;
      const button = els.displayMenuToggle.getBoundingClientRect();
      const width = els.displayMenu.getBoundingClientRect().width;
      els.displayMenu.style.left = `${Math.max(12 - button.left, Math.min(0, window.innerWidth - 12 - width - button.left))}px`;
    };
    for (const control of [els.displayMode, els.displayBlack, els.displayWhite, els.displayExposure, els.displayDither])
      control.addEventListener('input', applyControls);
    els.displayMenuToggle.addEventListener('click', () => {
      els.displayMenu.hidden = !els.displayMenu.hidden;
      els.displayMenuToggle.setAttribute('aria-expanded', String(!els.displayMenu.hidden));
      syncDisplayControls();
      positionMenu();
    });
    window.addEventListener('resize', positionMenu);
    document.addEventListener('pointerdown', event => {
      if (!els.displayMenu.hidden && !els.displayMenu.contains(event.target) && event.target !== els.displayMenuToggle) {
        els.displayMenu.hidden = true;
        els.displayMenuToggle.setAttribute('aria-expanded', 'false');
      }
    });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && !els.displayMenu.hidden) {
        els.displayMenu.hidden = true;
        els.displayMenuToggle.setAttribute('aria-expanded', 'false');
        els.displayMenuToggle.focus();
      }
    });
    syncDisplayControls();
  }

  return { attachDisplayEvents, displayImage, clearDisplayCache, syncDisplayControls };
}
