import { FORMAT_DEFS, MATTES } from "./../core/config.mjs";
import { encodeIco, ICO_SIZES } from '../core/ico.mjs';
import { pixelBufferFromImageData } from '../core/pixels.mjs';
import { resolvedPngDepth } from '../core/png.mjs';

// Dependencies are bound by application.mjs after all components are constructed.
export function createEncode({}, deps) {
  let encodeQueue = Promise.resolve();
  
  function outputSourceForConfig(config, source) {
    const dims = deps.outputDimensionsForConfig(config, source);
    const icon = config.format === 'ico';
    if (!icon && dims.width === source.width && dims.height === source.height) return source;
    const canvas = document.createElement("canvas");
    canvas.width = icon ? 256 : dims.width;
    canvas.height = icon ? 256 : dims.height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    const scale = icon ? Math.min(1, 256 / dims.width, 256 / dims.height) : 1;
    const width = Math.max(1, Math.round(dims.width * scale)), height = Math.max(1, Math.round(dims.height * scale));
    ctx.drawImage(source.canvas, icon ? Math.floor((256 - width) / 2) : 0, icon ? Math.floor((256 - height) / 2) : 0, width, height);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    return { ...source, width: canvas.width, height: canvas.height, canvas, ctx, imageData,
      precisionNote: source.pixelBuffer?.bitDepth>8 ? `Уменьшение и кодирование по 8 бит/канал (исходник ${source.pixelBuffer.bitDepth} бит)` : source.precisionNote,
      pixelBuffer: pixelBufferFromImageData(imageData), hasAlpha: deps.detectAlpha(imageData.data) };
  }
  
  async function encodeOne(config, source) {
    if (!source) throw new Error("Исходник не загружен");
    const format = config.format;
    if (format === "original") return deps.withEncodedMeta({ blob: source.file,
      previewImageData: deps.cloneImageData(source.imageData), previewOnly: true, panoramaPreserved: Boolean(source.panorama) }, source);
    const pixels=source.pixelBuffer ?? pixelBufferFromImageData(source.imageData);
    const highDepth=pixels.bitDepth>8;
    if(format==='png') {
      const depth=resolvedPngDepth(config.pngDepth,pixels);
      const dims=deps.outputDimensionsForConfig(config,source);
      if(depth===16&&(dims.width!==source.width||dims.height!==source.height))throw new Error('PNG16 пока сохраняется только в исходном размере. Уберите уменьшение или явно выберите 8 бит на канал.');
      if(depth===16||highDepth){
        const prepared=deps.outputSourceForConfig(config,source);
        const input=prepared.pixelBuffer ?? pixelBufferFromImageData(prepared.imageData);
        return deps.withEncodedMeta({blob:await deps.encodeExactPng(input,depth),exactPng:true,
          precisionNote:depth===16?'16 бит/канал · показ 8 бит':`8 бит/канал · из ${pixels.bitDepth} бит`,panoramaPreserved:false},prepared);
      }
    }
    const outputSource = deps.outputSourceForConfig(config, source);
    if (["bmp8", "bmp24", "bmp32", "gif"].includes(format)) {
      const encoded = await deps.computeImage(format, config, outputSource);
      return deps.withEncodedMeta(encoded, outputSource);
    }
    if (format === "gifenc") return deps.withEncodedMeta(await deps.encodeGifenc(config.gifColors, outputSource), outputSource);
    if (format === "pngUpng") return deps.withEncodedMeta(await deps.encodePngUpng(outputSource), outputSource);
    if (['heic', 'avif', 'webpLossless', 'jxl', 'jxlLossless', 'tiff'].includes(format)) {
      const codec = await deps.loadOptionalCodec(format === 'tiff' ? 'utif' : ['heic', 'avif'].includes(format) ? 'heic' : 'modern');
      const blob = format==='tiff' ? await codec.encode(outputSource.imageData, config) : await codec.encode(outputSource.imageData, config.quality, format);
      return deps.withEncodedMeta({ blob, previewImageData: null, panoramaPreserved: false }, outputSource);
    }
    if (format === 'ico') {
      const entries = [];
      const dims = deps.outputDimensionsForConfig(config, source);
      for (const size of ICO_SIZES) {
        if (size === 256) {
          entries.push({ size, png: new Uint8Array(await (await deps.canvasToBlobStrict(outputSource.canvas, 'image/png')).arrayBuffer()) });
          continue;
        }
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = size;
        const ctx = canvas.getContext('2d'); ctx.imageSmoothingQuality = 'high';
        const scale = Math.min(1, size / dims.width, size / dims.height);
        const width = Math.max(1, Math.round(dims.width * scale)), height = Math.max(1, Math.round(dims.height * scale));
        ctx.drawImage(source.canvas, Math.floor((size - width) / 2), Math.floor((size - height) / 2), width, height);
        entries.push({ size, png: new Uint8Array(await (await deps.canvasToBlobStrict(canvas, 'image/png')).arrayBuffer()) });
      }
      return deps.withEncodedMeta({ blob: new Blob([encodeIco(entries)], { type: 'image/x-icon' }), previewImageData: null, panoramaPreserved: false }, outputSource);
    }
    const def = FORMAT_DEFS[format];
    const canvas = deps.prepareCanvasForFormat(def, config.matte, outputSource);
    const quality = def.lossy ? deps.clamp(config.quality / 100, 0.01, 1) : undefined;
    let blob = format === 'jpeg'
      ? await (await deps.loadOptionalCodec('utif')).encodeJpeg(
          canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height), config)
      : await deps.canvasToBlobStrict(canvas, def.mime, quality);
    let panoramaPreserved = false;
    if (format === "jpeg" && config.metadataPolicy !== "none") {
      if (source.panoramaError) throw new Error(source.panoramaError + ". Проверьте GPano или выберите удаление метаданных.");
      if (source.panorama) {
        const properties = deps.scaledPanorama(source.panorama, source.width, source.height, outputSource.width, outputSource.height);
        blob = deps.embedJpegPanorama(blob, properties);
        panoramaPreserved = true;
      }
    }
    return deps.withEncodedMeta({ blob, previewImageData: null, panoramaPreserved }, outputSource);
  }
  
  function withEncodedMeta(encoded, source) {
    return { ...encoded, sourceImageData: source.imageData, sourcePixelBuffer: source.pixelBuffer ?? pixelBufferFromImageData(source.imageData),
      precisionNote: encoded.precisionNote || (source.pixelBuffer?.bitDepth>8 ? encoded.previewOnly ? `${source.pixelBuffer.bitDepth} бит/канал · показ 8 бит` : `8 бит/канал · из ${source.pixelBuffer.bitDepth} бит` : source.precisionNote || ''),
      width: source.width, height: source.height };
  }
  
  function prepareCanvasForFormat(def, matteKey, source) {
    const canvas = document.createElement("canvas");
    canvas.width = source.width;
    canvas.height = source.height;
    const ctx = canvas.getContext("2d");
  
    if (def.alpha === "none") {
      ctx.fillStyle = MATTES[matteKey] || "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    } else {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  
    ctx.drawImage(source.canvas, 0, 0);
    return canvas;
  }
  
  function canvasToBlobStrict(canvas, type, quality) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error("кодировщик вернул пустой файл"));
          return;
        }
        if (blob.type !== type) {
          reject(new Error("этот браузер не кодирует выбранный формат"));
          return;
        }
        resolve(blob);
      }, type, quality);
    });
  }
  
  async function encodePngUpng(source) {
    const UPNG = await deps.loadOptionalCodec("upng");
    const pixels = new Uint8Array(source.imageData.data);
    const data = pixels.slice().buffer;
    const encoded = UPNG.encode([data], source.width, source.height, 0);
    const preview = deps.cloneImageData(source.imageData);
    return {
      blob: new Blob([encoded], { type: "image/png" }),
      previewImageData: preview
    };
  }
  
  async function encodeGifenc(maxColors, source) {
    const { GIFEncoder, quantize, applyPalette } = await deps.loadOptionalCodec("gifenc");
    const width = source.width;
    const height = source.height;
    const input = source.imageData.data;
    const hasAlpha = source.hasAlpha;
    const rgba = new Uint8ClampedArray(input);
  
    if (hasAlpha) {
      for (let i = 0; i < rgba.length; i += 4) {
        if (rgba[i + 3] < 128) {
          rgba[i] = 0;
          rgba[i + 1] = 0;
          rgba[i + 2] = 0;
          rgba[i + 3] = 255;
        }
      }
    }
  
    const colorCount = deps.clamp(Math.round(Number(maxColors) || 256), 2, 256);
    const quantizedCount = hasAlpha ? colorCount - 1 : colorCount;
    const palette = quantizedCount === 1
      ? deps.quantizeUniform(input, 1, hasAlpha).palette.map(({ r, g, b }) => [r, g, b])
      : quantize(rgba, quantizedCount);
    const mapped = applyPalette(rgba, palette);
    const index = hasAlpha ? new Uint8Array(mapped.length) : mapped;
    const gifPalette = hasAlpha ? [[0, 0, 0], ...palette.slice(0, 255)] : palette;
  
    if (hasAlpha) {
      for (let p = 0; p < mapped.length; p++) {
        index[p] = input[p * 4 + 3] < 128 ? 0 : mapped[p] + 1;
      }
    }
  
    const gif = GIFEncoder();
    gif.writeFrame(index, width, height, {
      palette: gifPalette,
      transparent: hasAlpha,
      transparentIndex: 0,
      dispose: hasAlpha ? 2 : -1
    });
    gif.finish();
  
    return {
      blob: new Blob([gif.bytes()], { type: "image/gif" }),
      previewImageData: null
    };
  }
  
  function staleRequest() { return new Error("Запрос устарел; используются новые параметры."); }
  
  function encodeFromSource(config, source, current = () => true) {
    const snapshot={...config};
    const task=encodeQueue.catch(()=>{}).then(async()=>{
      if(!current())throw deps.staleRequest();
      if(!snapshot.targetKB) return deps.encodeOne(snapshot,source);
      deps.validateExportConfig(snapshot);
      // Resize once; each probe starts with this same raster, never with a previous result.
      const prepared={...deps.outputSourceForConfig(snapshot,source)};
      if(source.panorama) prepared.panorama=deps.scaledPanorama(source.panorama,source.width,source.height,prepared.width,prepared.height);
      const probeConfig={...snapshot,resizeWidth:"",resizeHeight:"",targetKB:""};
      const max=snapshot.quality,min=snapshot.minQuality,step=Math.max(1,Math.ceil((max-min)/10));
      const tested=new Set();let best=null,attempts=0;
      const probe=async quality=>{
        if(tested.has(quality))return;
        if(!current())throw deps.staleRequest();
        tested.add(quality); attempts++;
        const encoded=await deps.encodeOne({...probeConfig,quality},prepared);
        if(encoded.blob.size<=Number(snapshot.targetKB)*1000 && (!best||quality>best.selectedQuality))best={...encoded,selectedQuality:quality};
        await new Promise(resolve=>setTimeout(resolve,0));
      };
      for(let quality=max;quality>=min;quality-=step)await probe(quality);
      await probe(min);
      if(best) for(let quality=Math.min(max,best.selectedQuality+step-1);quality>best.selectedQuality;quality--)await probe(quality);
      if(!current())throw deps.staleRequest();
      if(!best)throw new Error(`Не удалось уложиться в ${snapshot.targetKB} КБ при качестве ${min}–${max}. Увеличьте бюджет или явно уменьшите размеры.`);
      return {...best,attempts};
    });
    encodeQueue=task.then(()=>undefined,()=>undefined);
    return task;
  }

  return { outputSourceForConfig, encodeOne, withEncodedMeta, prepareCanvasForFormat, canvasToBlobStrict, encodePngUpng, encodeGifenc, staleRequest, encodeFromSource };
}
