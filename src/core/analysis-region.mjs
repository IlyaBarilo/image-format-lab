// Own analysis geometry, MIT. Manual regions use thousandths; viewport crops use exact pixel bounds.
export function analysisBounds(imageData, region = null) {
  const { width, height, data } = imageData || {};
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 ||
      width * height > 40000000 || !(data instanceof Uint8Array || data instanceof Uint8ClampedArray) ||
      data.length !== width * height * 4) throw new Error('Некорректные пиксели для анализа.');
  if (region == null) return { x: 0, y: 0, width, height };
  if (region.unit === 'pixels') {
    const { x, y, width: w, height: h } = region;
    if (![x,y,w,h].every(Number.isInteger) || x < 0 || y < 0 || w < 1 || h < 1 || x + w > width || y + h > height)
      throw new Error('Некорректная область анализа в пикселях.');
    return { x, y, width: w, height: h };
  }
  const { x0, y0, x1, y1 } = region;
  if (![x0,y0,x1,y1].every(Number.isInteger) || x0 < 0 || y0 < 0 || x1 > 1000 || y1 > 1000 || x0 >= x1 || y0 >= y1)
    throw new Error('Некорректная область анализа.');
  const x = Math.floor(x0 * width / 1000), y = Math.floor(y0 * height / 1000);
  return { x, y, width: Math.ceil(x1 * width / 1000) - x, height: Math.ceil(y1 * height / 1000) - y };
}
