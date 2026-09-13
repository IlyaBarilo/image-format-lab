import { normalizeTiffOptions } from '../core/raster-codecs.mjs';
import { BATCH_STORAGE_KEY, FORMAT_DEFS, MATTES } from "./../core/config.mjs";

// Dependencies are bound by application.mjs after all components are constructed.
export function createBatchSettings({app}, deps) {
  function restoreBatchSettings() {
    try {
      const raw = localStorage.getItem(BATCH_STORAGE_KEY);
      if (raw === null) return;
      const saved = JSON.parse(raw);
      if (!saved || saved.version !== 1 || !saved.config || typeof saved.config !== "object" || Array.isArray(saved.config)) {
        throw new Error("invalid settings");
      }
      Object.assign(app.exportConfig, deps.normalizeBatchSettings(saved.config));
    } catch (error) {
      app.storageWarning = true;
      app.storageNotice = "Не удалось прочитать сохранённые настройки. Используются начальные значения; их можно сохранить заново.";
    }
  }
  
  function persistBatchSettings() {
    try {
      localStorage.setItem(BATCH_STORAGE_KEY, JSON.stringify({ version: 1, config: deps.normalizeBatchSettings(app.exportConfig) }));
      app.storageWarning = false;
      app.storageNotice = "Настройки сохранены в этом браузере и восстановятся после перезагрузки. Файлы в хранилище не записываются.";
    } catch (error) {
      app.storageWarning = true;
      app.storageNotice = "Браузер не разрешил сохранить настройки. Они действуют до закрытия страницы; конвертация остаётся доступной.";
    }
  }
  
  function formatUnavailableReason(format) {
    if (!Object.hasOwn(FORMAT_DEFS, format) || format === "original") return "Выберите выходной формат.";
    const def = FORMAT_DEFS[format];
    if (def.codec && !app.codecs[def.codec]) return `${def.label}: встроенный кодек пока не готов. Дождитесь запуска или нажмите «Повторить» у статуса кодеков, если произошла ошибка.`;
    if (def.native && app.support.get(def.mime) === false) return `${def.label}: кодирование недоступно в этом браузере.`;
    return "";
  }
  
  function validateExportConfig(config) {
    const unavailable = deps.formatUnavailableReason(config.format);
    if (unavailable) throw new Error(unavailable);
    const def = FORMAT_DEFS[config.format];
    if (config.format === "tiff") normalizeTiffOptions(config);
    if (config.delivery !== undefined && !["files", "zip"].includes(config.delivery)) throw new Error("Выберите способ получения результата.");
    if (config.targetKB) {
      if (!def.lossy || !Number.isInteger(Number(config.targetKB)) || Number(config.targetKB)<1 || Number(config.targetKB)>1000000) throw new Error("Бюджет должен быть целым числом от 1 до 1000000 КБ для формата с качеством.");
      if (!Number.isInteger(config.minQuality) || config.minQuality<1 || config.minQuality>config.quality) throw new Error("Минимальное качество должно быть от 1 до выбранного качества.");
    }
    if (def.lossy && (!Number.isInteger(config.quality) || config.quality < 1 || config.quality > 100)) throw new Error("Качество должно быть целым числом от 1 до 100.");
    if ((config.format === "gif" || config.format === "gifenc") && (!Number.isInteger(config.gifColors) || config.gifColors < 2 || config.gifColors > 256)) throw new Error("Количество цветов должно быть целым числом от 2 до 256.");
    if (!Object.hasOwn(MATTES, config.matte) || !["panorama", "none"].includes(config.metadataPolicy)) throw new Error("Проверьте заливку и настройки метаданных.");
    for (const key of ["resizeWidth", "resizeHeight"]) {
      const value = config[key];
      if (value === undefined || value === "" || value === "original") continue;
      if (!Number.isInteger(Number(value)) || Number(value) < 1 || Number(value) > 32768)
        throw new Error("Размеры должны быть целыми числами от 1 до 32768 пикселей или пустыми.");
    }
    return def;
  }
  
  function exportConfigDescription(config) {
    const def = FORMAT_DEFS[config.format];
    const size = config.resizeWidth || config.resizeHeight
      ? `не более ${config.resizeWidth || "∞"}×${config.resizeHeight || "∞"} px` : "исходные размеры";
    const details = def.lossy ? `, качество ${config.quality}`
      : config.format === "tiff" ? `, ${normalizeTiffOptions(config).tiffCompression === "none" ? "без сжатия" : normalizeTiffOptions(config).tiffCompression.toUpperCase() + (normalizeTiffOptions(config).tiffCompression === "deflate" ? " " + normalizeTiffOptions(config).tiffLevel : "") + (normalizeTiffOptions(config).tiffPredictor ? ", предиктор" : ", без предиктора")}`
      : config.format === "gif" || config.format === "gifenc" ? `, цветов ${config.gifColors}` : "";
    const matteNames = { white: "белая", black: "чёрная", gray: "серая", red: "красная", green: "зелёная", blue: "синяя" };
    const matte = def.alpha === "none" ? `; заливка ${matteNames[config.matte]}` : "";
    return `${def.label}${details}; ${size}${matte}; ${config.format === "jpeg" && config.metadataPolicy !== "none" ? "GPano сохраняется в JPEG" : "метаданные удаляются"}` + (config.targetKB ? `; до ${config.targetKB} КБ, качество ${config.minQuality}–${config.quality}` : "");
  }

  return { restoreBatchSettings, persistBatchSettings, formatUnavailableReason, validateExportConfig, exportConfigDescription };
}
