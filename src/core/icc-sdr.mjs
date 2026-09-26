import { createPixelBuffer } from './pixel-buffer.mjs';

const MAX_ICC_BYTES = 1024 * 1024;
const srgbFromXyzD50 = [
  [3.1338561, -1.6168667, -0.4906146],
  [-0.9787684, 1.9161415, 0.0334540],
  [0.0719453, -0.2289914, 1.4052427]
];
const tagName = (data, at) => String.fromCharCode(...data.subarray(at, at + 4));
const fixed = (view, at) => view.getInt32(at) / 65536;
const fail = detail => { throw new Error('ICC: ' + detail); };
const clamp = n => Math.max(0, Math.min(1, n));

function curve(data, at, size) {
  if (size < 12) fail('неполная кривая передачи.');
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const kind = tagName(data, at);
  if (kind === 'curv') {
    const count = view.getUint32(at + 8);
    if (count === 0) return x => x;
    if (count === 1 && size >= 14) {
      const gamma = view.getUint16(at + 12) / 256;
      if (!(gamma > 0 && gamma < 16)) fail('неверная гамма профиля.');
      return x => x ** gamma;
    }
    if (count < 2 || count > 65536 || 12 + count * 2 > size) fail('неверная таблица кривой.');
    const samples = new Uint16Array(count);
    for (let i = 0; i < count; i++) samples[i] = view.getUint16(at + 12 + i * 2);
    return x => {
      const scaled = clamp(x) * (count - 1), first = Math.floor(scaled);
      return (samples[first] + (samples[Math.min(first + 1, count - 1)] - samples[first]) * (scaled - first)) / 65535;
    };
  }
  if (kind !== 'para') fail('поддерживаются только матричные RGB-профили с кривыми curv/para.');
  const type = view.getUint16(at + 8), lengths = [1, 3, 4, 5, 7];
  if (type > 4 || size < 12 + lengths[type] * 4) fail('неподдерживаемая параметрическая кривая.');
  const p = Array.from({ length: lengths[type] }, (_, i) => fixed(view, at + 12 + i * 4));
  if (p.some(n => !Number.isFinite(n) || Math.abs(n) > 64) || p[0] <= 0 || p[0] > 16) fail('неверные параметры кривой.');
  return x => {
    x = clamp(x);
    const [g, a, b, c, d, e, f] = p;
    if (type === 0) return x ** g;
    if (a === 0) fail('неверные параметры кривой.');
    const threshold = type <= 2 ? -b / a : d;
    if (x < threshold) return type <= 1 ? 0 : type === 2 ? c : type === 3 ? c * x : c * x + f;
    const value = Math.max(0, a * x + b) ** g;
    return type <= 1 ? value : type === 2 ? value + c : type === 3 ? value : value + e;
  };
}

export function parseIccSdr(profileBytes) {
  if (!(profileBytes instanceof Uint8Array) || profileBytes.length < 132 || profileBytes.length > MAX_ICC_BYTES)
    fail('нужен профиль размером от 132 байт до 1 МиБ.');
  const data = profileBytes, view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const size = view.getUint32(0), count = view.getUint32(128);
  if (size < 132 || size > data.length || tagName(data, 36) !== 'acsp') fail('повреждён заголовок профиля.');
  if (data[8] !== 2 && data[8] !== 4) fail('поддерживаются только ICC v2/v4.');
  if (!['mntr', 'scnr', 'spac'].includes(tagName(data, 12))) fail('неподдерживаемый класс профиля.');
  if (tagName(data, 16) !== 'RGB ' || tagName(data, 20) !== 'XYZ ') fail('поддерживаются только RGB-профили с PCS XYZ.');
  if (count > 128 || 132 + count * 12 > size) fail('повреждена таблица тегов.');
  const tags = new Map();
  for (let i = 0; i < count; i++) {
    const at = 132 + i * 12, name = tagName(data, at);
    const offset = view.getUint32(at + 4), length = view.getUint32(at + 8);
    if (offset < 132 || length < 8 || offset > size - length || tags.has(name)) fail('повреждён тег профиля.');
    tags.set(name, { at: offset, size: length });
  }
  const columns = ['rXYZ', 'gXYZ', 'bXYZ'].map(name => {
    const tag = tags.get(name);
    if (!tag || tag.size < 20 || tagName(data, tag.at) !== 'XYZ ') fail('нет матрицы RGB→XYZ.');
    return [fixed(view, tag.at + 8), fixed(view, tag.at + 12), fixed(view, tag.at + 16)];
  });
  const matrix = [0, 1, 2].map(row => [0, 1, 2].map(column => columns[column][row]));
  if (matrix.flat().some(n => !Number.isFinite(n) || Math.abs(n) > 4)) fail('неверная матрица профиля.');
  const determinant = matrix[0][0] * (matrix[1][1] * matrix[2][2] - matrix[1][2] * matrix[2][1])
    - matrix[0][1] * (matrix[1][0] * matrix[2][2] - matrix[1][2] * matrix[2][0])
    + matrix[0][2] * (matrix[1][0] * matrix[2][1] - matrix[1][1] * matrix[2][0]);
  if (Math.abs(determinant) < 0.00001) fail('вырожденная матрица профиля.');
  const curves = ['rTRC', 'gTRC', 'bTRC'].map(name => {
    const tag = tags.get(name);
    if (!tag) fail('нет кривой передачи ' + name + '.');
    return curve(data, tag.at, tag.size);
  });
  return { matrix, curves };
}

