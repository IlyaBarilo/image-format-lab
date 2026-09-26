export const DEFAULT_WEBP_METHOD = 4;
export const DEFAULT_JXL_EFFORT = 5;
export const DEFAULT_JXL_DEPTH = 'auto';

export function normalizeModernOptions(config = {}) {
  const webpMethod = config.webpMethod ?? DEFAULT_WEBP_METHOD;
  const jxlEffort = config.jxlEffort ?? DEFAULT_JXL_EFFORT;
  const jxlDepth = config.jxlDepth ?? DEFAULT_JXL_DEPTH;
  if (!Number.isInteger(webpMethod) || webpMethod < 0 || webpMethod > 6)
    throw new RangeError('Метод WebP должен быть целым числом от 0 до 6.');
  if (!Number.isInteger(jxlEffort) || jxlEffort < 1 || jxlEffort > 10)
    throw new RangeError('Усилие JPEG XL должно быть целым числом от 1 до 10.');
  if (!['auto', '8', '16'].includes(jxlDepth))
    throw new RangeError('Разрядность JPEG XL должна быть Авто, 8 или 16 бит/канал.');
  return { webpMethod, jxlEffort, jxlDepth };
}

export function resolvedJxlDepth(option, pixels) {
  if (!['auto', '8', '16'].includes(option ?? 'auto'))
    throw new RangeError('Некорректная разрядность JPEG XL.');
  return option === '16' || (option !== '8' && pixels.sampleType === 'uint16' && pixels.bitDepth === 16) ? 16 : 8;
}
