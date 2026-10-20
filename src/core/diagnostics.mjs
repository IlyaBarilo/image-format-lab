import { createPixelBuffer } from './pixel-buffer.mjs';
import { computePixelMetrics } from './metrics.mjs';

export const DIAGNOSTIC_VERSION = 3;
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

export function diagnosticExceptionName(error) {
  return ['Error','TypeError','RangeError','ReferenceError','SyntaxError','SecurityError','NotSupportedError',
    'InvalidStateError','OperationError','DataError','QuotaExceededError','AbortError'].includes(error?.name) ? error.name : 'Error';
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
  const header = [pixels.width, pixels.height, pixels.sampleType, pixels.bitDepth, pixels.alphaMode];
  return diagnosticHash(JSON.stringify(header) + ':' + await diagnosticHash(pixels.data));
}

export async function diagnosticDataHash(value) {
  async function project(item) {
    if (ArrayBuffer.isView(item)) return [item.constructor.name, item.length, await diagnosticHash(item)];
    if (Array.isArray(item)) return Promise.all(item.map(project));
    if (item && typeof item === 'object') return Object.fromEntries(await Promise.all(Object.entries(item)
      .filter(([key]) => !['colorSpace', 'sourceColorSpace', 'colorComparison'].includes(key))
      .map(async ([key, child]) => [key, await project(child)])));
    return item;
  }
  return diagnosticHash(JSON.stringify(await project(value)));
}

const number = value => value === Infinity ? 'inf' : Number.isFinite(value) ? Number(value.toFixed(5)).toString() : '-';
export const diagnosticValue = value => typeof value === 'number' ? number(value) : String(value ?? '-');

export function evaluateDiagnosticTest(test, expected, informational = false) {
  test.expected = expected;
  test.differences = [];
  test.metadataDifferences = [];
  if (!test.error && !expected && !informational) test.error = 'reference-missing';
  if (!test.error && expected) {
    for (const [key, value] of Object.entries(expected)) {
      if (key === 'colors') {
        if (test.colors !== value) test.metadataDifferences.push({ key, expected: value, actual: test.colors });
      } else if (key === 'values') {
        for (const [field, target] of Object.entries(value)) {
          const actual = test.values?.[field];
          if (diagnosticValue(actual) !== diagnosticValue(target)) test.differences.push({ key: field, expected: target, actual });
        }
      } else if (diagnosticValue(test[key]) !== diagnosticValue(value)) test.differences.push({ key, expected: value, actual: test[key] });
    }
  }
  test.mismatch = test.differences.length > 0;
  test.status = test.error?.startsWith('cancel') || ['reference-missing','not-run'].includes(test.error) ? 'SKIP'
    : test.error || test.mismatch ? 'FAIL' : informational || test.metadataDifferences.length ? 'INFO' : 'PASS';
  return test;
}

const FIELD_CODES = { bytes: 'b', psnr: 'P', alpha: 'a', changed: 'n', max: 'm', fileHash: 'f', pixelHash: 'p', inputHash: 'i',
  hHist16:'g',hErrors:'e',hMap:'m',hSSIM:'s',hErrorLine:'l',hRGB:'r',hYC:'y',hWave:'w',hVector:'v',hCIE:'c',hLine:'l',hAlpha:'a',hCMYK:'k' };
