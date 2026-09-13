// Validate directories before UTIF allocates arrays from untrusted tag counts.
export function validateTiff(buffer) {
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < 8 || buffer.byteLength > 256 * 1024 * 1024)
    throw new Error('TIFF: пустой файл или размер более 256 МиБ');
  const data = new DataView(buffer), signature = data.getUint16(0), little = signature === 0x4949;
  if (![0x4949, 0x4d4d].includes(signature) || data.getUint16(2, little) !== 42) throw new Error('Некорректный заголовок TIFF');
  const sizes = [0,1,1,2,4,8,1,1,2,4,8,4,8], seen = new Set();
  let total = 0, values = 0;
  function directory(offset, depth) {
    if (!offset) return;
    if (depth > 16 || seen.size >= 256 || seen.has(offset) || offset < 8 || offset + 2 > buffer.byteLength)
      throw new Error('Некорректная цепочка каталогов TIFF');
    seen.add(offset);
    const count = data.getUint16(offset, little);
    total += count;
    if (count > 4096 || total > 16384 || offset + 2 + count * 12 + 4 > buffer.byteLength)
      throw new Error('Некорректный размер каталога TIFF');
    for (let i = 0; i < count; i++) {
      const entry = offset + 2 + i * 12, tag = data.getUint16(entry, little), type = data.getUint16(entry + 2, little);
      const n = data.getUint32(entry + 4, little), size = n * (sizes[type] || 0);
      values += n;
      if (values > 8 * 1024 * 1024) throw new Error('Слишком много значений полей TIFF');
      const at = size > 4 ? data.getUint32(entry + 8, little) : entry + 8;
      if (!sizes[type] || n > 4 * 1024 * 1024 || at + size > buffer.byteLength) throw new Error('Некорректное поле TIFF');
      if ([330, 34665, 34853].includes(tag)) {
        if (type !== 4 || n > 256) throw new Error('Некорректная ссылка на каталог TIFF');
        for (let j = 0; j < n; j++) directory(data.getUint32(at + j * 4, little), depth + 1);
      }
    }
    directory(data.getUint32(offset + 2 + count * 12, little), depth);
  }
  const first = data.getUint32(4, little);
  if (!first) throw new Error('TIFF не содержит изображений');
  directory(first, 0);
}

export function tiffRgba(ifd, standard) {
  const bits = ifd.t258?.[0] || 1, photo = ifd.t262?.[0] ?? 2;
  if (photo === 5 && bits !== 8) throw new Error('CMYK TIFF поддерживается с глубиной 8 бит');
  if (bits < 9 || bits === 16 || ![0,1,2].includes(photo)) return standard(ifd);
  const channels = ifd.t277?.[0] || ifd.t258.length, { width, height, data } = ifd;
  if (channels !== (photo < 2 ? 1 : 3) || ifd.t258.some(value => value !== bits))
    throw new Error('TIFF с глубиной 9–15 бит поддерживается без дополнительных каналов и с одинаковой разрядностью');
  const stride = Math.ceil(width * channels * bits / 8), max = 2 ** bits - 1;
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const out = (y * width + x) * 4;
    rgba[out + 3] = 255;
    for (let c = 0; c < channels; c++) {
      let value = 0;
      for (let b = 0; b < bits; b++) {
        const at = (x * channels + c) * bits + b;
        value = value * 2 + ((data[y * stride + (at >> 3)] >> (7 - (at & 7))) & 1);
      }
      value = Math.round(value * 255 / max);
      if (photo === 0) value = 255 - value;
      if (photo < 2) rgba[out] = rgba[out + 1] = rgba[out + 2] = value;
      else rgba[out + c] = value;
    }
  }
  return rgba;
}
