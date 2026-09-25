// Exact per-pixel line error before grouping; separate from differences of profiles.
import { analysisRegionBounds } from './analysis-region.mjs';
import { profilePoints, DEFAULT_ANALYSIS_LINE } from './line-profile.mjs';
import { comparableErrorRasters } from './error-histogram.mjs';

export function computeErrorProfile(result, reference, matte = 'white', region = null, line = DEFAULT_ANALYSIS_LINE) {
  const { current, source, currentPeak, sourcePeak, colorComparison } = comparableErrorRasters(result, reference, matte);
  const bounds = analysisRegionBounds(current.width, current.height, region), points = profilePoints(bounds, line);
  const dx = points.x1 - points.x0, dy = points.y1 - points.y0, steps = Math.max(Math.abs(dx), Math.abs(dy));
  const sampleCount = steps + 1, bins = Math.min(1024, sampleCount), counts = new Uint32Array(bins);
  const channels = Array.from({length:2},()=>({min:new Float64Array(bins).fill(100),max:new Float64Array(bins),mean:new Float64Array(bins)}));
  const sums = [new Float64Array(bins),new Float64Array(bins)], totals = [0,0];
  for (let n = 0; n < sampleCount; n++) {
    const t = steps ? n / steps : 0, x = Math.round(points.x0 + dx * t), y = Math.round(points.y0 + dy * t);
    const i = (y * current.width + x) * 4, a = current.data[i + 3], b = source.data[i + 3];
    const alphaError = Math.abs(a / currentPeak - b / sourcePeak) * 100;
    let rgbError = 0;
    for (let c = 0; c < 3; c++) {
      const ca = current.data[i + c], cb = source.data[i + c];
      const composedA = matte === 'white' ? Math.round((ca * a + currentPeak * (currentPeak - a)) / currentPeak) : Math.round(ca * a / currentPeak);
      const composedB = matte === 'white' ? Math.round((cb * b + sourcePeak * (sourcePeak - b)) / sourcePeak) : Math.round(cb * b / sourcePeak);
      rgbError = Math.max(rgbError, Math.abs(composedA / currentPeak - composedB / sourcePeak) * 100);
    }
    const bin = Math.floor(n * bins / sampleCount); counts[bin]++;
    for (const [channel, value] of [rgbError, alphaError].entries()) {
      const data = channels[channel];
      data.min[bin] = Math.min(data.min[bin], value); data.max[bin] = Math.max(data.max[bin], value);
      sums[channel][bin] += value; totals[channel] += value;
    }
  }
  channels.forEach((channel,c)=>channel.mean.forEach((_,bin)=>{channel.mean[bin]=sums[c][bin]/counts[bin];}));
  return { width: current.width, height: current.height, bounds, points, pixelCount: bounds.width*bounds.height,
    sampleCount, bins, counts, channels, means: totals.map(sum=>sum/sampleCount), matte,
    bitDepth: { result: current.bitDepth, source: source.bitDepth },
    colorSpace: { result: current.colorSpace, source: source.colorSpace }, colorComparison,
    unit: 'percent-of-full-range', metric: ['max-absolute-RGB','absolute-alpha'] };
}
