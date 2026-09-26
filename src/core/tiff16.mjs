import { createPixelBuffer } from './pixel-buffer.mjs';

const MAX_PIXELS = 12_000_000;
const MAX_FILE = 256 * 1024 * 1024;
const fail = message => { throw new Error('TIFF16: ' + message); };
const fallback = () => ({fallback:true,precisionNote:'TIFF16 · чтение с понижением до 8 бит'});

function rejectsBigTiff16(bytes, view, little, page) {
  if (bytes.length < 16 || view.getUint16(4,little)!==8 || view.getUint16(6,little)!==0) return;
  const u64=at=>{
    if(at+8>bytes.length)fail('повреждённый BigTIFF.');
    const value=view.getBigUint64(at,little);
    if(value>BigInt(Number.MAX_SAFE_INTEGER))fail('слишком большой каталог BigTIFF.');
    return Number(value);
  };
  let offset=u64(8);
  for(let index=0;index<=page;index++){
    if(offset<16||offset+8>bytes.length)fail('страница BigTIFF не найдена.');
    const count=u64(offset);
    if(count>4096||offset+8+count*20+8>bytes.length)fail('повреждённый каталог BigTIFF.');
    if(index===page)for(let i=0;i<count;i++){
      const at=offset+8+i*20;
      if(view.getUint16(at,little)!==258||view.getUint16(at+2,little)!==3)continue;
      const n=u64(at+4),values=n*2,first=values<=8?at+12:u64(at+12);
      if(n>8||first+values>bytes.length)fail('повреждённая разрядность BigTIFF.');
      for(let j=0;j<n;j++)if(view.getUint16(first+j*2,little)===16)return true;
    }
    offset=u64(offset+8+count*20);
  }
}

