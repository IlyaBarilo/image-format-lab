import { clamp } from "./utils.mjs";

export function encodeGif(maxColors, useDither, source, makePreview = true) {
  const width = source.width;
  const height = source.height;
  const input = source.imageData.data;
  const transparentIndex = source.hasAlpha ? 0 : -1;
  const colorSlots = source.hasAlpha ? clamp(maxColors - 1, 1, 255) : clamp(maxColors, 2, 256);
  const quant = quantizeUniform(input, colorSlots, source.hasAlpha);
  const palette = source.hasAlpha
    ? [{ r: 0, g: 0, b: 0 }, ...quant.palette]
    : quant.palette;
  const colorDepth = minGifColorDepth(palette.length);
  const paletteSize = 1 << colorDepth;

  while (palette.length < paletteSize) {
    palette.push({ r: 0, g: 0, b: 0 });
  }

  const indexed = useDither
    ? indexWithDither(input, width, height, quant, source.hasAlpha, transparentIndex)
    : indexWithoutDither(input, width, height, quant, source.hasAlpha, transparentIndex);

  const lzwMinCodeSize = Math.max(2, colorDepth);
  const lzwData = gifLzwEncode(indexed, lzwMinCodeSize);
  const bytes = [];

  pushAscii(bytes, "GIF89a");
  pushWord(bytes, width);
  pushWord(bytes, height);
  bytes.push(0x80 | ((colorDepth - 1) << 4) | (colorDepth - 1));
  bytes.push(0);
  bytes.push(0);

  for (const color of palette) {
    bytes.push(color.r, color.g, color.b);
  }

  if (source.hasAlpha) {
    bytes.push(0x21, 0xf9, 0x04, 0x01);
    pushWord(bytes, 0);
    bytes.push(transparentIndex, 0x00);
  }

  bytes.push(0x2c);
  pushWord(bytes, 0);
  pushWord(bytes, 0);
  pushWord(bytes, width);
  pushWord(bytes, height);
  bytes.push(0x00);
  bytes.push(lzwMinCodeSize);
  pushSubBlocks(bytes, lzwData);
  bytes.push(0x3b);

  const preview = makePreview ? indexedToImageData(indexed, palette, width, height, transparentIndex) : null;
  return {
    blob: new Blob([new Uint8Array(bytes)], { type: "image/gif" }),
    previewImageData: preview
  };
}

