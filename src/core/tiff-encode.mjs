// Flat, little-endian, 8-bit RGBA TIFF. MIT, Ilya Barilo 2026.
export function encodeTiff(imageData, deflate) {
  const { width, height, data } = imageData;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 || width * height > 40000000 || data?.length !== width * height * 4) throw new Error('Некорректный размер TIFF');
  const compressed = deflate(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
  const entries = [
    [256, 4, 1, width], [257, 4, 1, height], [258, 3, 4, 0], [259, 3, 1, 8],
    [262, 3, 1, 2], [273, 4, 1, 0], [274, 3, 1, 1], [277, 3, 1, 4],
    [278, 4, 1, height], [279, 4, 1, compressed.length], [284, 3, 1, 1],
    [338, 3, 1, 2] // Unassociated (straight) alpha, matching ImageData.
  ];
  const bits = 8 + 2 + entries.length * 12 + 4, pixels = bits + 8;
  if (compressed.length + pixels > 256 * 1024 * 1024) throw new Error('TIFF превышает 256 МиБ');
  const bytes = new Uint8Array(pixels + compressed.length), view = new DataView(bytes.buffer);
  bytes.set([73, 73]); view.setUint16(2, 42, true); view.setUint32(4, 8, true); view.setUint16(8, entries.length, true);
  entries[2][3] = bits; entries[5][3] = pixels;
  entries.forEach(([tag, type, count, value], index) => {
    const at = 10 + index * 12;
    view.setUint16(at, tag, true); view.setUint16(at + 2, type, true); view.setUint32(at + 4, count, true);
    if (type === 3 && count === 1) view.setUint16(at + 8, value, true); else view.setUint32(at + 8, value, true);
  });
  for (let i = 0; i < 4; i++) view.setUint16(bits + i * 2, 8, true);
  bytes.set(compressed, pixels);
  return bytes;
}
