import { FORMAT_DEFS } from "./../core/config.mjs";

// Dependencies are bound by application.mjs after all components are constructed.
export function createComparison({app, els}, deps) {
  function disposeVariantOutput(variant) {
    if (variant.url) URL.revokeObjectURL(variant.url);
    if (variant.bitmap && variant.bitmap.close) variant.bitmap.close();
    variant.url = null;
    variant.bitmap = null;
    variant.imageData = null;
    variant.blob = null;
    variant.resultConfig = null;
    variant.resultSource = null;
  }
  
  async function renderVisibleVariants() {
    const visible = app.variants.filter((variant) => !variant.cell.classList.contains("hidden"));
    const generation = app.sourceGeneration;
    for(const variant of visible) { if(generation!==app.sourceGeneration) return; await deps.renderVariant(variant); }
  }
  
  async function renderVariant(variant) {
    if (!app.source) return;
    clearTimeout(variant.debounce);
    const generation = ++variant.generation;
    const sourceGeneration = app.sourceGeneration;
    const source = app.source;
    const config = { ...variant.config, metadataPolicy: els.metadataPolicy.value };
    const format = config.format;
    const def = FORMAT_DEFS[format];
    const current = () => generation === variant.generation && sourceGeneration === app.sourceGeneration && source === app.source;
    const started = performance.now();
    deps.disposeVariantOutput(variant);
    variant.processing = true;
    variant.dirty = true;
    variant.error = null;
    variant.metrics = { format: deps.outputFormatLabel(format), size: "счёт..." };
    deps.updateMetrics(variant);
    try {
      if (format !== "original") { const unavailable=deps.formatUnavailableReason(format); if(unavailable) throw new Error(unavailable); }
      const encoded = await deps.encodeFromSource(config, source, current);
      if (!current()) return;
      const decoded = encoded.previewOnly
        ? await deps.imageDataToPreview(encoded.previewImageData)
        : await deps.decodeVariantForPreview(encoded.blob);
      if (!current()) {
        if (decoded.bitmap && decoded.bitmap.close) decoded.bitmap.close();
        return;
      }
      if (decoded.imageData.width !== encoded.width || decoded.imageData.height !== encoded.height) {
        if (decoded.bitmap && decoded.bitmap.close) decoded.bitmap.close();
        throw new Error("Размеры сохранённого файла не совпадают с ожидаемыми");
      }
      const reference = encoded.sourceImageData;
      const {psnr, alpha:alphaError} = await deps.measurePixels(reference.data, decoded.imageData.data);
      if(!current()) {decoded.bitmap?.close();return;}
      const alphaInfo = deps.alphaLabel(format, decoded.imageData);
      variant.blob = encoded.blob;
      variant.url = URL.createObjectURL(encoded.blob);
      variant.bitmap = decoded.bitmap;
      variant.imageData = decoded.imageData;
      variant.resultConfig = config;
      variant.resultSource = source;
      variant.dirty = false;
      variant.measurement = {bytes:encoded.blob.size,width:encoded.width,height:encoded.height,
        percentOfSource:source.size?encoded.blob.size/source.size*100:null,psnrRGB:psnr,alphaErrorPercent:alphaError,
        processingMs:encoded.previewOnly?0:Math.round(performance.now()-started)};
      variant.metrics = {
        format: deps.outputFormatLabel(format) + " • " + alphaInfo
          + (source.panorama || source.panoramaError ? (encoded.panoramaPreserved ? " • GPano" : " • без GPano") : ""),
        size: deps.formatBytes(encoded.blob.size),
        resolution: encoded.width + "×" + encoded.height,
        ratio: source.size ? Math.round(encoded.blob.size / source.size * 100) + "%" : "—",
        alpha: alphaError === null ? "—" : alphaError.toFixed(2) + "%",
        psnr: psnr === Infinity ? "∞ dB" : psnr === null ? "—" : psnr.toFixed(2) + " dB",
        time: encoded.previewOnly ? "0 мс" : Math.max(1, Math.round(performance.now() - started)) + " мс"
      };
    } catch (error) {
      if (!current()) return;
      deps.disposeVariantOutput(variant);
      variant.error = error.message || String(error);
      variant.metrics = { format: deps.outputFormatLabel(format), size: "ошибка" };
      deps.showStatus(def.label + ": " + variant.error, true);
    } finally {
      if (current()) {
        variant.processing = false;
        deps.updateMetrics(variant);
        deps.drawAll();
      }
    }
  }
  
  function outputFormatLabel(format) {
    if (format === "original") {
      return `Исходный: ${deps.sourceOriginalFormatLabel()}`;
    }
    return FORMAT_DEFS[format] ? FORMAT_DEFS[format].label : format;
  }
  
  function sourceOriginalFormatLabel() {
    if (!app.source) return "файл";
    const type = (app.source.type || "").toLowerCase();
    const ext = deps.sourceFileExtension().toLowerCase();
    const byMime = {
      "image/jpeg": "JPEG",
      "image/jpg": "JPEG",
      "image/png": "PNG",
      "image/gif": "GIF",
      "image/webp": "WebP",
      "image/bmp": "BMP",
      "image/avif": "AVIF",
      "image/jxl": "JPEG XL",
      "image/x-icon": "ICO",
      "image/tiff": "TIFF",
      "image/heic": "HEIC",
      "image/heif": "HEIF"
    };
    if (byMime[type]) return byMime[type];
    const byExt = {
      jpg: "JPEG",
      jpeg: "JPEG",
      png: "PNG",
      gif: "GIF",
      webp: "WebP",
      bmp: "BMP",
      avif: "AVIF",
      jxl: "JPEG XL",
      ico: "ICO",
      tif: "TIFF",
      tiff: "TIFF",
      heic: "HEIC",
      heif: "HEIF"
    };
    return byExt[ext] || (type ? type.replace(/^image\//, "").toUpperCase() : "файл");
  }
  
  function sourceFileExtension() {
    const name = app.source && app.source.name ? app.source.name : "";
    const match = name.match(/\.([^.]+)$/);
    if (match) return match[1].toLowerCase();
    const type = app.source && app.source.type ? app.source.type.toLowerCase() : "";
    return type.startsWith("image/") ? type.slice(6).replace("jpeg", "jpg") : "img";
  }
  
  function downloadVariant(variant) {
    if (!deps.isVariantReady(variant)) { deps.showStatus("Дождитесь пересчёта результата перед скачиванием."); return; }
    const format = variant.resultConfig.format;
    const def = FORMAT_DEFS[format];
    const sourceName = variant.resultSource.name;
    const name = format === "original" ? sourceName
      : sourceName.replace(/\.[^.]+$/, "") + "-" + (variant.index + 1) + "." + def.ext;
    const a = document.createElement("a");
    a.href = variant.url;
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
  }

  return { disposeVariantOutput, renderVisibleVariants, renderVariant, outputFormatLabel, sourceOriginalFormatLabel, sourceFileExtension, downloadVariant };
}