const fieldCode = key => FIELD_CODES[key] ?? key;
export function diagnosticTestLine(test) {
  const prefix = `${test.status ?? (test.error || test.mismatch ? 'FAIL' : 'PASS')} ${test.id}`;
  if (test.error) return `${prefix} !${test.error}${test.phase ? ' @' + test.phase : ''}${test.exception && test.exception !== 'Error' ? '/' + test.exception : ''}`;
  // Matching control values are represented by '='; the full control is part of the identified build.
  let values;
  if (test.values) values = Object.entries(test.values).filter(([key, value]) => !/^h[A-Z]/.test(key) && (key !== 'a' || value !== 0)).map(([key, value]) => `${key}=${diagnosticValue(value)}`).join(',');
  else {
    const numbers = [test.bytes, test.psnr, test.alpha, test.changed, test.max];
    while (numbers.length > 2 && numbers.at(-1) === 0) numbers.pop();
    values = numbers.map(diagnosticValue).join('/');
  }
  const hashValues = [...['fileHash', 'pixelHash', 'inputHash'].map(key => [key, test[key], test.expected?.[key]]),
    ...Object.entries(test.values ?? {}).filter(([key]) => /^h[A-Z]/.test(key)).map(([key, value]) => [key, value, test.expected?.values?.[key]])].filter(([, value]) => value && value !== '-');
  const hashes = !hashValues.length ? '' : hashValues.every(([, value, target]) => value === target) ? 'H='
    : 'H:' + hashValues.map(([key, value, target]) => `${fieldCode(key)}${target === value ? '=' : value}`).join('/');
  const differences = test.differences?.filter(d => !/Hash$/.test(d.key) && !/^h[A-Z]/.test(d.key)).map(d => fieldCode(d.key)).join(',');
  const colors = test.colors ? test.colors === test.expected?.colors ? ' M=' : ' M:' + test.colors.replaceAll('srgb','s').replaceAll('unknown','u').replaceAll('display-p3','p') : '';
  return `${prefix} ${values}${hashes ? ' ' + hashes : ''}${differences ? ' D:' + differences : ''}${colors}`;
}
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
  const os = (/(Windows NT [0-9.]+|(?:Intel )?Mac OS X [0-9_.]+|Android [0-9.]+|(?:CPU (?:iPhone )?OS) [0-9_.]+|Linux)/.exec(ua)?.[0] ?? 'unknown')
    .replace(/^(?:Intel )?Mac OS X /,'mac/').replace(/^Windows NT /,'win/').replace(/^Android /,'android/').replace(/^CPU (?:iPhone )?OS /,'ios/');
  return `${chosen ? chosen[1].replace('Version', 'Safari') + '/' + chosen[2] : 'unknown'};${os};` +
    `W${+!!win.Worker}B${+!!win.createImageBitmap}C${+!!win.crypto?.subtle}O${+!!win.OffscreenCanvas};DPR=${number(win.devicePixelRatio)};${win.location?.protocol === 'file:' ? 'file' : 'web'}`;
}

export function formatDiagnostics(report) {
  const build=/^[a-f0-9]{32}$/.test(report.build??'')?btoa(String.fromCharCode(...report.build.match(/../g).map(value=>parseInt(value,16)))).replaceAll('+','-').replaceAll('/','_').replaceAll('=',''):report.build||'-';
  const lines = [`IFL-D${DIAGNOSTIC_VERSION} ${report.release || 'local'} ${build} ${report.state}`, `RESULT ${report.verdict}`, `ENV ${report.environment}`];
  lines.push('LIB ' + report.libraries.join(';'));
  lines.push('CODEC ' + report.codecs.join(';'));
  lines.push('ACTUAL ' + (report.actual?.length ? report.actual.join(';') : '-'));
  lines.push('SRC ' + report.source.join('/'));
  lines.push('VIEW ' + report.view);
  if(report.batch)lines.push('BATCH '+report.batch);
  for (const cell of report.cells) lines.push(`V${cell.index} ${cell.status} ${cell.config} | ${cell.numbers.map(number).join('/')} | ${cell.paths} | ${cell.hashes.join('/')}`);
  lines.push('V b/w/h/P/a/ms;T b/P/a/n/m;H f=file,p=pixels,i=input;=control;D=fields;M s=srgb,u=unknown,p=P3;UA=OS hint;LIB=build,ACTUAL=runtime');
  for (const test of report.tests) lines.push(diagnosticTestLine(test));
  for (const issue of report.issues ?? []) lines.push(`FAIL ${issue.id} ${issue.detail}`);
  lines.push('EVENT ' + report.events.map(value => value.join(':')).join(';'));
  lines.push('RESULT ' + report.verdict);
  return lines.join('\n') + '\n';
}

export function diagnosticByteLength(text) { return new TextEncoder().encode(text).length; }
