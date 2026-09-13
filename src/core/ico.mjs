// PNG-backed Windows icon container. MIT, Ilya Barilo 2026.
export const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];
export function encodeIco(entries) {
  if (!entries.length || entries.length > 256) throw new Error('Некорректный набор ICO');
  const header = 6 + entries.length * 16;
  const bytes = new Uint8Array(header + entries.reduce((sum, entry) => sum + entry.png.length, 0));
  const view = new DataView(bytes.buffer);
  view.setUint16(2, 1, true); view.setUint16(4, entries.length, true);
  let offset = header;
  entries.forEach(({ size, png }, index) => {
    if (!ICO_SIZES.includes(size) || !png?.length) throw new Error('Некорректный размер ICO');
    const at = 6 + index * 16;
    view.setUint8(at, size % 256); view.setUint8(at + 1, size % 256);
    view.setUint16(at + 4, 1, true); view.setUint16(at + 6, 32, true);
    view.setUint32(at + 8, png.length, true); view.setUint32(at + 12, offset, true);
    bytes.set(png, offset); offset += png.length;
  });
  return bytes;
}
export function largestIcoPng(buffer) {
  const view = new DataView(buffer), bytes = new Uint8Array(buffer);
  if (bytes.length < 6 || view.getUint16(0, true) !== 0 || view.getUint16(2, true) !== 1) throw new Error('Некорректный ICO');
  const count = view.getUint16(4, true);
  if (!count || count > 256 || 6 + count * 16 > bytes.length) throw new Error('Некорректный каталог ICO');
  let best;
  for (let i = 0; i < count; i++) {
    const at = 6 + i * 16, width = bytes[at] || 256, height = bytes[at + 1] || 256;
    const size = view.getUint32(at + 8, true), offset = view.getUint32(at + 12, true);
    if (offset < 6 + count * 16 || size < 24 || offset + size > bytes.length) throw new Error('Данные выходят за границы ICO');
    if (view.getUint32(offset) !== 0x89504e47 || view.getUint32(offset + 4) !== 0x0d0a1a0a) continue;
    if (view.getUint32(offset + 16) !== width || view.getUint32(offset + 20) !== height) throw new Error('Размер PNG не соответствует ICO');
    if (!best || width * height > best.area) best = { area: width * height, png: bytes.slice(offset, offset + size) };
  }
  return best?.png || null;
}
