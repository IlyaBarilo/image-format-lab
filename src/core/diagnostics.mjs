import { createPixelBuffer } from './pixel-buffer.mjs';
import { computePixelMetrics } from './metrics.mjs';

export const DIAGNOSTIC_VERSION = 1;
export const DIAGNOSTIC_LIMIT = 4000;
export const DIAGNOSTIC_FORM = 'https://forms.yandex.ru/u/6acd565e5057b2a2063f9016/';

// Fixed codes, not exception text: paths, file names and URLs never enter a report.
export function diagnosticError(error) {
  const message = String(error?.message ?? error ?? '');
  const code = /отмен|cancel|abort/i.test(message) ? 'cancel'
    : /время|timeout|timed out/i.test(message) ? 'timeout'
    : /поддерж|support|Worker недоступен/i.test(message) ? 'unsupported'
    : /памят|memory|allocation/i.test(message) ? 'memory'
    : /размер|size|лимит|limit/i.test(message) ? 'limit'
    : /ICC|цвет|color/i.test(message) ? 'color'
    : /кодек|codec|WASM|WebAssembly/i.test(message) ? 'codec' : 'error';
  let hash = 2166136261;
  for (const character of message) hash = Math.imul(hash ^ character.codePointAt(0), 16777619) >>> 0;
  return code + ':' + hash.toString(16).padStart(8, '0');
}

export function recordDiagnosticEvent(events, kind, detail = '') {
  const allowed = ['open', 'settings', 'error', 'page', 'promise'];
  if (!allowed.includes(kind)) return;
  events.push([kind, kind === 'open' ? '' : diagnosticError(detail)]);
  if (events.length > 6) events.shift();
}

export function diagnosticPixels(depth = 8, transparent = false, size = 32) {
  const width = size, height = size, peak = 2 ** depth - 1;
  const data = depth === 16 ? new Uint16Array(width * height * 4) : new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const at = (y * width + x) * 4;
    data[at] = (x * 1973 + y * 337 + (x % 8 === 0 ? 14011 : 0)) & peak;
    data[at + 1] = (x * 1031 + y * 2017) & peak;
    data[at + 2] = (x * 607 + y * 3011) & peak;
    data[at + 3] = transparent ? [0, Math.round(peak / 3), Math.round(peak * 2 / 3), peak][x % 4] : peak;
  }
  return createPixelBuffer({ width, height, data, bitDepth: depth, sampleType: depth === 16 ? 'uint16' : 'uint8', colorSpace: 'srgb' });
}

export function diagnosticDifference(first, second) {
  const a = createPixelBuffer(first), b = createPixelBuffer(second);
  const options = { allowUnknownColorSpace: true, ...((a.sampleType === 'float32' || b.sampleType === 'float32') ? { floatPeak: 1 } : {}) };
  const metrics = computePixelMetrics(a, b, options);
  const peakA = a.sampleType === 'float32' ? 1 : 2 ** a.bitDepth - 1;
  const peakB = b.sampleType === 'float32' ? 1 : 2 ** b.bitDepth - 1;
  let changed = 0, max = 0;
  for (let i = 0; i < a.data.length; i++) {
    const delta = Math.abs(a.data[i] / peakA - b.data[i] / peakB);
    if (delta !== 0) changed++;
    max = Math.max(max, delta);
  }
  return { ...metrics, changed, max: max * 100 };
}

export async function diagnosticHash(value) {
  if (!globalThis.crypto?.subtle) return 'no-crypto';
  let bytes;
  if (value instanceof Blob) {
    if (value.size > 128 * 1024 * 1024) return 'limit';
    bytes = await value.arrayBuffer();
  } else if (ArrayBuffer.isView(value)) bytes = value;
  else bytes = new TextEncoder().encode(String(value));
  const hash = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  // A fixed 64-bit diagnostic fingerprint, not a full cryptographic equality proof.
  return btoa(String.fromCharCode(...new Uint8Array(hash).subarray(0, 8))).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
}

export async function diagnosticPixelHash(pixels) {
  if (!pixels?.data) return '-';
  const header = [pixels.width, pixels.height, pixels.sampleType, pixels.bitDepth, pixels.colorSpace, pixels.alphaMode];
  return diagnosticHash(JSON.stringify(header) + ':' + await diagnosticHash(pixels.data));
}

