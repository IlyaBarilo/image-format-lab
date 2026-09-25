import { BACKGROUNDS } from "./../core/config.mjs";
import { visibleAnalysisRegion } from '../core/analysis-viewport.mjs';
import { visibleGridLines, wipePair } from '../core/wipe-view.mjs';

// Dependencies are bound by application.mjs after all components are constructed.
export function createCanvas({app, els}, deps) {
  const lastViewport = new WeakMap();
  const wipeContext=els.wipeCanvas?.getContext('2d',{alpha:false});
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
    if(app.wipe?.active&&els.wipeCanvas){
      const rect=els.wipeCanvas.getBoundingClientRect();
      if(rect.width&&rect.height){
        lastViewport.set(els.wipeCanvas,{width:rect.width,height:rect.height});
        const width=Math.max(1,Math.round(rect.width*dpr)),height=Math.max(1,Math.round(rect.height*dpr));
        if(els.wipeCanvas.width!==width)els.wipeCanvas.width=width;
        if(els.wipeCanvas.height!==height)els.wipeCanvas.height=height;
      }
    }
  }
  
  function drawAll() {
    if (deps.isAnalysisResizing()) return;
    if(els.wipeMode)els.wipeMode.disabled=!app.source&&!app.wipe?.active;
    deps.resizeCanvases();
    deps.updatePixelInspector?.();
    deps.updateFilePassport?.();
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
    drawWipe();
  }

  function getAnalysisViewport(side, image = app.variants[side]?.imageData) {
    const wipe=app.wipe?.active&&side<2;
    if(wipe&&wipePair(app.variants[0],app.variants[1],deps.isVariantReady).message)
      return {region:null,message:'В шторке нет двух готовых результатов одного размера.'};
    const canvas = wipe?els.wipeCanvas:app.variants[side]?.canvas;
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
    drawPixelGrid(ctx,canvas,x,y,sourceW,sourceH,scale);
    deps.drawPixelMarker?.(variant);
  }

  function drawPixelGrid(ctx,canvas,x,y,width,height,scale){
    if(!app.pixelGrid||!scale||!Number.isFinite(scale))return;
    const rect=canvas.getBoundingClientRect();
    if(!rect.width)return;
    const columns=visibleGridLines(x,scale,width,canvas.width,scale*rect.width/canvas.width);
    const rows=visibleGridLines(y,scale,height,canvas.height,scale*rect.height/canvas.height);
    if(!columns||!rows)return;
    ctx.save();ctx.beginPath();ctx.rect(x,y,width*scale,height*scale);ctx.clip();
    ctx.beginPath();
    for(let i=columns.first;i<=columns.last;i++){const gx=x+i*scale;ctx.moveTo(gx,0);ctx.lineTo(gx,canvas.height);}
    for(let i=rows.first;i<=rows.last;i++){const gy=y+i*scale;ctx.moveTo(0,gy);ctx.lineTo(canvas.width,gy);}
    const deviceWidth=Math.max(1,canvas.width/rect.width);
    ctx.strokeStyle='rgba(0,0,0,.58)';ctx.lineWidth=deviceWidth*2;ctx.stroke();
    ctx.strokeStyle='rgba(255,255,255,.72)';ctx.lineWidth=deviceWidth;ctx.stroke();
    ctx.restore();
  }

  function drawWipe(){
    if(!app.wipe?.active||!wipeContext||!els.wipeCanvas||!els.wipeCanvas.width)return;
    const canvas=els.wipeCanvas,ctx=wipeContext,[first,second]=app.variants;
    deps.drawBackground(ctx,canvas.width,canvas.height);
    if(!app.source){deps.drawOverlayMessage(ctx,canvas,'Откройте изображение');return;}
    const pair=wipePair(first,second,deps.isVariantReady);
    if(pair.message){deps.drawOverlayMessage(ctx,canvas,pair.message);return;}
    const {width,height}=pair;
    const scale=deps.getDrawScale(canvas);
    const x=canvas.width/2-(app.view.centerX-(app.source.width-width)/2)*scale;
    const y=canvas.height/2-(app.view.centerY-(app.source.height-height)/2)*scale;
    const divider=Math.round(canvas.width*app.wipe.position);
    ctx.imageSmoothingEnabled=scale<1;ctx.imageSmoothingQuality='high';
    ctx.save();ctx.beginPath();ctx.rect(0,0,divider,canvas.height);ctx.clip();
    ctx.drawImage(first.bitmap,x,y,width*scale,height*scale);ctx.restore();
    ctx.save();ctx.beginPath();ctx.rect(divider,0,canvas.width-divider,canvas.height);ctx.clip();
    ctx.drawImage(second.bitmap,x,y,width*scale,height*scale);ctx.restore();
    deps.drawImageFrame(ctx,x,y,width*scale,height*scale);
    drawPixelGrid(ctx,canvas,x,y,width,height,scale);
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
  
  function attachCanvasEvents(canvas,{inspect=true}={}) {
    canvas.addEventListener("wheel", (event) => {
      if (!app.source) return;
      if(inspect)deps.cancelPixelPointer?.();
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
      if(inspect)deps.pixelPointerDown?.(event);
      if (event.button !== 0 || event.isPrimary === false) return;
      app.pointer.active = true;
      app.pointer.id = event.pointerId;
      app.pointer.lastX = event.clientX;
      app.pointer.lastY = event.clientY;
      canvas.setPointerCapture(event.pointerId);
      canvas.classList.add("dragging");
    });
  
    canvas.addEventListener("pointermove", (event) => {
      if(inspect)deps.pixelPointerMove?.(event);
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
  
    canvas.addEventListener("pointerup", event => { deps.endPointer(event); if(inspect)deps.pixelPointerUp?.(event); });
    const cancel = event => { deps.endPointer(event); if(inspect)deps.cancelPixelPointer?.(); };
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
    const wipe=Boolean(app.wipe?.active);
    els.grid.classList.toggle('wipe',wipe);
    if(els.wipeOverlay)els.wipeOverlay.hidden=!wipe;
    els.layout2.classList.toggle("active", count === 2&&!wipe);
    els.layout4.classList.toggle("active", count === 4&&!wipe);
    els.layout2.setAttribute("aria-pressed", String(count === 2&&!wipe));
    els.layout4.setAttribute("aria-pressed", String(count === 4&&!wipe));
    els.wipeMode?.classList.toggle('active',wipe);
    els.wipeMode?.setAttribute('aria-pressed',String(wipe));
  
    for (const variant of app.variants) {
      variant.cell.classList.toggle("hidden", variant.index >= count);
    }
    deps.updateAnalysis();
  
    deps.resizeCanvases();
    deps.drawAll();
    if (app.source) deps.renderVisibleVariants();
  }

  function setWipeMode(enabled,restoreLayout=true){
    if(!app.wipe||!els.wipeOverlay)return;
    if(enabled&&!app.source)return;
    if(Boolean(enabled)===app.wipe.active)return;
    if(enabled){
      app.wipe.previousLayout=app.layout;
      app.wipe.active=true;
      deps.updateLayout(2);
    }else{
      app.wipe.active=false;
      const previous=app.wipe.previousLayout;
      app.wipe.previousLayout=null;
      if(restoreLayout)deps.updateLayout(previous===4?4:app.layout);
    }
  }

  function setWipePosition(position){
    if(!app.wipe)return;
    app.wipe.position=deps.clamp(position,0,1);
    if(els.wipeHandle){
      const percent=Math.round(app.wipe.position*100);
      els.wipeHandle.style.left=`${percent}%`;
      els.wipeHandle.setAttribute('aria-valuenow',String(percent));
      els.wipeHandle.setAttribute('aria-valuetext',`${percent}% варианта 1`);
    }
    drawWipe();
  }

  function attachWipeEvents(){
    if(!els.wipeMode||!els.wipeHandle||!els.wipeCanvas)return;
    els.wipeMode.addEventListener('click',()=>setWipeMode(!app.wipe.active));
    els.pixelGrid.addEventListener('click',()=>{
      app.pixelGrid=!app.pixelGrid;
      els.pixelGrid.setAttribute('aria-pressed',String(app.pixelGrid));
      els.pixelGrid.classList.toggle('active',app.pixelGrid);
      deps.drawAll();
    });
    deps.attachCanvasEvents(els.wipeCanvas,{inspect:false});
    const handle=els.wipeHandle,canvas=els.wipeCanvas;
    let pointer=null;
    const move=event=>{
      const rect=canvas.getBoundingClientRect();
      if(rect.width)setWipePosition((event.clientX-rect.left)/rect.width);
    };
    handle.addEventListener('pointerdown',event=>{
      if(event.button!==0||event.isPrimary===false)return;
      event.preventDefault();pointer=event.pointerId;handle.setPointerCapture(pointer);move(event);
    });
    handle.addEventListener('pointermove',event=>{if(pointer===event.pointerId)move(event);});
    const end=event=>{if(pointer===event.pointerId)pointer=null;};
    handle.addEventListener('pointerup',end);handle.addEventListener('pointercancel',end);
    handle.addEventListener('lostpointercapture',end);
    handle.addEventListener('keydown',event=>{
      const step=event.shiftKey?.1:.01;
      let position=app.wipe.position;
      if(event.key==='ArrowLeft'||event.key==='ArrowDown')position-=step;
      else if(event.key==='ArrowRight'||event.key==='ArrowUp')position+=step;
      else if(event.key==='Home')position=0;
      else if(event.key==='End')position=1;
      else return;
      event.preventDefault();setWipePosition(position);
    });
    setWipePosition(app.wipe.position);
  }
  
  function comparisonScale() {
    if (!app.source) return 1;
    if (app.view.absoluteScale) return app.view.absoluteScale;
    const canvas = app.wipe?.active?els.wipeCanvas:app.variants[0].canvas, visible = canvas.getBoundingClientRect();
    const rect = visible.width && visible.height ? visible : lastViewport.get(canvas);
    return rect ? deps.getDrawScale(canvas) * rect.width / canvas.width : 1;
  }
  
  function setComparisonScale(scale) { if(!app.source)return;app.view.absoluteScale=deps.clamp(scale,0.01,128);deps.drawAll(); }

  return { resizeCanvases, drawAll, redrawPreviews, drawVariant, drawBackground, drawImageFrame, drawOverlayMessage, roundRect, attachCanvasEvents, attachWipeEvents, setWipeMode, setWipePosition, endPointer, getDrawScale, resetView, updateLayout, comparisonScale, setComparisonScale, getAnalysisViewport };
}
