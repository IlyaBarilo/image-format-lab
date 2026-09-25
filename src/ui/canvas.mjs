import { BACKGROUNDS } from "./../core/config.mjs";
import { visibleAnalysisRegion } from '../core/analysis-viewport.mjs';
import { codecGridSpec, visibleCodecBlockCells, visibleCodecBlockLines, visibleGridLines, wipePair } from '../core/wipe-view.mjs';
import { analysisGuideGeometry } from '../core/analysis-guides.mjs';

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
    if(els.wipeHandle)els.wipeHandle.hidden=!app.source;
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
      return {region:null,message:'Для совмещённого просмотра нужны два готовых результата одного размера.'};
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
    if(app.pixelGrid){
      if(app.gridMode==='codec-blocks')drawCodecGridForVariant(ctx,canvas,variant,x,y,scale);
      else drawPixelGrid(ctx,canvas,x,y,sourceW,sourceH,scale);
    }
    if(image&&deps.isVariantReady?.(variant))drawAnalysisGuides(ctx,canvas,variant.imageData,variant.index,x,y,scale);
    deps.drawPixelMarker?.(variant);
  }

  function drawAnalysisGuides(ctx,canvas,image,side,x,y,scale){
    if(!image||!deps.getAnalysisScope||!deps.getAnalysisRegion||!deps.getAnalysisLine)return;
    const scope=deps.getAnalysisScope(),type=document.getElementById('analysisType')?.value;
    if(type==='tradeoff'||(scope!=='region'&&type!=='profile'))return;
    const viewport=scope==='viewport'&&type==='profile'?getAnalysisViewport(side,image).region:null;
    let guides;
    try{guides=analysisGuideGeometry(image.width,image.height,{scope,region:deps.getAnalysisRegion(),viewport,type,line:deps.getAnalysisLine()});}
    catch{return;}
    if(!guides)return;
    const rect=canvas.getBoundingClientRect();
    if(!rect.width||!rect.height)return;
    const device=Math.max(1,canvas.width/rect.width);
    ctx.save();
    ctx.beginPath();ctx.rect(x,y,image.width*scale,image.height*scale);ctx.clip();
    const stroke=(path,dashed=false)=>{
      ctx.beginPath();path();ctx.setLineDash(dashed?[5*device,4*device]:[]);
      ctx.lineCap='round';ctx.lineJoin='round';
      ctx.strokeStyle='rgba(7,22,30,.95)';ctx.lineWidth=3*device;ctx.stroke();
      ctx.strokeStyle='#9af3df';ctx.lineWidth=1.5*device;ctx.stroke();
      ctx.setLineDash([]);
    };
    if(guides.region){
      const box=guides.region;
      stroke(()=>ctx.rect(x+box.x*scale,y+box.y*scale,box.width*scale,box.height*scale),true);
    }
    if(guides.line){
      const points=guides.line;
      const ax=x+(points.x0+.5)*scale,ay=y+(points.y0+.5)*scale;
      const bx=x+(points.x1+.5)*scale,by=y+(points.y1+.5)*scale;
      stroke(()=>{ctx.moveTo(ax,ay);ctx.lineTo(bx,by);});
      ctx.font=`bold ${11*device}px "Segoe UI",sans-serif`;
      ctx.textBaseline='middle';
      for(const [px,py,label] of [[ax,ay,'A'],[bx,by,'B']]){
        ctx.beginPath();ctx.arc(px,py,5*device,0,Math.PI*2);
        ctx.fillStyle='#10212b';ctx.fill();ctx.strokeStyle='#9af3df';ctx.lineWidth=device;ctx.stroke();
        ctx.lineWidth=2*device;ctx.strokeStyle='#10212b';ctx.strokeText(label,px+8*device,py-8*device);
        ctx.fillStyle='#fff';ctx.fillText(label,px+8*device,py-8*device);
      }
    }
    ctx.restore();
  }

  function drawPixelGrid(ctx,canvas,x,y,width,height,scale){
    if(!app.pixelGrid||!scale||!Number.isFinite(scale))return;
    const rect=canvas.getBoundingClientRect();
    if(!rect.width)return;
    const columns=visibleGridLines(x,scale,width,canvas.width,scale*rect.width/canvas.width);
    const rows=visibleGridLines(y,scale,height,canvas.height,scale*rect.height/canvas.height);
    if(!columns&&!rows)return;
    ctx.save();ctx.beginPath();ctx.rect(x,y,width*scale,height*scale);ctx.clip();
    ctx.beginPath();
    if(columns)for(let i=columns.first;i<=columns.last;i++){
      if(i<=0||i>=width)continue;
      const gx=Math.floor(x+i*scale)+.5;
      ctx.moveTo(gx,0);ctx.lineTo(gx,canvas.height);
    }
    if(rows)for(let i=rows.first;i<=rows.last;i++){
      if(i<=0||i>=height)continue;
      const gy=Math.floor(y+i*scale)+.5;
      ctx.moveTo(0,gy);ctx.lineTo(canvas.width,gy);
    }
    ctx.strokeStyle='rgba(112,120,128,.8)';ctx.lineWidth=1;ctx.stroke();
    ctx.restore();
  }

  function drawCodecGridForVariant(ctx,canvas,variant,x,y,scale){
    if(!deps.isVariantReady(variant)||!variant.bitmap)return;
    const spec=codecGridSpec(variant.resultConfig,variant.blockGrid);
    if(!spec)return;
    const {width,height}=variant.bitmap;
    if(!Number.isInteger(width)||!Number.isInteger(height))return;
    const rect=canvas.getBoundingClientRect();
    if(!rect.width)return;
    const cssScale=scale*rect.width/canvas.width;
    if(spec.kind==='jxl'){
      const columns=visibleCodecBlockCells(x,scale,width,canvas.width,cssScale,spec.step);
      const rows=visibleCodecBlockCells(y,scale,height,canvas.height,cssScale,spec.step);
      if(!columns||!rows||(columns.last-columns.first+1)*(rows.last-rows.first+1)>20000)return;
      ctx.save();ctx.beginPath();ctx.rect(x,y,width*scale,height*scale);ctx.clip();
      ctx.beginPath();
      for(let cy=rows.first;cy<=rows.last;cy++)for(let cx=columns.first;cx<=columns.last;cx++){
        const owner=spec.owners[cy*spec.columns+cx];
        if(!owner)continue;
        if(cx+1<spec.columns&&owner!==spec.owners[cy*spec.columns+cx+1]){
          const gx=Math.floor(x+(cx+1)*8*scale)+.5;
          ctx.moveTo(gx,y+cy*8*scale);
          ctx.lineTo(gx,y+Math.min(height,(cy+1)*8)*scale);
        }
        if(cy+1<spec.rows&&owner!==spec.owners[(cy+1)*spec.columns+cx]){
          const gy=Math.floor(y+(cy+1)*8*scale)+.5;
          ctx.moveTo(x+cx*8*scale,gy);
          ctx.lineTo(x+Math.min(width,(cx+1)*8)*scale,gy);
        }
      }
      ctx.setLineDash([]);
      ctx.strokeStyle='rgba(64,82,94,.88)';ctx.lineWidth=2;ctx.stroke();
      ctx.restore();return;
    }
    const columns=visibleCodecBlockLines(x,scale,width,canvas.width,cssScale,spec.step);
    const rows=visibleCodecBlockLines(y,scale,height,canvas.height,cssScale,spec.step);
    if(!columns&&!rows)return;
    ctx.save();ctx.beginPath();ctx.rect(x,y,width*scale,height*scale);ctx.clip();
    for(const major of spec.kind==='jpeg'?[false,true]:[true]){
      ctx.beginPath();
      if(columns)for(let i=columns.first;i<=columns.last;i++){
        const pixel=i*spec.step;
        if(pixel<=0||pixel>=width||(spec.kind==='jpeg'&&(pixel%spec.width===0)!==major))continue;
        const gx=Math.floor(x+pixel*scale)+.5;
        ctx.moveTo(gx,0);ctx.lineTo(gx,canvas.height);
      }
      if(rows)for(let i=rows.first;i<=rows.last;i++){
        const pixel=i*spec.step;
        if(pixel<=0||pixel>=height||(spec.kind==='jpeg'&&(pixel%spec.height===0)!==major))continue;
        const gy=Math.floor(y+pixel*scale)+.5;
        ctx.moveTo(0,gy);ctx.lineTo(canvas.width,gy);
      }
      ctx.strokeStyle=major?'rgba(64,82,94,.88)':'rgba(112,120,128,.65)';
      ctx.lineWidth=major?2:1;
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawWipe(){
    if(!app.wipe?.active||!wipeContext||!els.wipeCanvas||!els.wipeCanvas.width)return;
    const canvas=els.wipeCanvas,ctx=wipeContext,[first,second]=app.variants;
    deps.drawBackground(ctx,canvas.width,canvas.height);
    if(!app.source)return;
    const pair=wipePair(first,second,deps.isVariantReady);
    if(pair.message){deps.drawOverlayMessage(ctx,canvas,pair.message);return;}
    const {width,height}=pair;
    const scale=deps.getDrawScale(canvas);
    const x=canvas.width/2-(app.view.centerX-(app.source.width-width)/2)*scale;
    const y=canvas.height/2-(app.view.centerY-(app.source.height-height)/2)*scale;
    const divider=canvas.width*app.wipe.position;
    ctx.imageSmoothingEnabled=scale<1;ctx.imageSmoothingQuality='high';
    ctx.save();ctx.beginPath();ctx.rect(0,0,divider,canvas.height);ctx.clip();
    ctx.drawImage(first.bitmap,x,y,width*scale,height*scale);ctx.restore();
    ctx.save();ctx.beginPath();ctx.rect(divider,0,canvas.width-divider,canvas.height);ctx.clip();
    ctx.drawImage(second.bitmap,x,y,width*scale,height*scale);ctx.restore();
    deps.drawImageFrame(ctx,x,y,width*scale,height*scale);
    if(app.pixelGrid){
      if(app.gridMode==='codec-blocks'){
        ctx.save();ctx.beginPath();ctx.rect(0,0,divider,canvas.height);ctx.clip();
        drawCodecGridForVariant(ctx,canvas,first,x,y,scale);ctx.restore();
        ctx.save();ctx.beginPath();ctx.rect(divider,0,canvas.width-divider,canvas.height);ctx.clip();
        drawCodecGridForVariant(ctx,canvas,second,x,y,scale);ctx.restore();
      }else drawPixelGrid(ctx,canvas,x,y,width,height,scale);
    }
    drawAnalysisGuides(ctx,canvas,first.imageData,0,x,y,scale);
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
    deps.syncCellHeadSizes();
    deps.updateAnalysis();
  
    deps.resizeCanvases();
    deps.drawAll();
    if (app.source) deps.renderVisibleVariants();
  }

  function setWipeMode(enabled,restoreLayout=true){
    if(!app.wipe||!els.wipeOverlay)return;
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
      els.wipeHandle.style.left=`${app.wipe.position*100}%`;
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
      syncGridModeUI();
      deps.drawAll();
    });
    const menu=els.gridModeMenu,toggle=els.gridModeToggle;
    if(menu&&toggle){
      const close=(focus=false)=>{menu.hidden=true;toggle.setAttribute('aria-expanded','false');if(focus)toggle.focus();};
      const open=()=>{menu.hidden=false;toggle.setAttribute('aria-expanded','true');(app.gridMode==='codec-blocks'?els.gridModeCodec:els.gridModePixels).focus();};
      toggle.addEventListener('click',()=>menu.hidden?open():close());
      toggle.addEventListener('keydown',event=>{if(event.key==='ArrowDown'){event.preventDefault();open();}});
      toggle.parentElement.addEventListener('focusout',event=>{if(!toggle.parentElement.contains(event.relatedTarget))close();});
      for(const [item,mode] of [[els.gridModePixels,'pixels'],[els.gridModeCodec,'codec-blocks']]){
        item.addEventListener('click',()=>{app.gridMode=mode;app.pixelGrid=true;syncGridModeUI();close(true);deps.drawAll();});
        item.addEventListener('keydown',event=>{
          if(event.key==='Escape'){event.preventDefault();close(true);}
          if(event.key==='ArrowDown'||event.key==='ArrowUp'){
            event.preventDefault();(item===els.gridModePixels?els.gridModeCodec:els.gridModePixels).focus();
          }
        });
      }
      document.addEventListener('pointerdown',event=>{if(!menu.hidden&&!toggle.parentElement.contains(event.target))close();});
    }
    syncGridModeUI();
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

  function syncGridModeUI(){
    els.pixelGrid?.setAttribute('aria-pressed',String(Boolean(app.pixelGrid)));
    els.pixelGrid?.classList.toggle('active',Boolean(app.pixelGrid));
    if(els.pixelGrid)els.pixelGrid.title=app.gridMode==='codec-blocks'?'Блоки формата: JPEG/WebP/AVIF/HEIC — подтверждённые блоки, JPEG XL — границы VarDCT; для Modular сетки нет':'Пиксели: показать или скрыть при большом увеличении';
    els.gridModePixels?.setAttribute('aria-checked',String(app.gridMode!=='codec-blocks'));
    els.gridModeCodec?.setAttribute('aria-checked',String(app.gridMode==='codec-blocks'));
  }
  
  function comparisonScale() {
    if (!app.source) return 1;
    if (app.view.absoluteScale) return app.view.absoluteScale;
    const canvas = app.wipe?.active?els.wipeCanvas:app.variants[0].canvas, visible = canvas.getBoundingClientRect();
    const rect = visible.width && visible.height ? visible : lastViewport.get(canvas);
    return rect ? deps.getDrawScale(canvas) * rect.width / canvas.width : 1;
  }
  
  function setComparisonScale(scale) { if(!app.source)return;app.view.absoluteScale=deps.clamp(scale,0.01,128);deps.drawAll(); }

  return { resizeCanvases, drawAll, redrawPreviews, drawVariant, drawBackground, drawImageFrame, drawOverlayMessage, roundRect, attachCanvasEvents, attachWipeEvents, syncGridModeUI, setWipeMode, setWipePosition, endPointer, getDrawScale, resetView, updateLayout, comparisonScale, setComparisonScale, getAnalysisViewport };
}
