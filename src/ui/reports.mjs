import { FORMAT_DEFS, OPTIONAL_CODECS } from "./../core/config.mjs";

// Dependencies are bound by application.mjs after all components are constructed.
export function createReports({app, els}, deps) {
  function comparisonReport() {
    const source = app.source;
    if (!source || app.sourceLoading) throw new Error("Дождитесь открытия исходника.");
    return {version:1, createdAt:new Date().toISOString(), browser:navigator.userAgent,
      source:{name:source.name, width:source.width, height:source.height, bytes:source.size},
      methodology:{psnr:"RGB по всем пикселям на белой подложке; Infinity означает совпадение видимого RGB", alpha:"Средняя абсолютная ошибка alpha, % от 255", time:"Время обработки варианта, включая ожидание, декодирование и метрики; не изолированный тест кодировщика", reference:"Растр Canvas после декодирования исходника", zoom:"100%: один пиксель изображения на один CSS-пиксель"},
      variants:app.variants.filter(v=>!v.cell.classList.contains("hidden")).map(v=>{
        const ready=deps.isVariantReady(v);
        return {cell:v.index+1, status:ready?"ready":v.error?"error":v.processing?"processing":"stale",
          config:{...(ready?v.resultConfig:v.config)}, codec:deps.codecLabel(v.config.format),
          error:v.error || null, metrics:ready?{...v.measurement, psnrRGB:v.measurement?.psnrRGB===Infinity?"Infinity":v.measurement?.psnrRGB}:null};
      })};
  }
  
  function codecLabel(format) {
    const codec = FORMAT_DEFS[format]?.codec;
    if (codec) return OPTIONAL_CODECS[codec].label + " " + (OPTIONAL_CODECS[codec].version || "");
    return format === "original" ? "Без перекодирования" : ["gif","bmp24","bmp32"].includes(format) ? "Встроенный JS-кодировщик" : "Canvas браузера";
  }
  
  function csvCell(value) {
    let text = value == null ? "" : String(value);
    if (typeof value === "string" && /^[\s]*[=+@-]/.test(text)) text = "'" + text;
    return '"' + text.replace(/"/g, '""') + '"';
  }
  
  function saveComparisonReport(type) {
    const report = deps.comparisonReport();
    if (type === "json") { deps.downloadBlob(new Blob([JSON.stringify(report,null,2)], {type:"application/json"}), "comparison-report.json"); return; }
    const headers = ["source","source_width","source_height","source_bytes","created_at","browser","cell","status","format","quality","palette","dither","matte","metadata","codec","tiff_compression","tiff_level","tiff_predictor","bytes","width","height","percent_of_source","psnr_rgb_db_white_background","alpha_mean_error_percent","processing_ms","error"];
    const rows = report.variants.map(v => {const m=v.metrics || {};return [report.source.name,report.source.width,report.source.height,report.source.bytes,report.createdAt,report.browser,v.cell,v.status,v.config.format,v.config.quality,v.config.gifColors,v.config.gifDither,v.config.matte,v.config.metadataPolicy || els.metadataPolicy.value,v.codec,v.config.format==="tiff"?(v.config.tiffCompression||"deflate"):"",v.config.format==="tiff"?(v.config.tiffLevel??6):"",v.config.format==="tiff"?(v.config.tiffPredictor??true):"",m.bytes,m.width,m.height,m.percentOfSource,m.psnrRGB,m.alphaErrorPercent,m.processingMs,v.error];});
    deps.downloadBlob(new Blob(["\ufeff",[headers,...rows].map(row=>row.map(deps.csvCell).join(",")).join("\r\n")],{type:"text/csv;charset=utf-8"}),"comparison-report.csv");
  }

  return { comparisonReport, codecLabel, csvCell, saveComparisonReport };
}
