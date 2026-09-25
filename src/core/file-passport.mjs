import { pngHeader } from './png.mjs';
import { createPixelBuffer } from './pixel-buffer.mjs';

// Own structural readers: PNG specification and ITU-T T.81 / JFIF.
// Compressed image samples and metadata payloads are never decoded here.
export const PASSPORT_LIMITS = Object.freeze({ readBytes: 64 * 1024 * 1024, entries: 10000 });
const WINDOW = 65536;
class Incomplete extends Error {}
const fail = text => { throw new Error(text); };
const u16 = (a, p = 0) => a[p] * 256 + a[p + 1];
const u32 = (a, p = 0) => new DataView(a.buffer, a.byteOffset, a.byteLength).getUint32(p);
const ascii = a => String.fromCharCode(...a);
const starts = (a, text) => a.length >= text.length && [...text].every((c, i) => a[i] === c.charCodeAt(0));
const tiffHeader = a => starts(a, 'II\x2a\0') || starts(a, 'MM\0\x2a');
const abort = signal => { if (signal?.aborted) { const e = new Error('Чтение отменено.'); e.name = 'AbortError'; throw e; } };

function reader(blob, { signal, readBytes = PASSPORT_LIMITS.readBytes, entries = PASSPORT_LIMITS.entries }) {
  if (!Number.isSafeInteger(blob?.size) || blob.size < 0 || typeof blob.slice !== 'function') throw new TypeError('Ожидался файл или Blob.');
  if (!Number.isSafeInteger(readBytes) || readBytes < 8 || !Number.isSafeInteger(entries) || entries < 1) throw new TypeError('Некорректный лимит паспорта.');
  let base = 0, data = new Uint8Array(), loaded = 0, count = 0;
  async function bytes(offset, length) {
    abort(signal);
    if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 || offset + length > blob.size || length > WINDOW) fail('Обрезан блок или неверна его длина.');
    if (!length) return new Uint8Array();
    if (offset < base || offset + length > base + data.length) {
      const size = Math.min(WINDOW, blob.size - offset, readBytes - loaded);
      if (size < length) throw new Incomplete('Достигнут лимит чтения паспорта (64 МиБ по умолчанию).');
      const chunk = await blob.slice(offset, offset + size).arrayBuffer();
      abort(signal);
      if (chunk.byteLength !== size) fail('Не удалось прочитать запрошенный участок файла.');
      base = offset; data = new Uint8Array(chunk); loaded += size;
    }
    return data.subarray(offset - base, offset - base + length);
  }
  async function nextEntry() {
    abort(signal);
    if (++count > entries) throw new Incomplete('Слишком много блоков для паспорта.');
    if (count % 256 === 0) { await new Promise(resolve => setTimeout(resolve, 0)); abort(signal); }
  }
  // Skip entropy data in bounded chunks; only marker prefixes need inspection.
  async function findFF(offset) {
    while (offset < blob.size) {
      const available = offset >= base && offset < base + data.length ? base + data.length - offset : WINDOW;
      const part = await bytes(offset, Math.min(available, blob.size - offset));
      const found = part.indexOf(255);
      if (found >= 0) return offset + found;
      offset += part.length;
    }
    fail('В JPEG отсутствует завершающий маркер EOI.');
  }
  return { bytes, nextEntry, findFF, get loaded() { return loaded; } };
}