// Exact integer samples for a documented subset of classic TIFF. Other 16-bit
// layouts fail explicitly instead of passing through the RGBA8 fallback.
export function decodeTiff16(buffer, page = 0, pako) {
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < 8 || buffer.byteLength > MAX_FILE) fail('некорректный размер файла.');
  const bytes = new Uint8Array(buffer), view = new DataView(buffer);
  const little = bytes[0] === 73 && bytes[1] === 73;
  if (!little && !(bytes[0] === 77 && bytes[1] === 77)) return null;
  const u16 = at => { if (at < 0 || at + 2 > bytes.length) fail('повреждённый каталог.'); return view.getUint16(at, little); };
  const u32 = at => { if (at < 0 || at + 4 > bytes.length) fail('повреждённый каталог.'); return view.getUint32(at, little); };
  if (u16(2) === 43) return rejectsBigTiff16(bytes,view,little,page)?fallback():null;
  if (u16(2) !== 42) return null;
  if (!Number.isInteger(page) || page < 0 || page > 255) fail('некорректный номер страницы.');
  let offset = u32(4), count = 0;
  while (count++ < page) {
    if (offset < 8 || offset + 2 > bytes.length) fail('страница не найдена.');
    const entries = u16(offset);
    if (entries > 4096 || offset + 2 + entries * 12 + 4 > bytes.length) fail('повреждённый каталог.');
    offset = u32(offset + 2 + entries * 12);
  }
  if (offset < 8 || offset + 2 > bytes.length) fail('страница не найдена.');
  const entries = u16(offset), tags = new Map();
  if (entries > 4096 || offset + 2 + entries * 12 + 4 > bytes.length) fail('повреждённый каталог.');
  for (let i = 0; i < entries; i++) {
    const at = offset + 2 + i * 12, tag = u16(at), type = u16(at + 2), n = u32(at + 4);
    if (![3, 4].includes(type) || n > 4096) continue;
    const size = n * (type === 3 ? 2 : 4), first = size <= 4 ? at + 8 : u32(at + 8);
    if (first + size > bytes.length) fail('поле выходит за пределы файла.');
    tags.set(tag, Array.from({ length: n }, (_, j) => type === 3 ? u16(first + 2 * j) : u32(first + 4 * j)));
  }
  const get = (tag, fallback) => tags.get(tag)?.[0] ?? fallback;
  const depths = tags.get(258) || [1];
  if (!depths.includes(16)) return null;
  if (depths.some(depth => depth !== 16)) return fallback();
  const width = get(256, 0), height = get(257, 0), photo = get(262, 0), spp = get(277, 1);
  const compression = get(259, 1), rowsPerStrip = Math.min(height, get(278, height));
  const predictor = get(317, 1), extras = tags.get(338) || [];
  if (!width || !height) fail('некорректные размеры.');
  if(width*height>MAX_PIXELS)return fallback();
  if (![0, 1, 2].includes(photo) || spp !== (photo === 2 ? 3 : 1) + extras.length || extras.length > 1 ||
      (extras.length && extras[0] !== 2)) return fallback();
  if ((tags.get(339)||[1]).some(format=>format!==1) || get(284, 1) !== 1 || get(274, 1) !== 1 || tags.has(324)) return fallback();
  if (![1, 8, 32946, 32773].includes(compression) || ![1, 2].includes(predictor) || (predictor === 2 && ![8, 32946].includes(compression)))
    return fallback();
  if (!rowsPerStrip) fail('некорректная высота полосы.');
  const offsets = tags.get(273) || [], counts = tags.get(279) || [], strips = Math.ceil(height / rowsPerStrip);
  if (offsets.length < strips || counts.length < strips) fail('неполный список полос.');
  const data = new Uint16Array(width * height * 4), rowSamples = width * spp;
  for (let strip = 0; strip < strips; strip++) {
    const row = strip * rowsPerStrip, rowCount = Math.min(rowsPerStrip, height - row);
    const expected = rowCount * rowSamples * 2, start = offsets[strip], length = counts[strip];
    if (start + length > bytes.length) fail('полоса выходит за пределы файла.');
    const packed = bytes.subarray(start, start + length);
    let raw;
    if (compression === 1) raw = packed;
    else if (compression === 32773) {
      raw = new Uint8Array(expected);
      let src=0,dst=0;
      for (; src < packed.length && dst < expected;) {
        const code = (packed[src++] << 24) >> 24;
        if (code >= 0) { const n = code + 1; if (src + n > packed.length || dst + n > expected) fail('повреждённая PackBits-полоса.'); raw.set(packed.subarray(src, src + n), dst); src += n; dst += n; }
        else if (code !== -128) { const n = 1 - code; if (src >= packed.length || dst + n > expected) fail('повреждённая PackBits-полоса.'); raw.fill(packed[src++], dst, dst + n); dst += n; }
      }
      if(dst!==expected)fail('неполная PackBits-полоса.');
    } else {
      raw=new Uint8Array(expected);
      let position=0;
      try {
        const inflater=new pako.Inflate({chunkSize:65536});
        inflater.onData=chunk=>{
          if(position+chunk.length>expected)fail('распакованная полоса слишком велика.');
          raw.set(chunk,position);position+=chunk.length;
        };
        inflater.push(packed,true);
        if(inflater.err)fail('повреждённая Deflate-полоса.');
      } catch(error) { if(error.message?.startsWith('TIFF16:'))throw error;fail('повреждённая Deflate-полоса.'); }
      if(position!==expected)fail('неполная Deflate-полоса.');
    }
    if (raw.length !== expected) fail('размер распакованной полосы не совпадает с каталогом.');
    const scan = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    for (let y = 0; y < rowCount; y++) {
      const previous = new Uint16Array(spp);
      for (let x = 0; x < width; x++) {
        const pixel = ((row + y) * width + x) * 4;
        data[pixel + 3] = 65535;
        for (let c = 0; c < spp; c++) {
          const sampleAt = (y * rowSamples + x * spp + c) * 2;
          let value = scan.getUint16(sampleAt, little);
          if (predictor === 2 && x) value = (value + previous[c]) & 65535;
          previous[c] = value;
          if (c === 0 && photo !== 2) data[pixel] = data[pixel + 1] = data[pixel + 2] = photo === 0 ? 65535 - value : value;
          else if (c === spp - 1 && extras.length) data[pixel + 3] = value;
          else data[pixel + c] = value;
        }
      }
    }
  }
  let pages=0,cursor=u32(4);
  const seen=new Set();
  while(cursor){
    if(seen.has(cursor)||++pages>256||cursor<8||cursor+2>bytes.length)fail('повреждённая цепочка страниц.');
    seen.add(cursor);
    const n=u16(cursor);
    if(n>4096||cursor+2+n*12+4>bytes.length)fail('повреждённая цепочка страниц.');
    cursor=u32(cursor+2+n*12);
  }
  return {...createPixelBuffer({ width, height, data, sampleType: 'uint16', bitDepth: 16 }),pages};
}