const number = value => value === Infinity ? 'inf' : Number.isFinite(value) ? Number(value.toFixed(5)).toString() : '-';
export function diagnosticConfig(config = {}) {
  const f = config.format;
  const keys = ['matte', 'colorMode', ...(['jpeg', 'webp', 'avif', 'heic', 'jxl', 'jp2', 'j2k'].includes(f) ? ['quality'] : []),
    ...(f === 'jpeg' ? ['jpegSubsampling', 'jpegProgressive'] : []),
    ...(f === 'png' ? ['pngDepth', 'pngFilter', 'pngLevel'] : []),
    ...(f === 'pngIndexed' || f === 'gif' || f === 'gifenc' ? ['gifColors', 'gifDither'] : []),
    ...(f === 'bmp8' ? ['bmpColors', 'bmpCompression'] : []),
    ...(f === 'tiff' ? ['tiffDepth', 'tiffCompression', 'tiffLevel', 'tiffPredictor'] : []),
    ...(f === 'webpLossless' ? ['webpMethod'] : []),
    ...(f === 'jxl' || f === 'jxlLossless' ? ['jxlEffort', 'jxlDepth'] : []),
    ...(f === 'avif' ? ['avifSpeed'] : [])];
  return [f ?? '-', ...keys.map(key => typeof config[key] === 'boolean' ? +config[key] : config[key] ?? '-')].join('/');
}

export function diagnosticLibraries(components) {
  const aliases={'viewer':'ifl','libjpeg-turbo':'jpeg','libheif':'heif','libde265':'de265','llvm-runtime':'llvm','libnsbmp':'nsbmp','libtiff':'tiff','emscripten':'ems','openjpeg':'jp2'};
  return components.map(item=>`${aliases[item.id]??item.id}=${String(item.version).replace(/^из Emscripten /,'ems/')}`);
}

export function diagnosticEnvironment(nav = globalThis.navigator, win = globalThis) {
  const ua = String(nav?.userAgent ?? '');
  const browser = /(?:Edg|Firefox|Chrome|Version)\/([0-9.]{1,24})(?![0-9.])/.exec(ua);
  const all = [...ua.matchAll(/(Edg|Firefox|Chrome|Version)\/([0-9.]{1,24})(?![0-9.])/g)];
  const chosen = all.find(item => item[1] === 'Edg') ?? all.find(item => item[1] === 'Firefox') ?? (browser && all[0]);
  const os = (/(Windows NT [0-9.]+|(?:Intel )?Mac OS X [0-9_]+|Android [0-9.]+|(?:CPU (?:iPhone )?OS) [0-9_]+|Linux)/.exec(ua)?.[0] ?? 'unknown')
    .replace(/^(?:Intel )?Mac OS X /,'mac/').replace(/^Windows NT /,'win/').replace(/^Android /,'android/').replace(/^CPU (?:iPhone )?OS /,'ios/');
  return `${chosen ? chosen[1].replace('Version', 'Safari') + '/' + chosen[2] : 'unknown'};${os};` +
    `W${+!!win.Worker}B${+!!win.createImageBitmap}C${+!!win.crypto?.subtle}O${+!!win.OffscreenCanvas};DPR=${number(win.devicePixelRatio)};${win.location?.protocol === 'file:' ? 'file' : 'web'}`;
}

export function formatDiagnostics(report) {
  const build=/^[a-f0-9]{32}$/.test(report.build??'')?btoa(String.fromCharCode(...report.build.match(/../g).map(value=>parseInt(value,16)))).replaceAll('+','-').replaceAll('/','_').replaceAll('=',''):report.build||'-';
  const lines = [`IFL-D${DIAGNOSTIC_VERSION} ${report.release || 'local'} ${build} ${report.state}`, `ENV ${report.environment}`];
  lines.push('LIB ' + report.libraries.join(';'));
  lines.push('CODEC ' + report.codecs.join(';'));
  if(report.actual?.length)lines.push('ACTUAL '+report.actual.join(';'));
  lines.push('SRC ' + report.source.join('/'));
  lines.push('VIEW ' + report.view);
  if(report.batch)lines.push('BATCH '+report.batch);
  for (const cell of report.cells) lines.push(`V${cell.index} ${cell.status} ${cell.config} | ${cell.numbers.map(number).join('/')} | ${cell.paths} | ${cell.hashes.join('/')}`);
  lines.push('V:b/w/h/P/a/ms;T:b/P/a|TAC/n/max/Hf/Hp;H=SHA256-64;white;Q85,s6,e5;*=diff');
  for (const test of report.tests) lines.push(test.error ? `${test.id} !${test.error}` : `${test.id}${test.mismatch ? '*' : ''} ${[test.bytes, test.psnr, test.alpha, test.changed, test.max].map(number).join('/')} ${test.fileHash || '-'}/${test.pixelHash || '-'}`);
  lines.push('EVENT ' + report.events.map(value => value.join(':')).join(';'));
  lines.push('RESULT ' + report.verdict);
  return lines.join('\n') + '\n';
}

export function diagnosticByteLength(text) { return new TextEncoder().encode(text).length; }
