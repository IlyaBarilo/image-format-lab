// Own panel sizing rules, MIT. All dimensions are CSS pixels supplied by the UI.
export const ANALYSIS_SIZES = Object.freeze({ compact: 0.35, balance: 0.6 });

export function selectAnalysisSize(state, size) {
  if (size === 'max') return state.size === 'max'
    ? { ...state, size: state.previous }
    : { ...state, previous: state.size, size: 'max' };
  if (!Object.hasOwn(ANALYSIS_SIZES, size)) throw new RangeError('Unknown analysis size');
  return { size, previous: size, ratio: null };
}

export function resolveAnalysisSplit(total, ratio, imageMinimum, panelMinimum) {
  if (![total, ratio, imageMinimum, panelMinimum].every(Number.isFinite)) throw new TypeError('Invalid split dimensions');
  const imageMin = Math.max(1, Math.ceil(imageMinimum)), panelMin = Math.max(1, Math.ceil(panelMinimum));
  const height = Math.max(Math.round(total), imageMin + panelMin);
  const panel = Math.max(panelMin, Math.min(height - imageMin, Math.round(height * ratio)));
  return { total: height, image: height - panel, panel, ratio: panel / height,
    min: panelMin / height, max: 1 - imageMin / height };
}

export function analysisSplitKey(key, ratio, shift = false) {
  const step = shift ? 0.1 : 0.02;
  if (key === 'ArrowUp') return ratio + step;
  if (key === 'ArrowDown') return ratio - step;
  if (key === 'Home') return 0;
  if (key === 'End') return 1;
  return null;
}
