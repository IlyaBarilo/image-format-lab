

export function detectAlpha(data) {
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] < 255) return true;
  }
  return false;
}

export function computePsnr(a, b) {
  if (!a.length || a.length !== b.length || a.length % 4) return null;
  let squaredError = 0;
  for (let i = 0; i < a.length; i += 4) {
    const alphaA = a[i + 3] / 255;
    const alphaB = b[i + 3] / 255;
    for (let c = 0; c < 3; c++) {
      // Compare every visible RGB channel on the same white background.
      const delta = (a[i + c] - 255) * alphaA - (b[i + c] - 255) * alphaB;
      squaredError += delta * delta;
    }
  }
  if (squaredError === 0) return Infinity;
  return 10 * Math.log10(255 * 255 / (squaredError / (a.length / 4 * 3)));
}

export function computeAlphaError(a, b) {
  if (!a.length || a.length !== b.length || a.length % 4) return null;
  let total = 0;
  for (let i = 3; i < a.length; i += 4) total += Math.abs(a[i] - b[i]);
  return total / (a.length / 4 * 255) * 100;
}
