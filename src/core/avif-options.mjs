export const DEFAULT_AVIF_SPEED = 6;

export function normalizeAvifOptions(config = {}) {
  const avifSpeed = config.avifSpeed ?? DEFAULT_AVIF_SPEED;
  if (!Number.isInteger(avifSpeed) || avifSpeed < 0 || avifSpeed > 9)
    throw new RangeError('Скорость AVIF должна быть целым числом от 0 до 9.');
  return { avifSpeed };
}
