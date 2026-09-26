// Range selection for the exact float32 source histogram. No preview conversion.
const LIMIT = 2 ** 128;
export function floatHistogramRange(mode, stats, minimum, maximum) {
  if (mode === 'unit') return [0, 1];
  if (mode === 'auto') {
    const low = Math.min(0, ...(stats?.min?.slice(0, 3) || [0]));
    const high = Math.max(1, ...(stats?.max?.slice(0, 3) || [1]));
    if (!Number.isFinite(low) || !Number.isFinite(high) || low < -LIMIT || high > LIMIT ||
        !Number.isFinite(high - low)) throw new Error('Автоматический диапазон float32 недоступен.');
    return [low, high];
  }
  if (mode !== 'manual') throw new Error('Неизвестный режим диапазона float32.');
  const low = Number(minimum), high = Number(maximum);
  if (String(minimum).trim() === '' || String(maximum).trim() === '' || !Number.isFinite(low) || !Number.isFinite(high) ||
      low >= high || Math.abs(low) > LIMIT || Math.abs(high) > LIMIT || !Number.isFinite(high - low))
    throw new Error('Укажите конечные границы float32: минимум должен быть меньше максимума.');
  return [low, high];
}
