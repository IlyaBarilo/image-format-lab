// Histogram presentation and alignment. Original counts are never modified.
const format = value => value.toLocaleString('ru-RU', { maximumSignificantDigits: 6 });
export function histogramScale(data, channel = 'rgb') {
  const scale = data.scale || { kind: 'integer', min: 0, max: 255, bins: 256, alphaMax: 255, white: 255 };
  return { ...scale, min: channel === 'alpha' ? 0 : scale.min, max: channel === 'alpha' ? scale.alphaMax : scale.max };
}

function targetBins(sourceBins, maxBins) {
  if (!Number.isFinite(maxBins) || maxBins < 2) throw new Error('Некорректная ширина гистограммы.');
  // Preserve the familiar 256-level curve even on small screens.
  return Math.min(sourceBins, Math.max(256, Math.floor(maxBins)));
}

export function histogramView(items, channel = 'rgb', maxBins = 65536, { allowUnknownColorSpace = false } = {}) {
  const ready = items.filter(item => item.data);
  if (!ready.length) return { items, scale: null };
  const scales = ready.map(item => histogramScale(item.data, channel));
  const first = scales[0], floating = first.kind === 'float';
  const known = new Set(ready.map(item => item.data.colorSpace || 'unknown').filter(value => value !== 'unknown'));
  if (known.size > 1 || (!allowUnknownColorSpace && ready.some(item => !item.data.colorSpace || item.data.colorSpace === 'unknown'))) {
    throw new Error('Цветовые пространства гистограмм не сопоставимы.');
  }
  if (scales.some(s => s.kind !== first.kind || (floating && (s.min !== first.min || s.max !== first.max || s.bins !== first.bins || s.white !== first.white)))) {
    throw new Error('Для сравнения гистограмм нужны согласованные диапазоны, интервалы и подложка.');
  }
  if (channel !== 'alpha' && new Set(ready.map(item => item.data.matte)).size > 1) throw new Error('Подложки гистограмм должны совпадать.');
  const sourceBins = Math.max(...scales.map(s => s.bins)), bins = targetBins(sourceBins, maxBins);
  const normalized = !floating && scales.some(s => s.max !== first.max);
  const scale = { ...first, min: normalized ? 0 : first.min, max: normalized ? 1 : first.max,
    ...(normalized ? { white: 1, alphaMax: 1 } : {}),
    bins, sourceBins, normalized, grouped: bins < sourceBins };
  const viewed = items.map(item => {
    if (!item.data) return item;
    const data = item.data, count = histogramScale(data, channel).bins;
    const channels = data.channels.map(values => {
      if (count === bins && sourceBins === bins) return values;
      const grouped = new Uint32Array(bins);
      for (let i = 0; i < count; i++) {
        const aligned = floating ? i : Math.round(i * (sourceBins - 1) / (count - 1));
        grouped[Math.floor(aligned * bins / sourceBins)] += values[i];
      }
      return grouped;
    });
    return { ...item, data: { ...data, channels, viewScale: scale } };
  });
  return { items: viewed, scale };
}

export function histogramBinAt(scale, level) {
  const position = Math.max(0, Math.min(1, level / 255)), sourceBins = scale.sourceBins || scale.bins;
  const source = scale.kind === 'float' ? Math.min(sourceBins - 1, Math.floor(position * sourceBins)) : Math.round(position * (sourceBins - 1));
  return Math.floor(source * scale.bins / sourceBins);
}

export function histogramTick(scale, ratio) {
  const value = scale.min + ratio * (scale.max - scale.min);
  return format(scale.kind === 'integer' && !scale.normalized ? Math.round(value) : value);
}

export function histogramInterval(scale, level) {
  const bin = histogramBinAt(scale, level), sourceBins = scale.sourceBins || scale.bins;
  if (!scale.grouped && scale.kind === 'integer') return `Уровень ${histogramTick(scale, bin / (scale.bins - 1))}`;
  const start = Math.ceil(bin * sourceBins / scale.bins), end = Math.ceil((bin + 1) * sourceBins / scale.bins);
  const divisor = scale.kind === 'float' ? sourceBins : sourceBins - 1;
  const low = scale.min + start / divisor * (scale.max - scale.min);
  const high = scale.min + (scale.kind === 'float' ? end : end - 1) / divisor * (scale.max - scale.min);
  return scale.kind === 'float' ? `Интервал [${format(low)}; ${format(high)}${end === sourceBins ? ']' : ')'}` : `Уровни ${format(low)}–${format(high)}`;
}

export function histogramSummary(data, channel = 'rgb') {
  const scale = histogramScale(data, channel), indices = channel === 'alpha' ? [3] : channel === 'rgb' ? [0, 1, 2] : [{ r: 0, g: 1, b: 2 }[channel]];
  const outside = indices.map(c => `${['R','G','B','α'][c]}: ниже ${data.underflow?.[c] || 0}, выше ${data.overflow?.[c] || 0}`).join('; ');
  return `${scale.kind === 'float' ? 'float32' : `${data.bitDepth || 8} бит/канал`}, ${histogramTick(scale, 0)}–${histogramTick(scale, 1)}, ${scale.bins} ${scale.kind === 'float' ? 'интервалов' : 'уровней'}.` +
    (indices.some(c => data.underflow?.[c] || data.overflow?.[c]) ? ` Вне диапазона: ${outside}.` : '');
}

export function groupHistogramDelta(model, maxBins) {
  if (model.type !== 'histogram' && model.type !== 'signalHistogram') return model;
  const bins = targetBins(model.bins, maxBins);
  if (bins === model.bins) return model;
  let maximum = 0;
  const channels = model.channels.map(channel => {
    const values = new Float64Array(bins);
    channel.values.forEach((value, i) => { values[Math.floor(i * bins / model.bins)] += value; });
    for (let i = 0; i < bins; i++) if (Math.abs(values[i]) < 1e-10) values[i] = 0;
    for (const value of values) maximum = Math.max(maximum, Math.abs(value));
    return { ...channel, values };
  });
  return { ...model, channels, bins, maximum, scale: { ...model.scale, sourceBins: model.bins, bins, grouped: true } };
}
