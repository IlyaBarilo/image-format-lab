import { createPixelBuffer } from './pixel-buffer.mjs';

const MAX_FILE = 256 * 1024 * 1024;
const MAX_PIXELS = 8_000_000;
const fail = message => { throw new Error('TIFF float32: ' + message); };

// A deliberately narrow classic-TIFF reader. Unknown floating layouts fail
// instead of falling through to an 8-bit decoder and losing their values.
export function decodeTiffFloat(buffer, page = 0, pako) {
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < 8 || buffer.byteLength > MAX_FILE)
    fail('некорректный размер файла.');
  const bytes = new Uint8Array(buffer), view = new DataView(buffer);
  const little = bytes[0] === 73 && bytes[1] === 73;
  if (!little && !(bytes[0] === 77 && bytes[1] === 77)) return null;
  const u16 = at => { if (at < 0 || at + 2 > bytes.length) fail('повреждённый каталог.'); return view.getUint16(at, little); };
  const u32 = at => { if (at < 0 || at + 4 > bytes.length) fail('повреждённый каталог.'); return view.getUint32(at, little); };
  if (u16(2) !== 42) return null;
  if (!Number.isInteger(page) || page < 0 || page > 255) fail('некорректный номер страницы.');
  let offset = u32(4), pages = 0;
  const seen = new Set();
  while (offset) {
    if (seen.has(offset) || ++pages > 256 || offset < 8 || offset + 2 > bytes.length)
      fail('повреждённая цепочка страниц.');
    seen.add(offset);
    const entries = u16(offset);
    if (entries > 4096 || offset + 2 + entries * 12 + 4 > bytes.length) fail('повреждённый каталог.');
    if (pages - 1 === page) break;
    offset = u32(offset + 2 + entries * 12);
  }
  if (!offset) fail('страница не найдена.');
  const entries = u16(offset), tags = new Map();
  let hasIcc = false;
  for (let i = 0; i < entries; i++) {
    const at = offset + 2 + i * 12, tag = u16(at), type = u16(at + 2), count = u32(at + 4);
    if (tag === 34675) hasIcc = true;
    if (![3, 4].includes(type) || count > 4096) continue;
    const length = count * (type === 3 ? 2 : 4), first = length <= 4 ? at + 8 : u32(at + 8);
    if (first > bytes.length - length) fail('поле выходит за пределы файла.');
    if (tags.has(tag)) fail('повторный тег.');
    tags.set(tag, Array.from({ length: count }, (_, j) => type === 3 ? u16(first + j * 2) : u32(first + j * 4)));
  }
  const first = (tag, fallback) => tags.get(tag)?.[0] ?? fallback;
  const formats = tags.get(339) || [1];
  if (!formats.includes(3)) return null;
  const width = first(256, 0), height = first(257, 0), channels = first(277, 0);
  if (!width || !height || width * height > MAX_PIXELS) fail('размер превышает 8 мегапикселей.');
  if (hasIcc) fail('ICC-профиль float32 пока не поддерживается.');
  if (![3, 4].includes(channels) || (tags.get(258) || []).length !== channels ||
      tags.get(258).some(value => value !== 32) ||
      !(formats.length === 1 && formats[0] === 3 || formats.length === channels && formats.every(value => value === 3)) ||
      first(262, 0) !== 2 || first(284, 1) !== 1 || first(274, 1) !== 1 || tags.has(324) || tags.has(325) ||
      (channels === 4 && (tags.get(338)?.length !== 1 || tags.get(338)[0] !== 2)) ||
      (channels === 3 && tags.has(338))) fail('поддерживаются только RGB или RGBA с независимой alpha и IEEE float32.');
  const compression = first(259, 1);
  if (![1, 8, 32946].includes(compression) || first(317, 1) !== 1)
    fail('поддерживаются только несжатые и Deflate-полосы без предиктора.');
  const rowsPerStrip = first(278, height), offsets = tags.get(273) || [], counts = tags.get(279) || [];
  if (!rowsPerStrip || rowsPerStrip > height || offsets.length !== Math.ceil(height / rowsPerStrip) || counts.length !== offsets.length)
    fail('неполный список полос.');
  const data = new Float32Array(width * height * 4), preview = new Uint8ClampedArray(width * height * 4);
  const min = [Infinity, Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity, -Infinity];
  let negative = 0, aboveOne = 0;
  const visibleMin = [Infinity, Infinity, Infinity], visibleMax = [-Infinity, -Infinity, -Infinity];
  for (let strip = 0; strip < offsets.length; strip++) {
    const row = strip * rowsPerStrip, rows = Math.min(rowsPerStrip, height - row);
    const expected = rows * width * channels * 4, start = offsets[strip], length = counts[strip];
    if (start > bytes.length - length) fail('полоса выходит за пределы файла.');
    const packed = bytes.subarray(start, start + length);
    let raw;
    if (compression === 1) raw = packed;
    else {
      raw = new Uint8Array(expected);
      let position = 0;
      try {
        const inflater = new pako.Inflate({chunkSize:65536});
        inflater.onData = chunk => {
          if (position + chunk.length > expected) fail('распакованная полоса слишком велика.');
          raw.set(chunk, position); position += chunk.length;
        };
        inflater.push(packed, true);
        if (inflater.err) fail('повреждённая Deflate-полоса.');
      } catch (error) { if (error.message?.startsWith('TIFF float32:')) throw error; fail('повреждённая Deflate-полоса.'); }
      if (position !== expected) fail('неполная Deflate-полоса.');
    }
    if (raw.length !== expected) fail('размер полосы не совпадает с каталогом.');
    const scan = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    for (let y = 0; y < rows; y++) for (let x = 0; x < width; x++) {
      const source = (y * width + x) * channels, target = ((row + y) * width + x) * 4;
      for (let channel = 0; channel < 4; channel++) {
        const value = channel === 3 && channels === 3 ? 1 : scan.getFloat32((source + channel) * 4, little);
        if (!Number.isFinite(value) || channel === 3 && (value < 0 || value > 1))
          fail('неконечный отсчёт или alpha вне 0–1.');
        data[target + channel] = value;
        preview[target + channel] = Math.round(Math.max(0, Math.min(1, value)) * 255);
        min[channel] = Math.min(min[channel], value); max[channel] = Math.max(max[channel], value);
        if (channel < 3) { if (value < 0) negative++; if (value > 1) aboveOne++; }
      }
      if (data[target + 3] > 0) for (let channel = 0; channel < 3; channel++) {
        visibleMin[channel] = Math.min(visibleMin[channel], data[target + channel]);
        visibleMax[channel] = Math.max(visibleMax[channel], data[target + channel]);
      }
    }
  }
  let cursor = u32(offset + 2 + entries * 12);
  while (cursor) {
    if (seen.has(cursor) || ++pages > 256 || cursor < 8 || cursor + 2 > bytes.length)
      fail('повреждённая цепочка страниц.');
    seen.add(cursor);
    const count = u16(cursor);
    if (count > 4096 || cursor + 2 + count * 12 + 4 > bytes.length)
      fail('повреждённая цепочка страниц.');
    cursor = u32(cursor + 2 + count * 12);
  }
  return { pixels: createPixelBuffer({width, height, data, sampleType:'float32', bitDepth:32,
      colorSpace:'unknown', alphaMode:'straight'}), preview, pages,
    stats:{min, max, visibleMin, visibleMax, negative, aboveOne,
      mapping:'Каналы 0–1 → 0–255; вне диапазона — обрезка. Цветовое пространство не определено.'} };
}
