

// Dependencies are bound by application.mjs after all components are constructed.
export function createSource({app, els}, deps) {
  async function loadFile(file, options = {}) {
    const announce = options.announce !== false;
    const fileId = options.fileId;
    deps.disposeSource();
    const generation = app.sourceGeneration;
    app.sourceLoading = true;
    deps.setEmptyState("Открываю изображение…", file.name || "image");
    deps.drawAll();
    if (announce) deps.showStatus("Загружаю исходное изображение...");
    try {
      const source = await deps.decodeSourceFile(file);
      if (generation !== app.sourceGeneration) return false;
      app.source = source;
      source.fileId = fileId;
      
      els.emptyState.style.display = "none";
      deps.resetView();
      if (options.renderPreview !== false) await deps.renderVisibleVariants();
      else deps.drawAll();
      if (generation !== app.sourceGeneration) return false;
      if (announce) deps.showStatus("Исходник загружен. Все варианты считаются из него.");
      return true;
    } catch (error) {
      if (generation !== app.sourceGeneration) return false;
      deps.disposeSource();
      app.sourceError = error.message || String(error);
      deps.setEmptyState("Не удалось открыть изображение", "Выберите другой файл или нажмите на этот файл в списке, чтобы повторить открытие.");
      if (announce) deps.showStatus("Не удалось открыть файл: " + (error.message || error), true);
      deps.drawAll();
      return false;
    } finally {
      if (generation === app.sourceGeneration) { app.sourceLoading = false; deps.updateAnalysis(); }
      
    }
  }
  
  function disposeSource() {
    deps.clearBatchPreview();
    app.sourceGeneration++;
    app.sourceLoading = false;
    app.source = null;
    app.sourceError = "";
    for (const variant of app.variants) {
      clearTimeout(variant.debounce);
      variant.generation++;
      variant.processing = false;
      deps.disposeVariantOutput(variant);
      variant.metrics = null;
      variant.error = null;
      variant.dirty = false;
      deps.updateMetrics(variant);
    }
  }
  
  function createSampleFile() {
    const canvas = document.createElement("canvas");
    canvas.width = 960;
    canvas.height = 640;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  
    const photo = ctx.createLinearGradient(70, 60, 560, 360);
    photo.addColorStop(0, "#fed7aa");
    photo.addColorStop(0.32, "#60a5fa");
    photo.addColorStop(0.68, "#16a34a");
    photo.addColorStop(1, "#111827");
    ctx.fillStyle = photo;
    ctx.fillRect(70, 60, 500, 320);
  
    ctx.save();
    ctx.beginPath();
    ctx.rect(70, 60, 500, 320);
    ctx.clip();
    for (let i = 0; i < 360; i++) {
      const x = 70 + ((i * 37) % 500);
      const y = 60 + ((i * 61) % 320);
      const radius = 10 + (i % 32);
      ctx.fillStyle = `hsla(${(i * 29) % 360}, 82%, ${42 + (i % 24)}%, 0.16)`;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  
    ctx.fillStyle = "rgba(255, 255, 255, 0.86)";
    ctx.fillRect(610, 60, 250, 170);
    ctx.strokeStyle = "rgba(17, 24, 39, 0.92)";
    ctx.lineWidth = 1;
    for (let x = 622; x <= 846; x += 8) {
      ctx.beginPath();
      ctx.moveTo(x, 74);
      ctx.lineTo(x, 216);
      ctx.stroke();
    }
    for (let y = 74; y <= 216; y += 8) {
      ctx.beginPath();
      ctx.moveTo(622, y);
      ctx.lineTo(846, y);
      ctx.stroke();
    }
  
    ctx.fillStyle = "#111827";
    ctx.font = "700 58px Segoe UI, Arial, sans-serif";
    ctx.fillText("Aa 123", 92, 500);
    ctx.font = "500 30px Segoe UI, Arial, sans-serif";
    ctx.fillText("Текст, линии, альфа", 96, 548);
  
    ctx.strokeStyle = "#111827";
    ctx.lineWidth = 2;
    for (let i = 0; i < 18; i++) {
      ctx.beginPath();
      ctx.moveTo(94, 578 + i * 3);
      ctx.lineTo(540, 578 + i * 3);
      ctx.stroke();
    }
  
    const alphaGrad = ctx.createRadialGradient(730, 430, 12, 730, 430, 180);
    alphaGrad.addColorStop(0, "rgba(239, 68, 68, 0.95)");
    alphaGrad.addColorStop(0.36, "rgba(59, 130, 246, 0.55)");
    alphaGrad.addColorStop(0.72, "rgba(34, 197, 94, 0.24)");
    alphaGrad.addColorStop(1, "rgba(34, 197, 94, 0)");
    ctx.fillStyle = alphaGrad;
    ctx.beginPath();
    ctx.arc(730, 430, 180, 0, Math.PI * 2);
    ctx.fill();
  
    ctx.globalAlpha = 0.72;
    ctx.fillStyle = "#facc15";
    ctx.beginPath();
    deps.roundRect(ctx, 610, 500, 270, 70, 14);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = "#111827";
    ctx.lineWidth = 6;
    ctx.strokeRect(70, 60, 500, 320);
  
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error("Не удалось создать образец"));
          return;
        }
        resolve(new File([blob], "sample-alpha-lines.png", { type: "image/png" }));
      }, "image/png");
    });
  }

  return { loadFile, disposeSource, createSampleFile };
}
