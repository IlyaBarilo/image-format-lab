import { BACKGROUNDS } from "./../core/config.mjs";
import { visibleAnalysisRegion } from '../core/analysis-viewport.mjs';

// Dependencies are bound by application.mjs after all components are constructed.
export function createCanvas({app, els}, deps) {
  const lastViewport = new WeakMap();
  function resizeCanvases() {
    if (deps.isAnalysisResizing()) return;
    const dpr = Math.max(1, Math.min(2.5, window.devicePixelRatio || 1));
    for (const variant of app.variants) {
      const rect = variant.canvas.parentElement.getBoundingClientRect();
      // Hidden previews retain their buffers and last viewport for the zoom controls.
      if (!rect.width || !rect.height) continue;
      lastViewport.set(variant.canvas, { width: rect.width, height: rect.height });
      const width = Math.max(1, Math.round(rect.width * dpr));
      const height = Math.max(1, Math.round(rect.height * dpr));
      if (variant.canvas.width !== width || variant.canvas.height !== height) {
        variant.canvas.width = width;
        variant.canvas.height = height;
      }
    }
  }
  
  function drawAll() {
    if (deps.isAnalysisResizing()) return;
    deps.resizeCanvases();
    deps.updatePixelInspector?.();
    redrawPreviews();
    document.getElementById("zoomReadout").textContent=app.source?`${Math.round(deps.comparisonScale()*1000)/10}%`:"—";
    deps.updateAnalysisViewport();
  }

  // Marker-only updates do not resize canvases or schedule analysis/encoding.
  function redrawPreviews() {
    if (deps.isAnalysisResizing()) return;
    for (const variant of app.variants) {
      if (!variant.cell.classList.contains("hidden") && variant.canvas.parentElement.getBoundingClientRect().height) deps.drawVariant(variant);
    }
  }

  function getAnalysisViewport(side, image = app.variants[side]?.imageData) {
    const canvas = app.variants[side]?.canvas;
    if (!canvas || !app.source || !image) return { region: null, message: 'Нет изображения для анализа видимой части.' };
    const visible = canvas.getBoundingClientRect();
    // Maximum mode hides previews. Keep their last dimensions instead of switching to the full frame.
    const rect = visible.width && visible.height ? visible : lastViewport.get(canvas);
    if (!rect) return { region: null, message: 'Покажите изображения, чтобы определить видимую часть.' };
    const scale = app.view.absoluteScale
      ? app.view.absoluteScale * canvas.width / rect.width
      : Math.min(canvas.width / app.source.width, canvas.height / app.source.height) * 0.94 * app.view.zoom;
    const region = visibleAnalysisRegion(image, app.source, app.view, canvas, scale);
    return { region, ...(region ? {} : { message: 'Изображение вне области просмотра. Переместите его или нажмите «Вписать».' }) };
  }
  
  function drawVariant(variant) {
    const canvas = variant.canvas;
    const ctx = variant.ctx;
    const width = canvas.width;
    const height = canvas.height;
    deps.drawBackground(ctx, width, height);
  
    if (!app.source) return;
  
    const image = variant.bitmap || (variant.index === 0 ? null : null);
    const sourceW = image ? image.width : app.source.width;
    const sourceH = image ? image.height : app.source.height;
    const scale = deps.getDrawScale(canvas);
    const x = width / 2 - (app.view.centerX - (app.source.width - sourceW) / 2) * scale;
    const y = height / 2 - (app.view.centerY - (app.source.height - sourceH) / 2) * scale;
  
    ctx.imageSmoothingEnabled = scale < 1;
    ctx.imageSmoothingQuality = "high";
  
    if (image) {
      ctx.drawImage(image, x, y, sourceW * scale, sourceH * scale);
    } else {
      ctx.globalAlpha = 0.42;
      ctx.drawImage(app.source.canvas, x, y, sourceW * scale, sourceH * scale);
      ctx.globalAlpha = 1;
      if (variant.error) {
        deps.drawOverlayMessage(ctx, canvas, "Ошибка кодирования");
      } else {
        deps.drawOverlayMessage(ctx, canvas, "Ожидание пересчета");
      }
    }
  
    deps.drawImageFrame(ctx, x, y, sourceW * scale, sourceH * scale);
    deps.drawPixelMarker?.(variant);
  }
  
  function drawBackground(ctx, width, height) {
    const bg = app.background;
    if (bg !== "checker") {
      ctx.fillStyle = BACKGROUNDS[bg] || "#808080";
      ctx.fillRect(0, 0, width, height);
      return;
    }
  
    const size = Math.max(12, Math.round(18 * Math.min(2, window.devicePixelRatio || 1)));
    ctx.fillStyle = "#f7f7f7";
    ctx.fillRect(0, 0, width, height);
    for (let y = 0; y < height; y += size) {
      for (let x = 0; x < width; x += size) {
        ctx.fillStyle = ((x / size + y / size) % 2 === 0) ? "#d7dde4" : "#ffffff";
        ctx.fillRect(x, y, size, size);
      }
    }
  }
  
  function drawImageFrame(ctx, x, y, w, h) {
    ctx.save();
    ctx.strokeStyle = "rgba(24, 33, 43, 0.42)";
    ctx.lineWidth = Math.max(1, window.devicePixelRatio || 1);
    ctx.strokeRect(Math.round(x) + 0.5, Math.round(y) + 0.5, w, h);
    ctx.restore();
  }
  
  function drawOverlayMessage(ctx, canvas, text) {
    ctx.save();
    const dpr = window.devicePixelRatio || 1;
    ctx.font = `${13 * dpr}px Segoe UI, Arial, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const paddingX = 14 * dpr;
    const paddingY = 8 * dpr;
    const metrics = ctx.measureText(text);
    const w = metrics.width + paddingX * 2;
    const h = 34 * dpr;
    const x = canvas.width / 2 - w / 2;
    const y = canvas.height / 2 - h / 2;
    deps.roundRect(ctx, x, y, w, h, 8 * dpr);
    ctx.fillStyle = "rgba(24, 33, 43, 0.84)";
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.fillText(text, canvas.width / 2, canvas.height / 2 + paddingY * 0.12);
    ctx.restore();
  }
  
  function roundRect(ctx, x, y, w, h, r) {
    const radius = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + w, y, x + w, y + h, radius);
    ctx.arcTo(x + w, y + h, x, y + h, radius);
    ctx.arcTo(x, y + h, x, y, radius);
    ctx.arcTo(x, y, x + w, y, radius);
    ctx.closePath();
  }
  
  function attachCanvasEvents(canvas) {
    canvas.addEventListener("wheel", (event) => {
      if (!app.source) return;
      deps.cancelPixelPointer?.();
      event.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const dprX = canvas.width / rect.width;
      const dprY = canvas.height / rect.height;
      const mx = (event.clientX - rect.left) * dprX;
      const my = (event.clientY - rect.top) * dprY;
      const oldScale = deps.getDrawScale(canvas);
      const imageX = app.view.centerX + (mx - canvas.width / 2) / oldScale;
      const imageY = app.view.centerY + (my - canvas.height / 2) / oldScale;
      const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
      if(app.view.absoluteScale) app.view.absoluteScale=deps.clamp(app.view.absoluteScale*factor,0.01,128);
      else app.view.zoom = deps.clamp(app.view.zoom * factor, 0.08, 1280);
      const newScale = deps.getDrawScale(canvas);
      app.view.centerX = imageX - (mx - canvas.width / 2) / newScale;
      app.view.centerY = imageY - (my - canvas.height / 2) / newScale;
      deps.drawAll();
    }, { passive: false });
  
    canvas.addEventListener("pointerdown", (event) => {
      if (!app.source) return;
      deps.pixelPointerDown?.(event);
      if (event.button !== 0 || event.isPrimary === false) return;
      app.pointer.active = true;
      app.pointer.id = event.pointerId;
      app.pointer.lastX = event.clientX;
      app.pointer.lastY = event.clientY;
      canvas.setPointerCapture(event.pointerId);
      canvas.classList.add("dragging");
    });
  
    canvas.addEventListener("pointermove", (event) => {
      deps.pixelPointerMove?.(event);
      if (!app.pointer.active || app.pointer.id !== event.pointerId || !app.source) return;
      const dx = event.clientX - app.pointer.lastX;
      const dy = event.clientY - app.pointer.lastY;
      app.pointer.lastX = event.clientX;
      app.pointer.lastY = event.clientY;
      const scale = deps.getDrawScale(canvas) / (canvas.width / canvas.getBoundingClientRect().width);
      app.view.centerX -= dx / scale;
      app.view.centerY -= dy / scale;
      deps.drawAll();
    });
  
    canvas.addEventListener("pointerup", event => { deps.endPointer(event); deps.pixelPointerUp?.(event); });
    const cancel = event => { deps.endPointer(event); deps.cancelPixelPointer?.(); };
    canvas.addEventListener("pointercancel", cancel);
    canvas.addEventListener("lostpointercapture", cancel);
  }
  
  function endPointer(event) {
    const canvas = event.currentTarget;
    if (app.pointer.id === event.pointerId) {
      app.pointer.active = false;
      app.pointer.id = null;
      canvas.classList.remove("dragging");
    }
  }
  
  function getDrawScale(canvas) {
    if (!app.source) return 1;
    const rect=canvas.getBoundingClientRect();
    if(app.view.absoluteScale && rect.width) return app.view.absoluteScale*canvas.width/rect.width;
    const fit = Math.min(canvas.width / app.source.width, canvas.height / app.source.height) * 0.94;
    return fit * app.view.zoom;
  }
  
  function resetView() {
    app.view.absoluteScale = null;
    if (!app.source) {
      app.view.centerX = 0;
      app.view.centerY = 0;
      app.view.zoom = 1;
      return;
    }
    app.view.centerX = app.source.width / 2;
    app.view.centerY = app.source.height / 2;
    app.view.zoom = 1;
  }
  
  function updateLayout(count) {
    app.layout = count;
    els.grid.classList.toggle("two", count === 2);
    els.grid.classList.toggle("four", count === 4);
    els.layout2.classList.toggle("active", count === 2);
    els.layout4.classList.toggle("active", count === 4);
    els.layout2.setAttribute("aria-pressed", String(count === 2));
    els.layout4.setAttribute("aria-pressed", String(count === 4));
  
    for (const variant of app.variants) {
      variant.cell.classList.toggle("hidden", variant.index >= count);
    }
    deps.updateAnalysis();
  
    deps.resizeCanvases();
    deps.drawAll();
    if (app.source) deps.renderVisibleVariants();
  }
  
  function comparisonScale() {
    if (!app.source) return 1;
    if (app.view.absoluteScale) return app.view.absoluteScale;
    const canvas = app.variants[0].canvas, visible = canvas.getBoundingClientRect();
    const rect = visible.width && visible.height ? visible : lastViewport.get(canvas);
    return rect ? deps.getDrawScale(canvas) * rect.width / canvas.width : 1;
  }
  
  function setComparisonScale(scale) { if(!app.source)return;app.view.absoluteScale=deps.clamp(scale,0.01,128);deps.drawAll(); }

  return { resizeCanvases, drawAll, redrawPreviews, drawVariant, drawBackground, drawImageFrame, drawOverlayMessage, roundRect, attachCanvasEvents, endPointer, getDrawScale, resetView, updateLayout, comparisonScale, setComparisonScale, getAnalysisViewport };
}
