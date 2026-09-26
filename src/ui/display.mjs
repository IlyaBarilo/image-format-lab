import { createSdrMapper, MAX_DISPLAY_PIXELS, normalizeDisplay } from '../core/display-sdr.mjs';

export function createDisplay({ app, els }, deps) {
  let cache = new WeakMap(), revision = 0, timer = null;

  function clearDisplayCache() {
    revision++;
    cache = new WeakMap();
  }

  function displayImage(pixels, fallback) {
    if (app.display.mode !== 'sdr' || !pixels || !['uint8', 'uint16'].includes(pixels.sampleType) ||
        pixels.width * pixels.height > MAX_DISPLAY_PIXELS) return fallback;
    let entry = cache.get(pixels);
    if (entry) return entry.canvas || fallback;
    const token = revision;
    entry = { canvas: null, failed: false };
    cache.set(pixels, entry);
    try {
      const canvas = document.createElement('canvas');
      canvas.width = pixels.width;
      canvas.height = pixels.height;
      const context = canvas.getContext('2d');
      if (!context) { entry.failed = true; return fallback; }
      const rows = Math.min(pixels.height, Math.max(1, Math.floor(65536 / pixels.width)));
      const image = context.createImageData(pixels.width, rows);
      const mapRows = createSdrMapper(pixels, image.data, app.display);
      let row = 0;
      function advance() {
        if (token !== revision || cache.get(pixels) !== entry) return;
        try {
          const next = Math.min(row + rows, pixels.height);
          mapRows(row, next);
          context.putImageData(image, 0, row, 0, 0, pixels.width, next - row);
          row = next;
          if (row < pixels.height) { setTimeout(advance, 0); return; }
          entry.canvas = canvas;
          deps.redrawPreviews();
        } catch { entry.failed = true; }
      }
      setTimeout(advance, 0);
    } catch { entry.failed = true; }
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
    els.displayOutputNote.textContent = value.mode !== 'sdr'
      ? 'Обычный предпросмотр Canvas — 8 бит/канал. Точные пиксели остаются доступными для анализа и сохранения.'
      : oversized
      ? 'Свыше 12 Мп остаётся обычный предпросмотр. Точные пиксели и анализ не меняются.'
      : high ? '16-битные отсчёты используются для SDR-показа. Вывод Canvas — 8 бит/канал; точный анализ и файл не меняются.'
        : 'Преобразование действует и на 8-битные изображения. Вывод Canvas — 8 бит/канал; это не HDR и не подтверждение 10-битного сигнала монитора.';
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
