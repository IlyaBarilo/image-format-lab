import { selectAnalysisSize, resolveAnalysisSplit, analysisSplitKey } from '../core/analysis-layout.mjs';

// Bound by application.mjs; resizing has no dependency on encoders or analysis workers.
export function createAnalysisLayout({ els }, deps) {
  const grid = els.grid, stage = grid.closest('.stage');
  const panel = document.getElementById('analysisPanel'), splitter = document.getElementById('analysisSplitter');
  const body = document.getElementById('analysisBody');
  const heading = panel.querySelector('.analysis-heading');
  const buttons = [...panel.querySelectorAll('button[data-analysis-size]')];
  let state = { size: 'compact', previous: 'compact', ratio: null };
  let lastManual = null;
  let attached = false, frame = 0, drag = null, geometry = null, changingVisibility = false, finalizing = false;
  const isAnalysisResizing = () => Boolean(drag || finalizing);
  const px = value => Number.parseFloat(value) || 0;
  const height = element => element.getBoundingClientRect().height;

  function measure() {
    // Read the responsive preset first, so the total does not drift across drags/resizes.
    delete stage.dataset.analysisSized;
    const rows = new Map(), style = getComputedStyle(grid);
    for (const cell of grid.querySelectorAll('.cell:not(.hidden)')) {
      const box = cell.getBoundingClientRect(), border = getComputedStyle(cell);
      const minimum = height(cell.querySelector('.cell-head')) + height(cell.querySelector('.cell-foot'))
        + px(border.borderTopWidth) + px(border.borderBottomWidth) + 48;
      const row = Math.round(box.top);
      rows.set(row, Math.max(rows.get(row) || 0, minimum));
    }
    const imageMinimum = [...rows.values()].reduce((sum, n) => sum + n, 0) + Math.max(0, rows.size - 1) * px(style.rowGap);
    const panelStyle = getComputedStyle(panel);
    const headerHeight = height(heading)
      + px(panelStyle.paddingTop) + px(panelStyle.paddingBottom) + px(panelStyle.borderTopWidth) + px(panelStyle.borderBottomWidth);
    const toolbar = panel.querySelector('.analysis-toolbar');
    const panelMinimum = headerHeight + (toolbar ? height(toolbar) + 10 : 0) + 120;
    const panelHeight = height(panel), total = height(grid) + panelHeight;
    return { total, imageMinimum, panelMinimum, headerHeight, panel: panelHeight, ratio: total ? panelHeight / total : 0.35 };
  }

  function apply(ratio, bounds) {
    const split = resolveAnalysisSplit(bounds.total, ratio, bounds.imageMinimum, bounds.panelMinimum);
    stage.style.setProperty('--analysis-preview-height', `${split.image}px`);
    stage.style.setProperty('--analysis-panel-height', `${split.panel}px`);
    stage.dataset.analysisSized = '';
    splitter.setAttribute('aria-valuemin', (split.min * 100).toFixed(1));
    splitter.setAttribute('aria-valuemax', (split.max * 100).toFixed(1));
    splitter.setAttribute('aria-valuenow', (split.ratio * 100).toFixed(1));
    splitter.setAttribute('aria-valuetext', `Графики: ${Math.round(split.ratio * 100)}%${state.ratio !== null ? ', настроено вручную' : ''}`);
    splitter.setAttribute('aria-disabled', String(split.max - split.min < 1e-9));
    splitter.title = `Графики: ${Math.round(split.ratio * 100)}%. Потяните вверх или вниз. Двойной щелчок — вернуть готовый размер.`;
    geometry = { ...bounds, ...split };
    return split.ratio;
  }

  function updateButtons() {
    stage.dataset.analysisSize = state.size;
    stage.toggleAttribute('data-analysis-collapsed', body.hidden);
    stage.toggleAttribute('data-analysis-custom', state.ratio !== null);
    const selected = body.hidden ? 'collapsed' : state.size === 'max' ? 'max' : state.ratio !== null ? 'manual' : state.size;
    for (const button of buttons) {
      const active = button.dataset.analysisSize === selected;
      button.setAttribute('aria-pressed', String(active));
      button.classList.toggle('active', active);
      if (button.dataset.analysisSize === 'manual') {
        button.disabled = lastManual === null && state.ratio === null;
        button.title = button.disabled ? 'Сначала настройте высоту полоской между просмотром и графиками' : 'Вернуть последнее ручное соотношение просмотра и графиков';
      }
    }
  }

  function rememberManual() {
    if (!body.hidden && state.size !== 'max' && state.ratio !== null) lastManual = { size: state.size, ratio: state.ratio };
  }

  function refresh() {
    updateButtons();
    splitter.hidden = false;
    if (body.hidden || state.size === 'max') {
      finishDrag(true);
      delete stage.dataset.analysisSized;
      geometry = null;
      if (body.hidden) {
        splitter.setAttribute('aria-valuemin', '0');
        splitter.setAttribute('aria-valuemax', '100');
        splitter.setAttribute('aria-valuenow', '0');
        splitter.setAttribute('aria-valuetext', 'Графики свёрнуты. Потяните вверх или нажмите Enter, чтобы развернуть.');
        splitter.setAttribute('aria-disabled', 'false');
        splitter.title = 'Потяните вверх, чтобы развернуть графики. Enter или двойной щелчок — готовый размер.';
      } else {
        splitter.setAttribute('aria-valuemin', '0');
        splitter.setAttribute('aria-valuemax', '100');
        splitter.setAttribute('aria-valuenow', '100');
        splitter.setAttribute('aria-valuetext', 'Максимум. Изображения скрыты. Потяните вниз, чтобы вернуть просмотр.');
        splitter.setAttribute('aria-disabled', 'false');
        splitter.title = 'Потяните вниз, чтобы вернуть просмотр изображений. Стрелка вниз — прежнее соотношение; Enter или двойной щелчок — готовый размер.';
      }
      return;
    }
    const bounds = measure();
    apply(state.ratio ?? bounds.ratio, bounds);
  }

  function redraw() {
    deps.drawAll();
    // Canvas buffers now match the committed layout; resume using these final viewports.
    deps.resumeAnalysisAfterResize();
    deps.redrawAnalysis();
    deps.drawAnalysisRegion();
  }

  function schedule() {
    if (!attached || frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (isAnalysisResizing()) return;
      refresh();
      redraw();
    });
  }

  function finishDrag(cancel) {
    if (!drag) return;
    const previous = drag;
    drag = null;
    finalizing = true;
    if (cancel) state = previous.state;
    stage.classList.remove('analysis-resizing');
    stage.removeAttribute('data-analysis-collapse-ready');
    if (previous.handle.hasPointerCapture(previous.id)) previous.handle.releasePointerCapture(previous.id);
    if ((cancel && previous.collapsed) || (!cancel && previous.collapseRequested)) {
      if (!cancel) state = previous.state;
      deps.collapseAnalysis();
      if (!cancel) heading.focus({ preventScroll: true });
    }
    if (!cancel && previous.moved && !previous.collapseRequested) rememberManual();
    refresh();
    finalizing = false;
    schedule();
  }

  function choose(size) {
    finishDrag(false);
    if (size === 'collapsed') {
      deps.collapseAnalysis();
      refresh();
      buttons.find(button => button.dataset.analysisSize === 'collapsed').focus({ preventScroll: true });
      schedule();
      return;
    }
    if (size === 'manual') {
      if (!lastManual) return;
      state = { ...lastManual, previous: lastManual.size };
    }
    // Opening a collapsed maximum selects maximum; only a second visible click toggles it.
    else if (!(body.hidden && size === 'max' && state.size === 'max')) state = selectAnalysisSize(state, size);
    deps.expandAnalysis();
    refresh();
    schedule();
  }

  function reset() {
    finishDrag(false);
    state = selectAnalysisSize(state, state.size === 'max' ? state.previous : state.size);
    deps.expandAnalysis();
    refresh();
    schedule();
  }

  function restoreAnalysisLayout() {
    if (body.hidden) return false;
    if (state.size === 'max') {
      choose('max');
      (state.ratio === null ? buttons.find(b => b.dataset.analysisSize === state.size) : splitter).focus();
      return true;
    }
    if (state.ratio !== null || state.size !== 'compact') {
      choose('compact');
      buttons.find(button => button.dataset.analysisSize === 'compact').focus();
      return true;
    }
    return false;
  }

  function syncAnalysisLayout() {
    if (!attached || changingVisibility || isAnalysisResizing()) return;
    refresh();
    schedule();
  }

  function captureAnalysisLayoutPreferences() {
    const committed=drag?drag.state:state;
    return {...committed,collapsed:drag?drag.collapsed:body.hidden,lastManual:lastManual?{...lastManual}:null};
  }

  function applyAnalysisLayoutPreferences(value) {
    finishDrag(true);
    state={size:value.size,previous:value.previous,ratio:value.ratio};
    lastManual=value.lastManual?{...value.lastManual}:null;
    body.hidden=value.collapsed;
    document.getElementById('analysisCollapse').setAttribute('aria-expanded',String(!body.hidden));
    updateButtons();
    if(attached){refresh();schedule();}
  }

  function attachAnalysisLayoutEvents() {
    if (attached) return;
    attached = true;
    for (const button of buttons) button.addEventListener('click', () => choose(button.dataset.analysisSize));
    function start(event, handle) {
      if (event.button !== 0 || event.isPrimary === false || drag || handle.hidden ||
        event.target?.closest?.('button, input, select, a, label')) return;
      event.preventDefault();
      refresh();
      handle.focus({ preventScroll: true });
      drag = { id: event.pointerId, y: event.clientY, state: { ...state }, bounds: { ...(body.hidden || state.size === 'max' ? measure() : geometry) }, handle,
        collapsed: body.hidden,
        scroll: window.scrollY + stage.scrollTop };
      handle.setPointerCapture(event.pointerId);
      stage.classList.add('analysis-resizing');
      deps.pauseAnalysisForResize();
    }
    function move(event) {
      if (!drag || drag.id !== event.pointerId) return;
      const delta = event.clientY - drag.y + window.scrollY + stage.scrollTop - drag.scroll;
      if (!drag.moved && (drag.collapsed ? delta > -6 : state.size === 'max' ? delta < 6 : Math.abs(delta) < 1)) return;
      if (!drag.moved && (drag.collapsed || state.size === 'max')) {
        if (state.size === 'max') state.size = state.previous;
        changingVisibility = true;
        try { deps.expandAnalysis(); } finally { changingVisibility = false; }
        updateButtons();
        const basePanel = drag.bounds.panel;
        drag.bounds = { ...measure(), panel: basePanel };
      }
      drag.moved = true;
      const wanted = drag.bounds.panel - delta;
      drag.collapseRequested = wanted <= drag.bounds.headerHeight + 12;
      stage.toggleAttribute('data-analysis-collapse-ready', drag.collapseRequested);
      state.ratio = wanted / drag.bounds.total;
      state.ratio = apply(state.ratio, { ...drag.bounds, panelMinimum: drag.bounds.headerHeight });
      updateButtons();
    }
    for (const handle of [splitter, heading]) {
      handle.addEventListener('pointerdown', event => start(event, handle));
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', event => {
        if (drag?.id !== event.pointerId) return;
        move(event);
        finishDrag(false);
      });
      for (const name of ['pointercancel', 'lostpointercapture']) handle.addEventListener(name, event => {
        if (drag?.id === event.pointerId) finishDrag(true);
      });
    }
    heading.addEventListener('keydown', event => {
      if (event.key === 'Escape' && drag) { event.preventDefault(); event.stopPropagation(); finishDrag(true); }
    });
    splitter.addEventListener('dblclick', reset);
    splitter.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopPropagation();
        if (drag) finishDrag(true); else if (!body.hidden) reset();
        return;
      }
      if (event.key === 'Enter') { event.preventDefault(); reset(); splitter.scrollIntoView({ block: 'nearest' }); return; }
      if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      finishDrag(false);
      if (body.hidden) {
        if (event.key === 'ArrowDown' || event.key === 'Home') return;
        reset();
        if (event.key === 'ArrowUp') { splitter.scrollIntoView({ block: 'nearest' }); return; }
      }
      if (state.size === 'max') {
        if (event.key === 'ArrowUp' || event.key === 'End') return;
        choose('max');
        if (event.key === 'ArrowDown') { splitter.scrollIntoView({ block: 'nearest' }); return; }
      }
      refresh();
      const ratio = analysisSplitKey(event.key, geometry?.ratio ?? 0.35, event.shiftKey);
      if (ratio === null) return;
      state.ratio = ratio;
      state.ratio = apply(state.ratio, geometry);
      rememberManual();
      updateButtons();
      splitter.scrollIntoView({ block: 'nearest' });
      schedule();
    });
    window.addEventListener('blur', () => finishDrag(true));
    window.addEventListener('resize', () => { finishDrag(false); schedule(); });
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(() => { if (!drag) schedule(); });
      // Canvas changes are handled elsewhere; only structural sizes affect the limits.
      for (const element of [stage, panel.querySelector('.analysis-heading'), panel.querySelector('.analysis-toolbar'), ...grid.querySelectorAll('.cell-head, .cell-foot'), document.getElementById('batchPanel')].filter(Boolean)) observer.observe(element);
    }
    refresh();
  }

  return { attachAnalysisLayoutEvents, syncAnalysisLayout, restoreAnalysisLayout, isAnalysisResizing, captureAnalysisLayoutPreferences, applyAnalysisLayoutPreferences };
}
