import pako from '../../vendor/pako-2.1.0.min.js';

// Frozen transport dictionary d1; keep it unchanged so saved reports remain readable.
const words = 'metrics crop canvas-meta canvas-copy resize alpha-canvas alpha-white alpha-jpeg icc-p3 photo-webp jpeg png png-js png-palette png-opt webp webp-ll jxl jxl-ll jp2 j2k tiff bmp8 bmp24 bmp32 gif gifenc heic avif ico png16 tiff16 jxl16 jp2-16 png-alpha avif-alpha cmyk-tiff cmyk-jpeg photo-png photo-bmp photo-j85 photo-a85 photo-j30 photo-j60 photo-j90 photo-a73 palette32 dither32 sample16 sample-float errors scopes sample-alpha print-tiff print-jpeg metric-worker'.split(' ');
const dictionary = new TextEncoder().encode([
  ...['PASS','FAIL','INFO','SKIP'].flatMap(status => words.map(word => status + ' ' + word + ' ')),
  'IFL-D3 local RESULT OK checked paths DIFFERENCES tests= current= INCOMPLETE ENV Firefox Chrome Safari Linux mac win file web W1B1C1O1 DPR=',
  'LIB ifl pako upng utif viewer jpeg gifenc heif de265 kvazaar ems musl llvm esbuild acorn aom webp jxl jp2 brotli highway skcms nsbmp tiff zlib CODEC modern jpeg2000 upng gifenc utif heic ACTUAL',
  'SRC uint8 uint16 float32 unknown srgb straight premultiplied bitmap png-js VIEW panorama errorProfile delta viewport alpha black white standard float16 batch-running batch-idle BATCH files zip',
  'V1 ready V2 ready V3 ready V4 ready stale original source deflate libheif libjpeg libjxl libwebp openjpeg 420 422 444 0/inf H= H:f p i M= M:s/s D:b P= MAE= RMSE= mean= peak= line= SSIM= pixels= strip= waveY= levels= top= low= high= edge= TAC= over= lostK= delta= bpp= display= api= image= context= working= EVENT',
  'V b/w/h/P/a/ms;T b/P/a/n/m;H f=file,p=pixels,i=input;=control;D=fields;M s=srgb,u=unknown,p=P3;UA=OS hint'
].join('\n'));
const alphabet = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ.-:+=^!/*?&<>()[]{}@%$#';

function encode85(data) {
  const padding = (4 - data.length % 4) % 4; let output = padding + ':';
  for (let at = 0; at < data.length; at += 4) {
    let value = 0;
    for (let i = 0; i < 4; i++) value = value * 256 + (data[at + i] ?? 0);
    let word = '';
    for (let i = 0; i < 5; i++) { word = alphabet[value % 85] + word; value = Math.floor(value / 85); }
    output += word;
  }
  return output;
}
function decode85(encoded) {
  if (!/^[0-3]:/.test(encoded) || (encoded.length - 2) % 5) throw new Error('Упаковка отчёта повреждена.');
  const padding = Number(encoded[0]), output = new Uint8Array((encoded.length - 2) / 5 * 4);
  for (let at = 2; at < encoded.length; at += 5) {
    let value = 0;
    for (let i = 0; i < 5; i++) {
      const digit = alphabet.indexOf(encoded[at + i]);
      if (digit < 0) throw new Error('Упаковка отчёта повреждена.');
      value = value * 85 + digit;
    }
    if (value > 0xffffffff) throw new Error('Упаковка отчёта повреждена.');
    for (let i = 3; i >= 0; i--) { output[(at - 2) / 5 * 4 + i] = value % 256; value = Math.floor(value / 256); }
  }
  if (padding > output.length || output.subarray(output.length - padding).some(value => value !== 0)) throw new Error('Упаковка отчёта повреждена.');
  return output.subarray(0, output.length - padding);
}

// One lossless transport format, independent of codec initialization and network access.
export function packDiagnostics(text) {
  const data = pako.deflate(new TextEncoder().encode(text), { level: 9, dictionary });
  return text.split('\n').slice(0, 3).join('\n') + '\nPACK z85d1:' + encode85(data) + '\n';
}

export function unpackDiagnostics(text) {
  const match = /^PACK z85d1:([^\n]+)$/m.exec(text.replaceAll('\r\n','\n'));
  if (!match) {
    if (/^IFL-D[23] /m.test(text) && !/^PACK /m.test(text)) return text;
    throw new Error('Неизвестный формат диагностического отчёта.');
  }
  if (text.length > 8192) throw new Error('Упакованный отчёт слишком велик.');
  const input = decode85(match[1]);
  const inflater = new pako.Inflate({ chunkSize: 4096, dictionary }), chunks = [];
  let size = 0;
  inflater.onData = chunk => {
    size += chunk.length;
    if (size > 65536) throw new Error('Распакованный отчёт слишком велик.');
    chunks.push(chunk);
  };
  inflater.push(input, true);
  if (inflater.err || !inflater.ended) throw new Error('Диагностический отчёт повреждён.');
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  const result = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  if (result.split('\n').slice(0,3).join('\n') !== text.replaceAll('\r\n','\n').split('\n').slice(0,3).join('\n')) throw new Error('Заголовок отчёта не совпадает с данными.');
  return result;
}
