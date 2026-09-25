import { hexToRgb } from "./utils.mjs";
import { MATTES } from "./config.mjs";
import { quantizeUniform, indexWithoutDither, indexedToImageData } from './gif.mjs';

export function encodeBmp8(maxColors, compression, matteKey, source, makePreview = true) {
  if (!Number.isInteger(maxColors) || maxColors < 2 || maxColors > 256 || !['none', 'rle8'].includes(compression))
    throw new Error('Некорректные параметры BMP 8 бит.');
  const {width, height} = source;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 ||
      source.imageData?.data?.length !== width * height * 4) throw new Error('Некорректный размер BMP.');
  const matte = hexToRgb(MATTES[matteKey] || '#ffffff');
  const input = source.imageData.data;
  const opaque = new Uint8ClampedArray(input.length);
  for (let p = 0; p < input.length; p += 4) {
    const alpha = input[p + 3] / 255;
    opaque[p] = Math.round(input[p] * alpha + matte.r * (1 - alpha));
    opaque[p + 1] = Math.round(input[p + 1] * alpha + matte.g * (1 - alpha));
    opaque[p + 2] = Math.round(input[p + 2] * alpha + matte.b * (1 - alpha));
    opaque[p + 3] = 255;
  }
  const quant = quantizeUniform(opaque, maxColors, false, true);
  const indexed = indexWithoutDither(opaque, width, height, quant, false, -1);
  const palette = quant.palette;
  const rowSize = (width + 3) & ~3;
  const pixels = compression === 'rle8' ? encodeRle8(indexed, width, height) : new Uint8Array(rowSize * height);
  if (compression === 'none') for (let y = 0; y < height; y++)
    pixels.set(indexed.subarray(y * width, (y + 1) * width), (height - 1 - y) * rowSize);
  const offset = 54 + palette.length * 4;
  const fileSize = offset + pixels.length;
  if (fileSize > 0xffffffff) throw new Error('BMP превышает допустимый размер файла.');
  const bytes = new Uint8Array(fileSize), view = new DataView(bytes.buffer);
  bytes.set([0x42, 0x4d]);
  view.setUint32(2, fileSize, true);
  view.setUint32(10, offset, true);
  view.setUint32(14, 40, true);
  view.setInt32(18, width, true);
  view.setInt32(22, height, true);
  view.setUint16(26, 1, true);
  view.setUint16(28, 8, true);
  view.setUint32(30, compression === 'rle8' ? 1 : 0, true);
  view.setUint32(34, pixels.length, true);
  view.setInt32(38, 2835, true);
  view.setInt32(42, 2835, true);
  view.setUint32(46, palette.length, true);
  for (let i = 0; i < palette.length; i++) {
    const p = 54 + i * 4, color = palette[i];
    bytes[p] = color.b; bytes[p + 1] = color.g; bytes[p + 2] = color.r;
  }
  bytes.set(pixels, offset);
  return {blob: new Blob([bytes], {type:'image/bmp'}),
    previewImageData: makePreview ? indexedToImageData(indexed, palette, width, height, -1) : null};
}

function encodeRle8(indexed, width, height) {
  const bytes = [];
  for (let y = height - 1; y >= 0; y--) {
    const row = y * width;
    let x = 0;
    while (x < width) {
      let run = 1;
      while (x + run < width && run < 255 && indexed[row + x + run] === indexed[row + x]) run++;
      if (run >= 3) { bytes.push(run, indexed[row + x]); x += run; continue; }
      const start = x;
      x += run;
      while (x < width && x - start < 255) {
        let next = 1;
        while (x + next < width && next < 255 && indexed[row + x + next] === indexed[row + x]) next++;
        if (next >= 3 || x + next - start > 255) break;
        x += next;
      }
      const length = x - start;
      if (length >= 3) {
        bytes.push(0, length);
        for (let i = start; i < x; i++) bytes.push(indexed[row + i]);
        if (length & 1) bytes.push(0);
      } else for (let i = start; i < x; i++) bytes.push(1, indexed[row + i]);
    }
    if (y > 0) bytes.push(0, 0);
  }
  bytes.push(0, 1);
  return Uint8Array.from(bytes);
}

