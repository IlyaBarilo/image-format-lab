// Copyright (c) 2026 Ilya Barilo. MIT. JPEG-in-TIFF container adapters.
// JPEG entropy decoding belongs exclusively to the libjpeg-turbo bridge.
function slice(data, offset, length) {
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 || offset + length > data.length)
    throw new Error('JPEG выходит за границы TIFF');
  return data.subarray(offset, offset + length);
}
function concat(...parts) {
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  if (length > 256 * 1024 * 1024) throw new Error('JPEG больше 256 МиБ');
  const result = new Uint8Array(length); let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
}
const marker = (data, code) => data.length >= 2 && data[0] === 255 && data[1] === code;
function tableBody(tables) {
  const data = Uint8Array.from(tables);
  if (!marker(data, 216) || !marker(data.subarray(-2), 217)) throw new Error('Некорректный JPEGTables');
  return data.subarray(2, data.length - 2);
}
function segment(code, bytes) {
  return Uint8Array.from([255, code, (bytes.length + 2) >> 8, (bytes.length + 2) & 255, ...bytes]);
}
function oldJpeg(img, data, offset, length) {
  const strip = slice(data, offset, length);
  if (marker(strip, 216)) return strip;
  const interchange = img.t513?.[0], interchangeLength = img.t514?.[0];
  if (Number.isInteger(interchange) && Number.isInteger(interchangeLength)) {
    const full = slice(data, interchange, interchangeLength);
    if (marker(full, 216) && marker(full.subarray(-2), 217)) return full;
  }
  const components = img.t277?.[0] || 1;
  if (![1, 3].includes(components)) throw new Error('Неподдерживаемый старый JPEG-in-TIFF');
  const parts = [Uint8Array.of(255, 216)];
  if (img.t347) parts.push(tableBody(img.t347));
  else {
    if (!img.t519 || !img.t520 || !img.t521) throw new Error('В старом JPEG-in-TIFF отсутствуют таблицы');
    for (let c = 0; c < components; c++) {
      const q = img.t519[c] ?? img.t519[0];
      parts.push(segment(219, [c, ...slice(data, q, 64)]));
      for (const [type, tag] of [[0, img.t520], [1, img.t521]]) {
        const at = tag[c] ?? tag[0], counts = slice(data, at, 16);
        const total = counts.reduce((a,b) => a+b, 0);
        if (total > 256) throw new Error('Некорректная таблица Хаффмана в TIFF');
        parts.push(segment(196, [(type << 4) | c, ...counts, ...slice(data, at + 16, total)]));
      }
    }
  }
  const width = img.t322?.[0] || img.width;
  const height = img.t323?.[0] || Math.min(img.t278?.[0] || img.height, img.height);
  const subsampling = img.t530 || [2, 2];
  const frame = [8, height >> 8, height & 255, width >> 8, width & 255, components];
  const scan = [components];
  for (let c = 0; c < components; c++) {
    frame.push(c + 1, c === 0 && components > 1 ? (subsampling[0] << 4) | subsampling[1] : 17, c);
    scan.push(c + 1, (c << 4) | c);
  }
  parts.push(segment(192, frame));
  if (img.t515?.[0]) parts.push(segment(221, [img.t515[0] >> 8, img.t515[0] & 255]));
  if (!marker(strip, 218)) parts.push(segment(218, [...scan, 0, 63, 0]));
  parts.push(strip);
  if (!marker(strip.subarray(-2), 217)) parts.push(Uint8Array.of(255, 217));
  return concat(...parts);
}
function writeSamples(img, jpeg, target, offset) {
  const bps = img.t258?.[0] || 8, spp = img.t277?.[0] || img.t258?.length || 1;
  const width = img.t322?.[0] || img.width, rowSamples = width * spp;
  if (jpeg.width * jpeg.components !== rowSamples || jpeg.precision !== bps)
    throw new Error('Параметры JPEG не совпадают с TIFF');
  const stride = Math.ceil(rowSamples * bps / 8), size = stride * jpeg.height;
  if (offset < 0 || offset + size > target.length) throw new Error('Результат JPEG выходит за границы TIFF');
  const invert = img.t262?.[0] === 5 && jpeg.adobe;
  const max = 2 ** bps - 1;
  for (let y = 0; y < jpeg.height; y++) {
    const row = offset + y * stride;
    for (let x = 0; x < rowSamples; x++) {
      let value = jpeg.samples[y * rowSamples + x];
      if (invert) value = max - value;
      if (bps === 8) target[row + x] = value;
      else if (bps === 16) {
        target[row + x * 2 + (img.isLE ? 0 : 1)] = value & 255;
        target[row + x * 2 + (img.isLE ? 1 : 0)] = value >>> 8;
      } else {
        // TIFF pads each row to a byte boundary, including odd-width 12/14-bit strips.
        for (let bit = 0; bit < bps; bit++) {
          const at = x * bps + bit, mask = 1 << (7 - (at & 7));
          target[row + (at >> 3)] = (target[row + (at >> 3)] & ~mask) | (((value >> (bps - 1 - bit)) & 1) ? mask : 0);
        }
      }
    }
  }
  if (img.t262?.[0] === 6) img.t262[0] = 2;
}
export function installTiffJpeg(UTIF, decodeJpeg) {
  const decode = (img, bytes, target, offset) => writeSamples(img,
    decodeJpeg(bytes, [32803, 34892].includes(img.t262?.[0])), target, offset);
  UTIF.decode._decodeNewJPEG = (img, data, offset, length, target, outOffset) => {
    let bytes = slice(data, offset, length);
    if (img.t347) bytes = concat(Uint8Array.of(255, 216), tableBody(img.t347), marker(bytes, 216) ? bytes.subarray(2) : bytes);
    decode(img, bytes, target, outOffset);
  };
  UTIF.decode._decodeOldJPEG = (img, data, offset, length, target, outOffset) =>
    decode(img, oldJpeg(img, data, offset, length), target, outOffset);
}
