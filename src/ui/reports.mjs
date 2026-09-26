import { FORMAT_DEFS, OPTIONAL_CODECS } from "./../core/config.mjs";
import { reportFormatConfig } from '../core/format-options.mjs';

// Dependencies are bound by application.mjs after all components are constructed.
export function createReports({app, els}, deps) {
  const fileHashes=new WeakMap();
  async function hashBlob(blob) {
    let hash=fileHashes.get(blob);
    if(hash)return hash;
    const digest=await globalThis.crypto.subtle.digest('SHA-256',await blob.arrayBuffer());
    hash=Array.from(new Uint8Array(digest),value=>value.toString(16).padStart(2,'0')).join('');
    fileHashes.set(blob,hash);
    return hash;
  }
  function comparisonReport() {
    const source = app.source;
    if (!source || app.sourceLoading) throw new Error("Дождитесь открытия исходника.");
    return {version:2, createdAt:new Date().toISOString(), browser:navigator.userAgent,
      source:{name:source.name, width:source.width, height:source.height, bytes:source.size,bitDepth:source.pixelBuffer?.bitDepth??8,colorSpace:source.pixelBuffer?.colorSpace??'unknown'},
      methodology:{psnr:"RGB по всем пикселям на белой подложке в нормированной шкале исходных отсчётов; Infinity означает совпадение видимого RGB", alpha:"Средняя абсолютная ошибка alpha, % от полного диапазона канала", time:"Время обработки варианта, включая ожидание, декодирование и метрики; не изолированный тест кодировщика", reference:"Рабочие пиксели декодированного исходника; PNG16 сохраняет 16 бит, после изменения размера используется RGBA8. Для неизвестного цвета сравниваются кодовые значения, без ICC/HDR-преобразований", zoom:"100%: один пиксель изображения на один CSS-пиксель"},
      variants:app.variants.filter(v=>!v.cell.classList.contains("hidden")).map(v=>{
        const ready=deps.isVariantReady(v);
        return {cell:v.index+1, status:ready?"ready":v.error?"error":v.processing?"processing":"stale",
          config:reportFormatConfig(ready?v.resultConfig:v.config), codec:deps.codecLabel(v.config.format,ready?v.resultConfig:v.config),
          error:v.error || null, palette:ready?v.paletteInfo||null:null,
          metrics:ready?{...v.measurement, psnrRGB:v.measurement?.psnrRGB===Infinity?"Infinity":v.measurement?.psnrRGB}:null};
      })};
  }
  
  function codecLabel(format, config = {}) {
    if(format==='png'&&(config.pngDepth==='16'||app.source?.pixelBuffer?.bitDepth>8||config.pngFilter&&config.pngFilter!=='default'))return 'Собственный PNG + pako';
    if(format==='pngIndexed')return 'Собственный PNG с палитрой + pako';
    if(format==='jpeg')return 'Встроенный libjpeg-turbo 3.2.0';
    const codec = FORMAT_DEFS[format]?.codec;
    if (codec) return OPTIONAL_CODECS[codec].label + " " + (OPTIONAL_CODECS[codec].version || "");
    return format === "original" ? "Без перекодирования" : ["gif","bmp8","bmp24","bmp32"].includes(format) ? "Встроенный JS-кодировщик" : "Canvas браузера";
  }
  
  function csvCell(value) {
    let text = value == null ? "" : String(value);
    if (typeof value === "string" && /^[\s]*[=+@-]/.test(text)) text = "'" + text;
    return '"' + text.replace(/"/g, '""') + '"';
  }
  
  function saveComparisonReport(type) {
    const report = deps.comparisonReport();
    if (type === "json") { deps.downloadBlob(new Blob([JSON.stringify(report,null,2)], {type:"application/json"}), "comparison-report.json"); return; }
    const headers = ["source","source_width","source_height","source_bytes","created_at","browser","cell","status","format","format_mode","quality","palette","dither","matte","metadata","codec","tiff_compression","tiff_level","tiff_predictor","bytes","width","height","percent_of_source","psnr_rgb_db_white_background","alpha_mean_error_percent","processing_ms","error","png_depth","source_bit_depth","result_bit_depth","precision_note","jpeg_subsampling","jpeg_progressive","bmp_depth","bmp_colors","bmp_compression","palette_defined_entries","palette_stored_entries","palette_used_entries","palette_transparent_used","png_filter","png_deflate_level","png_index_depth","before_encode_ms","encoding_ms","result_read_ms","metrics_ms","other_ms","measured_total_ms","webp_method","jxl_effort"];
    const rows = report.variants.map(v => {
      const c=v.config,m=v.metrics||{},palette=c.format==='png'&&c.formatMode==='palette',bmp8=c.format==='bmp'&&c.bmpDepth===8;
      const paletted=palette||bmp8||c.format==='gif';
      return [report.source.name,report.source.width,report.source.height,report.source.bytes,report.createdAt,report.browser,
        v.cell,v.status,c.format,c.formatMode||'',c.quality,paletted?(bmp8?(c.bmpColors??256):c.gifColors):'',
        palette||c.format==='gif'&&c.formatMode==='built-in'?c.gifDither:'',c.matte,c.metadataPolicy||els.metadataPolicy.value,v.codec,
        c.format==='tiff'?(c.tiffCompression||'deflate'):'',c.format==='tiff'?(c.tiffLevel??6):'',c.format==='tiff'?(c.tiffPredictor??true):'',
        m.bytes,m.width,m.height,m.percentOfSource,m.psnrRGB,m.alphaErrorPercent,m.processingMs,v.error,
        c.format==='png'&&c.formatMode==='full-color'?(c.pngDepth||'auto'):'',report.source.bitDepth,m.bitDepth,m.precisionNote,
        c.format==='jpeg'?(c.jpegSubsampling||'420'):'',c.format==='jpeg'?(c.jpegProgressive??false):'',
        c.format==='bmp'?c.bmpDepth:'',bmp8?(c.bmpColors??256):'',bmp8?(c.bmpCompression||'none'):'',
        v.palette?.definedEntries??'',v.palette?.storedEntries??'',v.palette?.usedEntries??'',v.palette?.transparentUsed??'',
        c.format==='png'&&c.formatMode!=='optimized'?(c.pngFilter||'default'):'',
        c.format==='png'&&c.formatMode!=='optimized'?(c.pngLevel??6):'',palette?(v.palette?.indexDepth??''):'',
        m.stages?.beforeEncodeMs??'',m.stages?.encodeMs??'',m.stages?.decodeMs??'',m.stages?.metricsMs??'',
        m.stages?.otherMs??'',m.stages?.totalMs??'',
        c.format==='webp'&&c.formatMode==='lossless'?(c.webpMethod??4):'',
        c.format==='jxl'?(c.jxlEffort??5):''];
    });
    deps.downloadBlob(new Blob(["\ufeff",[headers,...rows].map(row=>row.map(deps.csvCell).join(",")).join("\r\n")],{type:"text/csv;charset=utf-8"}),"comparison-report.csv");
  }

  async function experimentProtocol() {
    const source=app.source;
    if(!source||app.sourceLoading)throw new Error('Дождитесь открытия исходника.');
    if(!source.file||!Number.isSafeInteger(source.file.size))throw new Error('Исходный файл недоступен для протокола.');
    if(source.file.size>128*1024*1024)throw new Error('Протокол поддерживает исходный файл до 128 МиБ.');
    if(!globalThis.crypto?.subtle)throw new Error('Для SHA-256 нужен браузер с Web Crypto.');
    const comparison=deps.captureComparison(),analysisSnapshot=deps.getAnalysisSnapshot();
    const report=comparisonReport();
    if(!report.variants.every(v=>v.status==='ready'))throw new Error('Дождитесь готовности всех видимых вариантов.');
    const visible=app.variants.filter(v=>!v.cell.classList.contains('hidden'));
    const outputBlobs=visible.map(v=>v.blob);
    if(outputBlobs.some(blob=>!(blob instanceof Blob)))throw new Error('Сохранённые результаты ещё недоступны. Дождитесь завершения обработки.');
    if(outputBlobs.some(blob=>blob.size>128*1024*1024))throw new Error('Протокол поддерживает результат ячейки до 128 МиБ.');
    const generations=app.variants.map(v=>v.generation),sourceGeneration=app.sourceGeneration;
    const sha256=await hashBlob(source.file);
    const outputHashes=[];
    for(const blob of outputBlobs)outputHashes.push(await hashBlob(blob));
    if(app.source!==source||app.sourceGeneration!==sourceGeneration||app.variants.some((v,i)=>v.generation!==generations[i])||
       visible.some((v,i)=>v.blob!==outputBlobs[i]||!deps.isVariantReady(v))||
       JSON.stringify(deps.captureComparison())!==JSON.stringify(comparison)||
       JSON.stringify(deps.getAnalysisSnapshot().settings)!==JSON.stringify(analysisSnapshot.settings)){
      throw new Error('Исходник или настройки изменились во время подготовки протокола. Повторите сохранение.');
    }
    return {version:2,kind:'image-format-lab-experiment',createdAt:report.createdAt,
      input:{...report.source,mimeType:source.file.type||'unknown',sha256},
      comparison,analysis:{settings:analysisSnapshot.settings,method:analysisSnapshot.method},
      observations:report.variants.map((observation,i)=>({...observation,sha256:outputHashes[i]})),methodology:report.methodology,
      reproducibility:{input:'SHA-256 относится к исходному файлу, а не к декодированным пикселям.',
        settings:'Сохранены настройки четырёх ячеек и текущего анализа; исходное изображение в JSON не включено.',
        results:'SHA-256 результата относится к файлу для скачивания. Байты кодеков, декодирование и время обработки могут различаться между браузерами, версиями кодеков и устройствами.'},
      environment:{browser:report.browser}};
  }

  async function saveExperimentProtocol() {
    const protocol=await experimentProtocol();
    deps.downloadBlob(new Blob([JSON.stringify(protocol,null,2)],{type:'application/json'}),'experiment-protocol.json');
  }

  return { comparisonReport, codecLabel, csvCell, saveComparisonReport, experimentProtocol, saveExperimentProtocol };
}