function linearToSrgb(value) {
  value = clamp(value);
  return value <= 0.0031308 ? 12.92 * value : 1.055 * value ** (1 / 2.4) - 0.055;
}

export async function convertIccToSrgb(input, profileBytes) {
  const native = createPixelBuffer(input), profile = parseIccSdr(profileBytes);
  if (!['uint8', 'uint16'].includes(native.sampleType) || native.alphaMode !== 'straight')
    fail('для SDR-преобразования нужны целые RGBA с независимой альфой.');
  const peak = 2 ** native.bitDepth - 1;
  const lookup = profile.curves.map(fn => Float32Array.from({ length: peak + 1 }, (_, i) => {
    const value = fn(i / peak);
    if (!Number.isFinite(value) || value < -0.01 || value > 4) fail('неверная кривая передачи.');
    return value;
  }));
  const data = native.sampleType === 'uint16' ? new Uint16Array(native.data.length) : new Uint8ClampedArray(native.data.length);
  const [r, g, b] = profile.matrix, [sr, sg, sb] = srgbFromXyzD50;
  const coefficients = [sr, sg, sb].map(row => [0, 1, 2].map(col =>
    row[0] * r[col] + row[1] * g[col] + row[2] * b[col]));
  const [cr, cg, cb] = coefficients, rowsPerYield = Math.max(1, Math.floor(65536 / native.width));
  for (let y = 0; y < native.height; y++) {
    for (let x = 0; x < native.width; x++) {
      const at = (y * native.width + x) * 4;
      const red = native.data[at], green = native.data[at + 1], blue = native.data[at + 2];
      if (red > peak || green > peak || blue > peak) fail('отсчёт вне диапазона разрядности.');
      const lr = lookup[0][red], lg = lookup[1][green], lb = lookup[2][blue];
      data[at] = Math.round(peak * linearToSrgb(cr[0] * lr + cr[1] * lg + cr[2] * lb));
      data[at + 1] = Math.round(peak * linearToSrgb(cg[0] * lr + cg[1] * lg + cg[2] * lb));
      data[at + 2] = Math.round(peak * linearToSrgb(cb[0] * lr + cb[1] * lg + cb[2] * lb));
      data[at + 3] = native.data[at + 3];
    }
    if ((y + 1) % rowsPerYield === 0) await new Promise(resolve => setTimeout(resolve, 0));
  }
  return createPixelBuffer({ ...native, data, colorSpace: 'srgb' });
}

export async function prepareIccSdr(input, profileBytes) {
  const raw = createPixelBuffer(input);
  if (!profileBytes) return { pixelBuffer: raw, nativePixelBuffer: null, iccProfile: null };
  if (!(profileBytes instanceof Uint8Array)) fail('неверный тип профиля.');
  const iccProfile = profileBytes.slice();
  const managed = await convertIccToSrgb(raw, iccProfile);
  return { pixelBuffer: managed, nativePixelBuffer: raw, iccProfile };
}