function checkCRC(chunk, expected) {
  let value = 0xffffffff;
  for (const byte of chunk) {
    value ^= byte;
    for (let n = 0; n < 8; n++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  }
  if (((value ^ 0xffffffff) >>> 0) !== expected) fail('Некорректная CRC в заголовке PNG.');
}

async function readPNG(r, blob, info) {
  const head = await r.bytes(0, 33), header = pngHeader(head);
  checkCRC(head.subarray(12, 29), u32(head, 29));
  Object.assign(info, { width: header.width, height: header.height, bitDepth: header.depth,
    colorType: header.type, interlace: header.interlace, paletteEntries: null,
    transparency: [4, 6].includes(header.type) ? 'alpha' : 'none', colorLabels: [] });
  let at = 33, idat = false, idatEnded = false, palette = false, ended = false;
  const seen = new Set(['IHDR']);
  while (at < blob.size) {
    await r.nextEntry();
    const block = await r.bytes(at, 8), size = u32(block), type = ascii(block.subarray(4));
    const end = at + 12 + size;
    if (size > 0x7fffffff || end > blob.size || !/^[A-Za-z]{4}$/.test(type) || (block[6] & 32)) fail('Некорректный блок PNG.');
    if (['IHDR', 'PLTE', 'tRNS', 'sRGB', 'iCCP', 'eXIf', 'gAMA', 'cHRM', 'cICP'].includes(type) && seen.has(type)) fail('Повторный блок PNG: ' + type + '.');
    if (['PLTE', 'tRNS', 'sRGB', 'iCCP', 'gAMA', 'cHRM', 'cICP'].includes(type) && idat) fail('Неверный порядок блока PNG: ' + type + '.');
    const prefix = () => r.bytes(at + 8, Math.min(size, 256));
    if (type === 'IDAT') {
      if (idatEnded || (header.type === 3 && !palette)) fail('Неверный порядок IDAT или отсутствует палитра.');
      idat = true;
    } else {
      if (idat) idatEnded = true;
      if (type === 'IEND') {
        if (size || !idat || end !== blob.size) fail('Некорректный конец PNG.');
        ended = true;
      } else if (type === 'PLTE') {
        if (![2, 3, 6].includes(header.type) || !size || size % 3 || size > 768 || (header.type === 3 && size / 3 > 2 ** header.depth)) fail('Некорректная палитра PNG.');
        palette = true; info.paletteEntries = size / 3;
      } else if (type === 'tRNS') {
        if ((header.type === 0 && size !== 2) || (header.type === 2 && size !== 6) ||
          (header.type === 3 && (!palette || !size || size > info.paletteEntries)) || ![0, 2, 3].includes(header.type)) fail('Некорректный блок прозрачности PNG.');
        info.transparency = 'tRNS';
      } else if (type === 'iCCP') {
        const p = await prefix(), zero = p.indexOf(0);
        if (zero < 1 || zero > 79 || size <= zero + 2 || p[zero + 1] !== 0) fail('Некорректный заголовок iCCP.');
        info.metadata.icc = 'present';
      } else if (type === 'eXIf') {
        if (size < 8 || !tiffHeader(await prefix())) fail('Некорректный заголовок eXIf.');
        info.metadata.exif = 'present';
      } else if (type === 'iTXt') {
        const p = await prefix(), zero = p.indexOf(0);
        if (zero < 1 || zero > 79 || size < zero + 5 || p[zero + 1] > 1 || p[zero + 2] !== 0) fail('Некорректный заголовок iTXt.');
        if (ascii(p.subarray(0, zero)) === 'XML:com.adobe.xmp') info.metadata.xmp = 'present';
      } else if (type === 'sRGB') {
        if (size !== 1 || (await prefix())[0] > 3) fail('Некорректный блок sRGB.');
        info.colorLabels.push('sRGB');
      } else if (['gAMA', 'cHRM', 'cICP'].includes(type)) {
        if (size !== { gAMA: 4, cHRM: 32, cICP: 4 }[type]) fail('Некорректный блок ' + type + '.');
        info.colorLabels.push(type);
      } else if (['acTL', 'fcTL', 'fdAT'].includes(type) || !(block[4] & 32)) {
        throw new Incomplete('Паспорт не разбирает расширение PNG: ' + type + '.');
      }
    }
    seen.add(type); at = end;
  }
  if (!ended) fail('В PNG отсутствует блок IEND.');
  if (seen.has('sRGB') && seen.has('iCCP')) info.notes.push('Одновременно объявлены sRGB и ICC; цветовое описание неоднозначно.');
}

const JPEG_MODES = {
  192: 'Базовый последовательный DCT (SOF0)', 193: 'Расширенный последовательный DCT (SOF1)',
  194: 'Прогрессивный DCT (SOF2)', 195: 'Без потерь (SOF3)',
  197: 'Дифференциальный последовательный DCT (SOF5)', 198: 'Дифференциальный прогрессивный DCT (SOF6)',
  199: 'Дифференциальный без потерь (SOF7)', 201: 'Последовательный DCT, арифметический (SOF9)',
  202: 'Прогрессивный DCT, арифметический (SOF10)', 203: 'Без потерь, арифметический (SOF11)',
  205: 'Дифференциальный DCT, арифметический (SOF13)', 206: 'Дифференциальный прогрессивный DCT, арифметический (SOF14)',
  207: 'Дифференциальный без потерь, арифметический (SOF15)'
};
function jpegColor(info, jfif, adobe) {
  const c = info.components, ids = c.map(n => n.id).join(',');
  let color = 'Не определено';
  if (c.length === 1) color = 'Серый';
  else if (c.length === 3) {
    if (jfif && adobe !== null && adobe !== 1) info.notes.push('Маркеры JFIF и Adobe расходятся; цветовая схема не определена.');
    else if ((jfif && ids === '1,2,3') || adobe === 1) color = 'YCbCr';
    else if (adobe === 0 && ids === '82,71,66') color = 'RGB';
  } else if (c.length === 4 && adobe === 0) color = 'CMYK';
  else if (c.length === 4 && adobe === 2) color = 'YCCK';
  info.colorModel = color;
  info.sampling = null;
  if (color === 'YCbCr' && c[1].h === c[2].h && c[1].v === c[2].v) {
    const ratio = `${c[0].h / c[1].h},${c[0].v / c[1].v}`;
    info.sampling = { '1,1': '4:4:4', '2,1': '4:2:2', '2,2': '4:2:0', '1,2': '4:4:0', '4,1': '4:1:1' }[ratio] || null;
  }
}

async function readJPEG(r, blob, info) {
  let at = 2, inScan = false, frame = false, ended = false, jfif = false, adobe = null, scanCount = 0, iccCount = null, escapes = 0;
  const iccParts = new Set();
  info.components = [];
  while (at < blob.size) {
    const wasScan = inScan;
    if (inScan) at = await r.findFF(at);
    if ((await r.bytes(at++, 1))[0] !== 255) fail('Неверная граница маркера JPEG.');
    let marker, fill = 0;
    do {
      if (++fill > 1024) throw new Incomplete('Слишком длинная последовательность заполнения JPEG.');
      marker = (await r.bytes(at++, 1))[0];
    } while (marker === 255);
    if (wasScan && (marker === 0 || (marker >= 208 && marker <= 215))) {
      if (++escapes % 1024 === 0) await new Promise(resolve => setTimeout(resolve, 0));
      continue;
    }
    await r.nextEntry();
    if (!marker || marker === 216 || (marker >= 208 && marker <= 215)) fail('Неожиданный маркер JPEG.');
    if (marker === 1) continue;
    inScan = false;
    if (marker === 217) {
      if (!frame || !scanCount) fail('В JPEG нет кадра или скана.');
      ended = true;
      if (at < blob.size) info.notes.push(`После EOI ещё ${blob.size - at} байт. Паспорт относится к первому JPEG, размер файла включает всё содержимое.`);
      break;
    }
    const size = u16(await r.bytes(at, 2));
    if (size < 2 || at + size > blob.size) fail('Обрезан сегмент JPEG.');
    const length = size - 2, payload = at + 2;
    if (Object.hasOwn(JPEG_MODES, marker)) {
      if (frame) throw new Incomplete('Паспорт не разбирает несколько кадров JPEG.');
      const p = await r.bytes(payload, length);
      if (length < 6 || !p[5] || length !== 6 + 3 * p[5] || !u16(p, 3)) fail('Некорректный заголовок кадра JPEG.');
      const lossless = [195, 199, 203, 207].includes(marker);
      if (marker === 192 ? p[0] !== 8 : lossless ? p[0] < 2 || p[0] > 16 : ![8, 12].includes(p[0])) fail('Некорректная разрядность JPEG.');
      const components = [];
      for (let n = 0; n < p[5]; n++) {
        const i = 6 + n * 3, c = { id: p[i], h: p[i + 1] >> 4, v: p[i + 1] & 15 };
        if (c.h < 1 || c.h > 4 || c.v < 1 || c.v > 4 || p[i + 2] > 3 || components.some(other => other.id === c.id)) fail('Некорректные компоненты JPEG.');
        components.push(c);
      }
      Object.assign(info, { width: u16(p, 3), height: u16(p, 1) || null, bitDepth: p[0], components,
        mode: JPEG_MODES[marker], progressive: [194, 198, 202, 206].includes(marker) });
      frame = true;
    } else if (marker === 218) {
      const p = await r.bytes(payload, length);
      if (!frame || length < 4 || !p[0] || p[0] > 4 || length !== 4 + 2 * p[0]) fail('Некорректный заголовок скана JPEG.');
      const ids = new Set();
      for (let n = 0; n < p[0]; n++) {
        const id = p[1 + 2 * n];
        if (ids.has(id) || !info.components.some(c => c.id === id)) fail('Неизвестный компонент скана JPEG.');
        ids.add(id);
      }
      scanCount++; inScan = true;
    } else if (marker === 220) {
      const p = await r.bytes(payload, length);
      if (!frame || length !== 2 || info.height !== null || !u16(p)) fail('Некорректная высота DNL в JPEG.');
      info.height = u16(p); inScan = wasScan;
    } else if (marker >= 224 && marker <= 239) {
      const p = await r.bytes(payload, Math.min(length, 64));
      if (marker === 224 && starts(p, 'JFIF\0')) {
        if (length < 14 || length !== 14 + 3 * p[12] * p[13]) fail('Некорректный заголовок JFIF.');
        jfif = true;
      } else if (marker === 238 && starts(p, 'Adobe')) {
        if (length !== 12) fail('Некорректный заголовок Adobe.');
        if (adobe !== null && adobe !== p[11]) throw new Incomplete('Разные цветовые метки Adobe в JPEG.');
        adobe = p[11];
      } else if (marker === 225 && starts(p, 'Exif\0\0')) {
        if (length < 14 || !tiffHeader(p.subarray(6))) fail('Некорректный заголовок EXIF в JPEG.');
        info.metadata.exif = 'present';
      } else if (marker === 225 && (starts(p, 'http://ns.adobe.com/xap/1.0/\0') || starts(p, 'http://ns.adobe.com/xmp/extension/\0'))) {
        info.metadata.xmp = 'present';
      } else if (marker === 226 && starts(p, 'ICC_PROFILE\0')) {
        info.metadata.icc = 'present';
        if (length <= 14 || !p[12] || !p[13] || p[12] > p[13] || (iccCount !== null && iccCount !== p[13]) || iccParts.has(p[12])) fail('Некорректная нумерация частей ICC в JPEG.');
        iccCount = p[13]; iccParts.add(p[12]);
      }
    }
    at += size;
  }
  if (!ended) fail('В JPEG отсутствует завершающий маркер EOI.');
  if (info.height === null) throw new Incomplete('Высота JPEG не определена: отсутствует DNL.');
  if (iccCount !== null && iccParts.size !== iccCount) info.notes.push('Обнаружены не все части ICC; профиль может быть повреждён.');
  jpegColor(info, jfif, adobe);
}

export function fileBitsPerPixel(size, width, height) {
  return Number.isSafeInteger(size) && size >= 0 && Number.isSafeInteger(width) && width > 0 && Number.isSafeInteger(height) && height > 0 && Number.isSafeInteger(width * height)
    ? size / (width * height) * 8 : null;
}

export function workingRasterInfo(pixels) {
  if (!pixels) return null;
  const p = createPixelBuffer(pixels);
  return { width: p.width, height: p.height, bitDepth: p.bitDepth, sampleType: p.sampleType,
    colorSpace: p.colorSpace, alphaMode: p.alphaMode, byteLength: p.byteLength };
}

export async function inspectFile(blob, options = {}) {
  const r = reader(blob, options);
  const info = { format: null, status: 'unsupported', width: null, height: null, bitDepth: null,
    metadata: { icc: 'unknown', exif: 'unknown', xmp: 'unknown' }, notes: [], size: blob.size, bpp: null };
  try {
    const start = await r.bytes(0, Math.min(8, blob.size));
    if (start.length === 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => start[i] === v)) info.format = 'PNG';
    else if (start[0] === 255 && start[1] === 216) info.format = 'JPEG';
    else return info;
    if (info.format === 'PNG') await readPNG(r, blob, info);
    else await readJPEG(r, blob, info);
    info.status = 'ok';
    for (const key of Object.keys(info.metadata)) if (info.metadata[key] === 'unknown') info.metadata[key] = 'absent';
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    info.status = error instanceof Incomplete ? 'partial' : 'invalid';
    info.notes.push(error.message || String(error));
  }
  info.bpp = fileBitsPerPixel(blob.size, info.width, info.height);
  info.readBytes = r.loaded;
  return info;
}
