import { normalizeTiffOptions } from './raster-codecs.mjs';
import { normalizeJpegOptions } from './jpeg-encode.mjs';
import { pngDepth, normalizePngOptions } from './png.mjs';
import { normalizeModernOptions } from './modern-options.mjs';
import { BACKGROUNDS, DEFAULT_EXPORT_CONFIG, FORMAT_DEFS, MATTES } from "./config.mjs";

export function normalizeBatchSettings(value) {
  const config = { ...DEFAULT_EXPORT_CONFIG };
  if (!value || typeof value !== "object" || Array.isArray(value)) return config;
  if (typeof value.format === "string" && Object.hasOwn(FORMAT_DEFS, value.format) && value.format !== "original") config.format = value.format;
  if (Number.isInteger(value.quality) && value.quality >= 1 && value.quality <= 100) config.quality = value.quality;
  if (Number.isInteger(value.gifColors) && value.gifColors >= 2 && value.gifColors <= 256) config.gifColors = value.gifColors;
  if (typeof value.gifDither === "boolean") config.gifDither = value.gifDither;
  if (Number.isInteger(value.bmpColors) && value.bmpColors >= 2 && value.bmpColors <= 256) config.bmpColors = value.bmpColors;
  if (['none','rle8'].includes(value.bmpCompression)) config.bmpCompression = value.bmpCompression;
  if (["auto","8","16"].includes(value.pngDepth)) config.pngDepth=value.pngDepth;
  if (['default','adaptive','none','sub','up','average','paeth'].includes(value.pngFilter)) config.pngFilter=value.pngFilter;
  if (Number.isInteger(value.pngLevel) && value.pngLevel>=1 && value.pngLevel<=9) config.pngLevel=value.pngLevel;
  if (Number.isInteger(value.webpMethod) && value.webpMethod>=0 && value.webpMethod<=6) config.webpMethod=value.webpMethod;
  if (Number.isInteger(value.jxlEffort) && value.jxlEffort>=1 && value.jxlEffort<=10) config.jxlEffort=value.jxlEffort;
  if (typeof value.matte === "string" && Object.hasOwn(MATTES, value.matte)) config.matte = value.matte;
  if (["panorama", "none"].includes(value.metadataPolicy)) config.metadataPolicy = value.metadataPolicy;
  if (["files", "zip"].includes(value.delivery)) config.delivery = value.delivery;
  if (Number.isInteger(Number(value.targetKB)) && Number(value.targetKB) >= 1 && Number(value.targetKB) <= 1000000) config.targetKB = String(Number(value.targetKB));
  if (Number.isInteger(value.minQuality) && value.minQuality >= 1 && value.minQuality <= 100) config.minQuality = value.minQuality;
  for (const key of ["resizeWidth", "resizeHeight"]) {
    const size = value[key];
    if ((typeof size === "string" || typeof size === "number") && Number.isInteger(Number(size)) && Number(size) >= 1 && Number(size) <= 32768) config[key] = String(Number(size));
  }
  if (["none", "deflate", "lzw"].includes(value.tiffCompression)) config.tiffCompression = value.tiffCompression;
  if (Number.isInteger(value.tiffLevel) && value.tiffLevel >= 1 && value.tiffLevel <= 9) config.tiffLevel = value.tiffLevel;
  if (typeof value.tiffPredictor === "boolean") config.tiffPredictor = value.tiffPredictor;
  if (['444','422','420'].includes(value.jpegSubsampling)) config.jpegSubsampling = value.jpegSubsampling;
  if (typeof value.jpegProgressive === 'boolean') config.jpegProgressive = value.jpegProgressive;
  return config;
}

export function validateComparison(value) {
  if (!value || ![2, 4].includes(value.layout) || !["checker", ...Object.keys(BACKGROUNDS)].includes(value.background)
    || (value.autoApply !== undefined && typeof value.autoApply !== "boolean") || !["panorama", "none"].includes(value.metadataPolicy)
    || !Array.isArray(value.variants) || value.variants.length !== 4) throw new Error("Некорректные настройки сравнения.");
  const variants = value.variants.map(v => {
    if (!v || !Object.hasOwn(FORMAT_DEFS, v.format) || !Number.isInteger(v.quality) || v.quality < 1 || v.quality > 100
      || !Number.isInteger(v.gifColors) || v.gifColors < 2 || v.gifColors > 256 || typeof v.gifDither !== "boolean"
      || !Object.hasOwn(MATTES, v.matte)) throw new Error("Некорректные параметры варианта.");
    const bmpColors = Object.hasOwn(v,'bmpColors') ? v.bmpColors : 256;
    const bmpCompression = Object.hasOwn(v,'bmpCompression') ? v.bmpCompression : 'none';
    if (!Number.isInteger(bmpColors) || bmpColors < 2 || bmpColors > 256 || !['none','rle8'].includes(bmpCompression))
      throw new Error('Некорректные параметры BMP.');
    return { ...(Object.hasOwn(v,'pngDepth')?{pngDepth:pngDepth(v.pngDepth)}:{}), ...(v.format === 'png' || v.format === 'pngIndexed' || ['pngFilter','pngLevel'].some(key => Object.hasOwn(v,key)) ? normalizePngOptions(v) : {}), ...(v.format === "tiff" || ["tiffCompression", "tiffLevel", "tiffPredictor"].some(key => Object.hasOwn(v, key)) ? normalizeTiffOptions(v) : {}), ...(v.format === 'jpeg' || ['jpegSubsampling','jpegProgressive'].some(key => Object.hasOwn(v,key)) ? normalizeJpegOptions(v) : {}), ...normalizeModernOptions(v), format:v.format, quality:v.quality, gifColors:v.gifColors, gifDither:v.gifDither, bmpColors, bmpCompression, matte:v.matte };
  });
  // Keep the legacy field compatible with saved/exported profiles; rendering is always automatic.
  return {layout:value.layout, background:value.background, autoApply:true, metadataPolicy:value.metadataPolicy, variants};
}

export function parseProfiles(value) {
  if (!value || value.version !== 1 || !Array.isArray(value.profiles) || value.profiles.length > 50) throw new Error("Ожидается файл наборов версии 1, не больше 50 наборов.");
  return value.profiles.map(p => {
    if (!p || typeof p.name !== "string" || !p.name.trim() || p.name.trim().length > 80) throw new Error("Некорректное название набора.");
    return {name:p.name.trim(), settings:validateComparison(p.settings)};
  });
}

export function uniqueOutputName(name, format, used) {
  let stem = (name || "image").replace(/\.[^./\\]+$/, "").replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").replace(/[. ]+$/, "").slice(0, 160) || "image";
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(stem)) stem = "_" + stem;
  const ext = FORMAT_DEFS[format].ext;
  let output = `${stem}.${ext}`, suffix = 2;
  while (used.has(output.toLowerCase())) output = `${stem} (${suffix++}).${ext}`;
  used.add(output.toLowerCase());
  return output;
}

export function outputDimensionsForConfig(config, source) {
  const bound = key => {
    if (config[key] === undefined || config[key] === "" || config[key] === "original") return Infinity;
    const value = Number(config[key]);
    if (!Number.isInteger(value) || value < 1 || value > 32768) throw new Error("Некорректный размер: задайте целое число от 1 до 32768 или оставьте поле пустым.");
    return value;
  };
  const scale = Math.min(1, bound("resizeWidth") / source.width, bound("resizeHeight") / source.height);
  return { width: Math.max(1, Math.round(source.width * scale)), height: Math.max(1, Math.round(source.height * scale)) };
}