export function quantizeUniform(data, maxColors, hasAlpha, preferFullPalette = false) {
  maxColors = clamp(Math.round(Number(maxColors) || 1), 1, 256);
  let levels = Math.max(2, preferFullPalette ? Math.ceil(Math.cbrt(maxColors)) : Math.floor(Math.cbrt(maxColors)));
  if (!preferFullPalette) {
    while (levels ** 3 > maxColors && levels > 2) levels--;
    while ((levels + 1) ** 3 <= maxColors && levels < 8) levels++;
  }

  const bucketCount = levels ** 3;
  const sums = Array.from({ length: bucketCount }, () => ({ r: 0, g: 0, b: 0, n: 0 }));
  const step = 256 / levels;

  for (let i = 0; i < data.length; i += 4) {
    if (hasAlpha && data[i + 3] < 128) continue;
    const ri = Math.min(levels - 1, Math.floor(data[i] / step));
    const gi = Math.min(levels - 1, Math.floor(data[i + 1] / step));
    const bi = Math.min(levels - 1, Math.floor(data[i + 2] / step));
    const index = (ri * levels + gi) * levels + bi;
    const bucket = sums[index];
    bucket.r += data[i];
    bucket.g += data[i + 1];
    bucket.b += data[i + 2];
    bucket.n++;
  }

  let palette = [];
  const bucketToPalette = new Int16Array(bucketCount);
  bucketToPalette.fill(-1);

  for (let i = 0; i < sums.length; i++) {
    const bucket = sums[i];
    if (!bucket.n) continue;
    bucketToPalette[i] = palette.length;
    palette.push({
      r: Math.round(bucket.r / bucket.n),
      g: Math.round(bucket.g / bucket.n),
      b: Math.round(bucket.b / bucket.n)
    });
  }

  if (!palette.length) {
    palette.push({ r: 0, g: 0, b: 0 });
  }

  // For limits below eight, merge occupied RGB buckets with weighted median cut.
  if (palette.length > maxColors) {
    const entries = sums.map((bucket, bucketIndex) => ({ ...bucket, bucketIndex }))
      .filter((bucket) => bucket.n)
      .map((bucket) => ({ ...bucket, color: palette[bucketToPalette[bucket.bucketIndex]] }));
    const groups = [entries];
    while (groups.length < maxColors) {
      let choice = -1, channel = "r", widest = -1;
      for (let g = 0; g < groups.length; g++) {
        if (groups[g].length < 2) continue;
        for (const key of ["r", "g", "b"]) {
          const values = groups[g].map((entry) => entry.color[key]);
          const range = Math.max(...values) - Math.min(...values);
          if (range > widest) { widest = range; choice = g; channel = key; }
        }
      }
      if (choice < 0) break;
      const group = groups[choice].slice().sort((a, b) => a.color[channel] - b.color[channel]);
      const total = group.reduce((sum, entry) => sum + entry.n, 0);
      let split = 1, weight = group[0].n;
      while (split < group.length - 1 && weight < total / 2) weight += group[split++].n;
      groups.splice(choice, 1, group.slice(0, split), group.slice(split));
    }
    palette = groups.map((group, index) => {
      const count = group.reduce((sum, entry) => sum + entry.n, 0);
      for (const entry of group) bucketToPalette[entry.bucketIndex] = index;
      return Object.fromEntries(["r", "g", "b"].map((key) =>
        [key, Math.round(group.reduce((sum, entry) => sum + entry[key], 0) / count)]));
    });
  }
  return { palette, bucketToPalette, levels, step };
}

export function findPaletteIndex(r, g, b, quant) {
  const levels = quant.levels;
  const step = quant.step;
  const ri = clamp(Math.floor(r / step), 0, levels - 1);
  const gi = clamp(Math.floor(g / step), 0, levels - 1);
  const bi = clamp(Math.floor(b / step), 0, levels - 1);
  let bucket = (ri * levels + gi) * levels + bi;
  let index = quant.bucketToPalette[bucket];
  if (index >= 0) return index;

  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < quant.palette.length; i++) {
    const color = quant.palette[i];
    const dr = color.r - r;
    const dg = color.g - g;
    const db = color.b - b;
    const dist = dr * dr + dg * dg + db * db;
    if (dist < bestDist) {
      bestDist = dist;
      best = i;
    }
  }
  return best;
}

export function indexWithoutDither(data, width, height, quant, hasAlpha, transparentIndex) {
  const indexed = new Uint8Array(width * height);
  const offset = hasAlpha ? 1 : 0;
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    if (hasAlpha && data[i + 3] < 128) {
      indexed[p] = transparentIndex;
      continue;
    }
    indexed[p] = findPaletteIndex(data[i], data[i + 1], data[i + 2], quant) + offset;
  }
  return indexed;
}

export function indexWithDither(data, width, height, quant, hasAlpha, transparentIndex) {
  const indexed = new Uint8Array(width * height);
  const offset = hasAlpha ? 1 : 0;
  const work = new Float32Array(width * height * 3);

  for (let i = 0, p = 0; i < data.length; i += 4, p += 3) {
    work[p] = data[i];
    work[p + 1] = data[i + 1];
    work[p + 2] = data[i + 2];
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const pixel = y * width + x;
      const src = pixel * 4;
      const pos = pixel * 3;

      if (hasAlpha && data[src + 3] < 128) {
        indexed[pixel] = transparentIndex;
        continue;
      }

      const r = clamp(Math.round(work[pos]), 0, 255);
      const g = clamp(Math.round(work[pos + 1]), 0, 255);
      const b = clamp(Math.round(work[pos + 2]), 0, 255);
      const paletteIndex = findPaletteIndex(r, g, b, quant);
      indexed[pixel] = paletteIndex + offset;
      const color = quant.palette[paletteIndex];
      diffuse(work, width, height, x + 1, y, r - color.r, g - color.g, b - color.b, 7 / 16);
      diffuse(work, width, height, x - 1, y + 1, r - color.r, g - color.g, b - color.b, 3 / 16);
      diffuse(work, width, height, x, y + 1, r - color.r, g - color.g, b - color.b, 5 / 16);
      diffuse(work, width, height, x + 1, y + 1, r - color.r, g - color.g, b - color.b, 1 / 16);
    }
  }

  return indexed;
}