export function encodeTiff16(pixels, options, pako) {
  const source = createPixelBuffer(pixels);
  if (!['uint8', 'uint16'].includes(source.sampleType) || source.alphaMode !== 'straight') fail('нужны целые независимые каналы.');
  if (source.width * source.height > MAX_PIXELS) fail('размер превышает 12 мегапикселей.');
  const compression = options.tiffCompression ?? 'deflate';
  if (!['none', 'deflate'].includes(compression)) fail('для 16 бит доступны сжатие Deflate и без сжатия.');
  const predictor = compression === 'deflate' && options.tiffPredictor !== false;
  const { width, height } = source, raw = new Uint8Array(width * height * 8), scan = new DataView(raw.buffer);
  const peak = 2 ** source.bitDepth - 1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) for (let c = 0; c < 4; c++) {
    const at = (y * width + x) * 4 + c;
    let value = source.bitDepth === 16 ? source.data[at] : Math.round(source.data[at] * 65535 / peak);
    if (predictor && x) {
      const previous = source.bitDepth === 16 ? source.data[at - 4] : Math.round(source.data[at - 4] * 65535 / peak);
      value = (value - previous + 65536) & 65535;
    }
    scan.setUint16(at * 2, value, true);
  }
  const payload = compression === 'deflate' ? pako.deflate(raw, { level: options.tiffLevel ?? 6 }) : raw;
  const tags = [
    [256, 4, 1, width], [257, 4, 1, height], [258, 3, 4, 0], [259, 3, 1, compression === 'deflate' ? 8 : 1],
    [262, 3, 1, 2], [273, 4, 1, 0], [277, 3, 1, 4], [278, 4, 1, height], [279, 4, 1, payload.length],
    [284, 3, 1, 1], ...(predictor ? [[317, 3, 1, 2]] : []), [338, 3, 1, 2]
  ];
  const bitsAt = 8 + 2 + tags.length * 12 + 4, dataAt = bitsAt + 8;
  if (dataAt + payload.length > MAX_FILE) fail('файл превышает 256 МиБ.');
  tags[2][3] = bitsAt; tags.find(tag => tag[0] === 273)[3] = dataAt;
  const result = new Uint8Array(dataAt + payload.length), view = new DataView(result.buffer);
  result.set([73, 73]); view.setUint16(2, 42, true); view.setUint32(4, 8, true); view.setUint16(8, tags.length, true);
  tags.forEach(([tag, type, count, value], i) => {
    const at = 10 + 12 * i;
    view.setUint16(at, tag, true); view.setUint16(at + 2, type, true); view.setUint32(at + 4, count, true);
    if (type === 3 && count === 1) view.setUint16(at + 8, value, true); else view.setUint32(at + 8, value, true);
  });
  for (let i = 0; i < 4; i++) view.setUint16(bitsAt + 2 * i, 16, true);
  result.set(payload, dataAt);
  return result.buffer;
}