export function encodeBmp(withAlpha, matteKey, source, makePreview = true) {
  const width = source.width;
  const height = source.height;
  const input = source.imageData.data;

  if (withAlpha) {
    const headerSize = 124;
    const rowSize = width * 4;
    const pixelSize = rowSize * height;
    const fileSize = 14 + headerSize + pixelSize;
    const buffer = new ArrayBuffer(fileSize);
    const view = new DataView(buffer);
    let o = 0;

    view.setUint8(o++, 0x42);
    view.setUint8(o++, 0x4d);
    view.setUint32(o, fileSize, true); o += 4;
    view.setUint16(o, 0, true); o += 2;
    view.setUint16(o, 0, true); o += 2;
    view.setUint32(o, 14 + headerSize, true); o += 4;

    view.setUint32(o, headerSize, true); o += 4;
    view.setInt32(o, width, true); o += 4;
    view.setInt32(o, -height, true); o += 4;
    view.setUint16(o, 1, true); o += 2;
    view.setUint16(o, 32, true); o += 2;
    view.setUint32(o, 3, true); o += 4;
    view.setUint32(o, pixelSize, true); o += 4;
    view.setInt32(o, 2835, true); o += 4;
    view.setInt32(o, 2835, true); o += 4;
    view.setUint32(o, 0, true); o += 4;
    view.setUint32(o, 0, true); o += 4;
    view.setUint32(o, 0x00ff0000, true); o += 4;
    view.setUint32(o, 0x0000ff00, true); o += 4;
    view.setUint32(o, 0x000000ff, true); o += 4;
    view.setUint32(o, 0xff000000, true); o += 4;
    view.setUint32(o, 0x73524742, true); o += 4;
    for (let i = 0; i < 36; i += 4) {
      view.setUint32(o + i, 0, true);
    }
    o += 36;
    view.setUint32(o, 0, true); o += 4; // Gamma red
    view.setUint32(o, 0, true); o += 4; // Gamma green
    view.setUint32(o, 0, true); o += 4; // Gamma blue
    view.setUint32(o, 4, true); o += 4; // LCS_GM_IMAGES
    view.setUint32(o, 0, true); o += 4; // Profile offset
    view.setUint32(o, 0, true); o += 4; // Profile size
    view.setUint32(o, 0, true); o += 4; // Reserved

    const out = new Uint8Array(buffer, 14 + headerSize);
    let p = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        out[p++] = input[i + 2];
        out[p++] = input[i + 1];
        out[p++] = input[i];
        out[p++] = input[i + 3];
      }
    }

    const preview = makePreview ? new ImageData(new Uint8ClampedArray(input), width, height) : null;
    return {
      blob: new Blob([buffer], { type: "image/bmp" }),
      previewImageData: preview
    };
  }

  const matte = hexToRgb(MATTES[matteKey] || "#ffffff");
  const rowSize = Math.ceil((width * 3) / 4) * 4;
  const pixelSize = rowSize * height;
  const fileSize = 14 + 40 + pixelSize;
  const buffer = new ArrayBuffer(fileSize);
  const view = new DataView(buffer);
  let o = 0;

  view.setUint8(o++, 0x42);
  view.setUint8(o++, 0x4d);
  view.setUint32(o, fileSize, true); o += 4;
  view.setUint16(o, 0, true); o += 2;
  view.setUint16(o, 0, true); o += 2;
  view.setUint32(o, 54, true); o += 4;
  view.setUint32(o, 40, true); o += 4;
  view.setInt32(o, width, true); o += 4;
  view.setInt32(o, height, true); o += 4;
  view.setUint16(o, 1, true); o += 2;
  view.setUint16(o, 24, true); o += 2;
  view.setUint32(o, 0, true); o += 4;
  view.setUint32(o, pixelSize, true); o += 4;
  view.setInt32(o, 2835, true); o += 4;
  view.setInt32(o, 2835, true); o += 4;
  view.setUint32(o, 0, true); o += 4;
  view.setUint32(o, 0, true); o += 4;

  const out = new Uint8Array(buffer, 54);
  const preview = makePreview ? new Uint8ClampedArray(width * height * 4) : null;

  for (let y = 0; y < height; y++) {
    const rowStart = (height - 1 - y) * rowSize;
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const a = input[i + 3] / 255;
      const r = Math.round(input[i] * a + matte.r * (1 - a));
      const g = Math.round(input[i + 1] * a + matte.g * (1 - a));
      const b = Math.round(input[i + 2] * a + matte.b * (1 - a));
      const p = rowStart + x * 3;
      out[p] = b;
      out[p + 1] = g;
      out[p + 2] = r;

      const q = (y * width + x) * 4;
      if(preview) { preview[q] = r; preview[q + 1] = g; preview[q + 2] = b; preview[q + 3] = 255; }
    }
  }

  return {
    blob: new Blob([buffer], { type: "image/bmp" }),
    previewImageData: preview ? new ImageData(preview, width, height) : null
  };
}
