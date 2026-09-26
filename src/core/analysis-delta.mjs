// Own signed differences of computed scopes, MIT. No pixels or UI state are changed.
import { ANALYSIS_CHANNELS, spatialChannels, spatialCount } from './analysis-output.mjs';
import { histogramView } from './histogram-view.mjs';

export const DELTA_TYPES = Object.freeze(['histogram', 'signalHistogram', 'waveform', 'parade', 'rgbWaveform', 'ycbcrWaveform', 'ycbcrParade', 'profile']);
const clean = value => Math.abs(value) < 1e-10 ? 0 : value;

export function deltaAt(values, position) {
  const x = Math.max(0, Math.min(1, position)) * (values.length - 1);
  const low = Math.floor(x), high = Math.min(low + 1, values.length - 1);
  return values[low] + (values[high] - values[low]) * (x - low);
}

// Area-weighted resampling of column distributions on the graph's 0–100% axis.
// Normalize each original column first, so image height and group size do not bias it.
function columnWeights(sourceColumns, columns, x) {
  const left = x * sourceColumns / columns, right = (x + 1) * sourceColumns / columns;
  const weights = [];
  for (let i = Math.floor(left); i < Math.ceil(right) && i < sourceColumns; i++) {
    const overlap = Math.min(right, i + 1) - Math.max(left, i);
    if (overlap > 0) weights.push([i, overlap / (right - left)]);
  }
  return weights;
}

export function analysisDelta(items, settings) {
  const type = settings.type;
  if (!DELTA_TYPES.includes(type) || items.length !== 2 || items.some(item => !item.data)) {
    throw new Error('Для разницы нужны два готовых графика поддерживаемого вида.');
  }
  const mixedSignal = type === 'signalHistogram' && new Set(items.map(item => item.data.bitDepth || 8)).size > 1;
  const histogram = ['histogram','signalHistogram'].includes(type) ? histogramView(items, type==='signalHistogram'?'rgb':settings.channel, mixedSignal ? 256 : 65536, { allowUnknownColorSpace: true }) : null;
  const [a, b] = (histogram?.items || items).map(item => item.data), density = spatialChannels(type).length>0;
  const profileNormalized = type === 'profile' && (a.scaleMax || 255) !== (b.scaleMax || 255);
  const indices = density ? spatialChannels(type) : type==='signalHistogram'?[0,1,2]:ANALYSIS_CHANNELS[type === 'profile' ? settings.profileChannel : settings.channel];
  if (!indices) throw new Error('Неизвестный канал разницы графиков.');
  const bins = histogram ? histogram.scale.bins : type === 'profile' ? Math.max(a.bins, b.bins) : Math.max(a.columns, b.columns);
  if (!Number.isInteger(bins) || bins < 1 || bins > (histogram ? 65536 : type === 'profile' ? 1024 : 256)) throw new Error('Некорректная сетка графика.');
  const channels = indices.map(index => ({ index, values: new Float64Array(bins * (density ? 256 : 1)) }));
  if (density) {
    for (let x = 0; x < bins; x++) {
      const wa = columnWeights(a.columns, bins, x), wb = columnWeights(b.columns, bins, x);
      for (const { index, values } of channels) for (let y = 0; y < 256; y++) {
        let first = 0, second = 0;
        for (const [column, weight] of wa) first += weight * spatialCount(a,index,column,y) / a.columnPixels[column];
        for (const [column, weight] of wb) second += weight * spatialCount(b,index,column,y) / b.columnPixels[column];
        values[x * 256 + y] = clean((second - first) * 100);
      }
    }
  } else {
    for (const { index, values } of channels) for (let i = 0; i < bins; i++) {
      const t = bins === 1 ? 0 : i / (bins - 1);
      values[i] = clean(histogram
        ? (b.channels[index][i] / b.pixelCount - a.channels[index][i] / a.pixelCount) * 100
        : profileNormalized ? (deltaAt(b.channels[index].mean, t) / (b.scaleMax || 255) - deltaAt(a.channels[index].mean, t) / (a.scaleMax || 255)) * 100
        : deltaAt(b.channels[index].mean, t) - deltaAt(a.channels[index].mean, t));
    }
  }
  let maximum = 0;
  for (const { values } of channels) for (const value of values) maximum = Math.max(maximum, Math.abs(value));
  return { type, operation: 'second-minus-first', pair: items.map(item => item.cell),
    unit: type === 'profile' && !profileNormalized ? 'code-values' : 'percentage-points',
    alignment: histogram ? (mixedSignal ? 'normalized-256-groups' : histogram.scale.normalized ? 'normalized-nearest-level' : 'same-level') : density ? 'relative-column-area' : 'relative-position-linear-means',
    bins, ...(histogram ? { scale: histogram.scale, outside: indices.map(index => ({ index,
      below: ((b.underflow?.[index] || 0) / b.pixelCount - (a.underflow?.[index] || 0) / a.pixelCount) * 100,
      above: ((b.overflow?.[index] || 0) / b.pixelCount - (a.overflow?.[index] || 0) / a.pixelCount) * 100 })) } : {}),
    ...(density ? { columns: bins, rows: 256, levelAlignment: 'normalized-256-intervals' } : {}), maximum, channels };
}
