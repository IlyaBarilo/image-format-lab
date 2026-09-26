export const DEFAULT_WEBP_METHOD = 4;
export const DEFAULT_JXL_EFFORT = 5;

export function normalizeModernOptions(config = {}) {
  const webpMethod = config.webpMethod ?? DEFAULT_WEBP_METHOD;
  const jxlEffort = config.jxlEffort ?? DEFAULT_JXL_EFFORT;
  if (!Number.isInteger(webpMethod) || webpMethod < 0 || webpMethod > 6)
    throw new RangeError('Метод WebP должен быть целым числом от 0 до 6.');
  if (!Number.isInteger(jxlEffort) || jxlEffort < 1 || jxlEffort > 10)
    throw new RangeError('Усилие JPEG XL должно быть целым числом от 1 до 10.');
  return { webpMethod, jxlEffort };
}
