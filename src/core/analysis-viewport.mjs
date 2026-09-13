// Own viewport geometry, MIT. Uses the same centered, unscaled raster placement as the viewer.
// Viewport dimensions and scale must use the same units (CSS px or backing pixels).
export function visibleAnalysisRegion(image, source, view, viewport, scale) {
  const { width, height } = image || {};
  if (![width, height, source?.width, source?.height, viewport?.width, viewport?.height, scale].every(n => Number.isFinite(n) && n > 0)
    || ![view?.centerX, view?.centerY].every(Number.isFinite)) return null;
  const cx = view.centerX - (source.width - width) / 2;
  const cy = view.centerY - (source.height - height) / 2;
  const left = Math.max(0, cx - viewport.width / (2 * scale));
  const top = Math.max(0, cy - viewport.height / (2 * scale));
  const right = Math.min(width, cx + viewport.width / (2 * scale));
  const bottom = Math.min(height, cy + viewport.height / (2 * scale));
  if (left >= right || top >= bottom) return null;
  // Include partially visible edge pixels; never quantize tiny crops to frame percentages.
  const x = Math.floor(left), y = Math.floor(top);
  return { unit: 'pixels', x, y, width: Math.ceil(right) - x, height: Math.ceil(bottom) - y };
}