export function diffuse(work, width, height, x, y, er, eg, eb, factor) {
  if (x < 0 || y < 0 || x >= width || y >= height) return;
  const p = (y * width + x) * 3;
  work[p] += er * factor;
  work[p + 1] += eg * factor;
  work[p + 2] += eb * factor;
}

export function indexedToImageData(indexed, palette, width, height, transparentIndex) {
  const out = new Uint8ClampedArray(width * height * 4);
  for (let i = 0, p = 0; i < indexed.length; i++, p += 4) {
    const index = indexed[i];
    if (index === transparentIndex) {
      out[p] = 0;
      out[p + 1] = 0;
      out[p + 2] = 0;
      out[p + 3] = 0;
      continue;
    }
    const color = palette[index] || palette[0];
    out[p] = color.r;
    out[p + 1] = color.g;
    out[p + 2] = color.b;
    out[p + 3] = 255;
  }
  return new ImageData(out, width, height);
}

export function minGifColorDepth(count) {
  let depth = 1;
  let size = 2;
  while (size < count && depth < 8) {
    depth++;
    size <<= 1;
  }
  return Math.max(1, depth);
}

export function gifLzwEncode(indices, minCodeSize) {
  const clearCode = 1 << minCodeSize;
  const endCode = clearCode + 1;
  let codeSize = minCodeSize + 1;
  let nextCode = endCode + 1;
  let dict = new Map();
  const output = [];
  let bitBuffer = 0;
  let bitCount = 0;

  function resetDict() {
    dict = new Map();
    for (let i = 0; i < clearCode; i++) {
      dict.set(String(i), i);
    }
    codeSize = minCodeSize + 1;
    nextCode = endCode + 1;
  }

  function writeCode(code) {
    bitBuffer |= code << bitCount;
    bitCount += codeSize;
    while (bitCount >= 8) {
      output.push(bitBuffer & 0xff);
      bitBuffer >>= 8;
      bitCount -= 8;
    }
  }

  resetDict();
  writeCode(clearCode);

  let phrase = String(indices[0] ?? 0);
  for (let i = 1; i < indices.length; i++) {
    const current = indices[i];
    const combined = `${phrase},${current}`;
    if (dict.has(combined)) {
      phrase = combined;
      continue;
    }

    writeCode(dict.get(phrase));

    if (nextCode < 4096) {
      dict.set(combined, nextCode++);
      if (nextCode > (1 << codeSize) && codeSize < 12) {
        codeSize++;
      }
    } else {
      writeCode(clearCode);
      resetDict();
    }

    phrase = String(current);
  }

  writeCode(dict.get(phrase));
  // The decoder adds its final dictionary entry after reading the last phrase.
  if (nextCode === (1 << codeSize) && codeSize < 12) codeSize++;
  writeCode(endCode);

  if (bitCount > 0) {
    output.push(bitBuffer & 0xff);
  }

  return output;
}

export function pushAscii(bytes, text) {
  for (let i = 0; i < text.length; i++) bytes.push(text.charCodeAt(i));
}

export function pushWord(bytes, value) {
  bytes.push(value & 0xff, (value >> 8) & 0xff);
}

export function pushSubBlocks(bytes, data) {
  for (let i = 0; i < data.length; i += 255) {
    const chunk = data.slice(i, i + 255);
    bytes.push(chunk.length, ...chunk);
  }
  bytes.push(0);
}
