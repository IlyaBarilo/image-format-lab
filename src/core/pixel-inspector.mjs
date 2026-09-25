import { createPixelBuffer } from './pixel-buffer.mjs';

// Read four native samples, never the display canvas or an interpolated preview.
export function samplePixel(pixels, x, y) {
  const raster = createPixelBuffer(pixels);
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= raster.width || y >= raster.height) {
    throw new RangeError('Координаты пикселя вне изображения.');
  }
  const offset = (y * raster.width + x) * 4;
  const rgba = Array.from(raster.data.subarray(offset, offset + 4));
  const peak = raster.sampleType === 'float32' ? null : 2 ** raster.bitDepth - 1;
  if (rgba.some(value => !Number.isFinite(value) || (peak !== null && (value < 0 || value > peak)))) {
    throw new RangeError('Отсчёты пикселя не соответствуют указанному диапазону.');
  }
  return { x, y, rgba, peak, width: raster.width, height: raster.height,
    sampleType: raster.sampleType, bitDepth: raster.bitDepth,
    colorSpace: raster.colorSpace, alphaMode: raster.alphaMode };
}

// Signed code differences, not perceptual colour differences or composited RGB.
export function comparePixelSamples(reference, result) {
  const unavailable = reason => ({ values: null, reason, unit: null, note: '' });
  if (reference.width !== result.width || reference.height !== result.height) return unavailable('Размеры различаются; пиксели не выравниваются.');
  if (reference.x !== result.x || reference.y !== result.y) return unavailable('Координаты различаются.');
  if (reference.colorSpace !== 'unknown' && result.colorSpace !== 'unknown' && reference.colorSpace !== result.colorSpace) {
    return unavailable('Цветовые пространства различаются.');
  }
  if (reference.alphaMode !== result.alphaMode) return unavailable('Способы хранения альфа-канала различаются.');
  if (reference.peak === null || result.peak === null) return unavailable('Для float32 не задан диапазон сравнения.');
  const sameDepth = reference.bitDepth === result.bitDepth;
  const values = result.rgba.map((value, channel) => sameDepth
    ? value - reference.rgba[channel]
    : value / result.peak - reference.rgba[channel] / reference.peak);
  const note = reference.colorSpace === 'unknown' || result.colorSpace === 'unknown'
    ? 'Пространство неизвестно: Δ сравнивает только коды каналов.' : '';
  return { values, unit: sameDepth ? 'levels' : 'normalized', reason: '', note };
}

function imageOrigin({ canvas, view, source, image, scale }) {
  return {
    x: canvas.width / 2 - (view.centerX - (source.width - image.width) / 2) * scale,
    y: canvas.height / 2 - (view.centerY - (source.height - image.height) / 2) * scale
  };
}

export function pixelAtClientPoint(geometry, clientX, clientY) {
  const { rect, canvas, image, scale } = geometry;
  if (!(rect.width > 0 && rect.height > 0 && canvas.width > 0 && canvas.height > 0 && scale > 0 && Number.isFinite(scale))) return null;
  if (!Number.isFinite(clientX) || !Number.isFinite(clientY) || clientX < rect.left || clientY < rect.top || clientX >= rect.left + rect.width || clientY >= rect.top + rect.height) return null;
  const origin = imageOrigin(geometry);
  const x = Math.floor(((clientX - rect.left) * canvas.width / rect.width - origin.x) / scale);
  const y = Math.floor(((clientY - rect.top) * canvas.height / rect.height - origin.y) / scale);
  return x >= 0 && y >= 0 && x < image.width && y < image.height ? { x, y } : null;
}

export function pixelCenterInCanvas(geometry, point) {
  const origin = imageOrigin(geometry);
  return { x: origin.x + (point.x + 0.5) * geometry.scale, y: origin.y + (point.y + 0.5) * geometry.scale };
}
