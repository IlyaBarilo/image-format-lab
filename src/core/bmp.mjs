import { hexToRgb } from "./utils.mjs";
import { MATTES } from "./config.mjs";

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
