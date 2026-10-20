import { DEFAULT_EXPORT_CONFIG, FORMAT_DEFS } from '../core/config.mjs';
import { diagnosticPixels, diagnosticDifference, diagnosticHash, diagnosticPixelHash, diagnosticError, diagnosticExceptionName } from '../core/diagnostics.mjs';
import { pngPreview } from '../core/png.mjs';
import { pixelBufferFromImageData } from '../core/pixels.mjs';
import { cropSourcePixels } from '../core/crop-source.mjs';
import { createIccP3Sample } from '../core/reference-samples.mjs';
import { convertIccToSrgb } from '../core/icc-sdr.mjs';
import { createCmykRaster } from '../core/cmyk.mjs';
import { diagnosticLabTasks, DIAGNOSTIC_LAB_CASES } from './diagnostic-labs.mjs';

export function diagnosticSource(pixels) {
  const preview = pngPreview(pixels);
  const imageData = new ImageData(preview.data, pixels.width, pixels.height);
  const canvas = document.createElement('canvas'); canvas.width = pixels.width; canvas.height = pixels.height;
  const ctx = canvas.getContext('2d'); ctx.putImageData(imageData, 0, 0);
  return { width: pixels.width, height: pixels.height, imageData, pixelBuffer: pixels, canvas, ctx,
    hasAlpha: pixels.data.some((value, i) => i % 4 === 3 && value !== 2 ** pixels.bitDepth - 1), size: 0 };
}

export const DIAGNOSTIC_CASES = Object.freeze([
  'metrics', 'crop', 'canvas-meta', 'canvas-copy', 'resize', 'alpha-canvas', 'alpha-white', 'alpha-jpeg', 'icc-p3', 'photo-webp',
  'jpeg', 'png', 'png-js', 'png-palette', 'png-opt', 'webp', 'webp-ll', 'jxl', 'jxl-ll',
  'jp2', 'j2k', 'tiff', 'bmp8', 'bmp24', 'bmp32', 'gif', 'gifenc', 'heic', 'avif', 'ico',
  'png16', 'tiff16', 'jxl16', 'jp2-16', 'png-alpha', 'avif-alpha', 'cmyk-tiff', 'cmyk-jpeg', ...DIAGNOSTIC_LAB_CASES
]);

export async function runDiagnosticTests({ createRuntime, photo, signal, progress = () => {}, checkpoint = () => {}, timeout = 30000 }) {
  let runtime, base, transparent, phase = 'initialize';
  const results = [], info = {};
  Object.defineProperty(results, 'codecInfo', { value: info });
  const operation = name => {
    const next = /^(load|can)/.test(name) ? 'load' : /^decode/.test(name) ? 'decode' : /^(encode|canvasToBlob)/.test(name) ? 'encode'
      : /^(measure|compute|prepareMetric)/.test(name) ? 'metrics' : /^(prepareCanvas|outputSource|cloneImageData|imageDataToPreview)/.test(name) ? 'canvas' : null;
    if (next) phase = next;
  };
  const save = result => { results.push(result); Object.assign(info, runtime?.info); checkpoint(result, info); };
  const config = { ...DEFAULT_EXPORT_CONFIG, resizeWidth: '', resizeHeight: '', targetKB: '', metadataPolicy: 'none', quality: 85,
    pngDepth: '8', tiffDepth: '8', jxlDepth: '8', gifColors: 32, gifDither: false, bmpColors: 32, bmpCompression: 'none', colorMode: 'rgb' };
  const describe = async (reference, actual, blob) => ({ ...diagnosticDifference(reference, actual), bytes: blob?.size ?? 0,
    fileHash: blob ? await diagnosticHash(blob) : '-', pixelHash: await diagnosticPixelHash(actual), colors: reference.colorSpace + '/' + actual.colorSpace });
  async function conversion(format, source = base, extra = {}) {
    const actions = runtime.actions;
    phase = 'encode';
    const encoded = await actions.encodeFromSource({ ...config, format, ...extra }, source);
    phase = 'decode';
    const decoded = await actions.decodeVariantForPreview(encoded.blob, encoded.exactPng);
    try {
      phase = 'hash';
      const result = await describe(encoded.sourcePixelBuffer, decoded.pixelBuffer, encoded.blob);
      phase = 'metrics';
      const measured = await actions.measurePixels(encoded.sourcePixelBuffer, decoded.pixelBuffer, { allowUnknownColorSpace: true });
      return { ...result, psnr: measured.psnr, alpha: measured.alpha };
    } finally { decoded.bitmap?.close?.(); }
  }
  async function execute(id, task) {
    if (signal?.aborted) { save({ id, error: 'cancel' }); return; }
    phase = 'test';
    let timer, abort;
    const interrupt = new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('timeout')), timeout);
      abort = () => reject(new Error('cancel'));
      signal?.addEventListener('abort', abort, { once: true });
    });
    progress(id, results.length, DIAGNOSTIC_CASES.length);
    try { save({ id, ...await Promise.race([Promise.resolve().then(task), interrupt]) }); }
    catch (error) {
      save({ id, error: diagnosticError(error), phase, exception: diagnosticExceptionName(error) });
      Object.assign(info, runtime.info); phase = 'cleanup'; runtime.dispose(); phase = 'initialize'; runtime = createRuntime(operation);
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
    progress(null, results.filter(result => !result.error?.startsWith('cancel')).length, DIAGNOSTIC_CASES.length);
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  try {
    runtime = createRuntime(operation);
    base = diagnosticSource(diagnosticPixels()); transparent = diagnosticSource(diagnosticPixels(8, true));
    await execute('metrics', async () => {
      const other = diagnosticPixels(); other.data[0] ^= 1;
      const actual = diagnosticDifference(base.pixelBuffer, other);
      const expected = 10 * Math.log10(255 ** 2 * 32 * 32 * 3);
      if (Math.abs(actual.psnr - expected) > 1e-10 || actual.changed !== 1) throw new Error('metric mismatch');
      return describe(base.pixelBuffer, other);
    });
    await execute('crop', async () => {
      const { pixels } = cropSourcePixels(base.pixelBuffer, { unit: 'pixels', x: 3, y: 2, width: 16, height: 16 });
      const expected = new Uint8ClampedArray(16 * 16 * 4);
      for (let y = 0; y < 16; y++) expected.set(base.pixelBuffer.data.subarray(((y + 2) * 32 + 3) * 4, ((y + 2) * 32 + 19) * 4), y * 64);
      return describe({ ...pixels, data: expected }, pixels);
    });
    await execute('canvas-meta', async () => {
      const image = base.ctx.getImageData(0, 0, 1, 1), working = pixelBufferFromImageData(image);
      if (working.colorSpace !== 'srgb') throw new Error('default Canvas color mismatch');
      const api = typeof image.colorSpace === 'string';
      return { values: { api: +api, image: image.colorSpace ?? '-', context: base.ctx.getContextAttributes?.()?.colorSpace ?? '-', working: working.colorSpace },
        note: api ? 'Браузер сообщает цветовое пространство ImageData.' : 'Браузер не сообщает ImageData.colorSpace; стандартный ImageData обрабатывается как sRGB. Неизвестные профили файлов сохраняют свою метку.' };
    });
    await execute('canvas-copy', async () => {
      const pixels = pixelBufferFromImageData(base.ctx.getImageData(0, 0, 32, 32));
      return describe(base.pixelBuffer, pixels);
    });
    await execute('resize', async () => {
      const resized = runtime.actions.outputSourceForConfig({ format: 'png', resizeWidth: '16', resizeHeight: '16' }, base);
      if (resized.width !== 16 || resized.height !== 16) throw new Error('resize dimensions');
      return describe(resized.pixelBuffer, resized.pixelBuffer);
    });
    await execute('alpha-canvas', async () => {
      const imageData = transparent.ctx.getImageData(0, 0, 32, 32);
      return { ...await describe(transparent.pixelBuffer, pixelBufferFromImageData(imageData)), inputHash: await diagnosticPixelHash(transparent.pixelBuffer),
        note: 'Чтение полупрозрачного Canvas может округлять RGB и терять скрытые цвета полностью прозрачных пикселей. Это отдельная проверка браузерного пути.' };
    });
    await execute('alpha-white', async () => {
      const canvas = runtime.actions.prepareCanvasForFormat(FORMAT_DEFS.jpeg, 'white', transparent);
      const actual = pixelBufferFromImageData(canvas.getContext('2d').getImageData(0, 0, 32, 32));
      const data = new Uint8ClampedArray(transparent.pixelBuffer.data.length), input = transparent.pixelBuffer.data;
      for (let at = 0; at < input.length; at += 4) {
        for (let channel = 0; channel < 3; channel++) data[at + channel] = Math.round((input[at + channel] * input[at + 3] + 255 * (255 - input[at + 3])) / 255);
        data[at + 3] = 255;
      }
      return { ...await describe({ ...transparent.pixelBuffer, data }, actual), inputHash: await diagnosticPixelHash(transparent.pixelBuffer),
        note: 'Сравнение наложения на белый через Canvas с целочисленной формулой. Число и максимум отклонений показывают округление до передачи пикселей JPEG-кодеку.' };
    });
    await execute('alpha-jpeg', async () => {
      const actions = runtime.actions, canvas = actions.prepareCanvasForFormat(FORMAT_DEFS.jpeg, 'white', transparent);
      const input = canvas.getContext('2d').getImageData(0, 0, 32, 32), pixels = pixelBufferFromImageData(input);
      const blob = await (await actions.loadOptionalCodec('utif')).encodeJpeg(input, config);
      const encoded = await actions.encodeFromSource({ ...config, format: 'jpeg' }, transparent);
      if (await diagnosticHash(blob) !== await diagnosticHash(encoded.blob)) throw new Error('JPEG direct and application path mismatch');
      const decoded = await actions.decodeVariantForPreview(blob);
      try { return { ...await describe(pixels, decoded.pixelBuffer, blob), inputHash: await diagnosticPixelHash(pixels),
        note: 'Пиксели после белой подложки переданы прямо встроенному JPEG-кодеку; его файл совпадает с обычным путём приложения. Отпечатки до и после JPEG позволяют отделить кодек от Canvas.' }; }
      finally { decoded.bitmap?.close?.(); }
    });
    await execute('icc-p3', async () => {
      const { pixels, iccProfile } = createIccP3Sample();
      const input = cropSourcePixels(pixels, { unit: 'pixels', x: 64, y: 32, width: 32, height: 32 }).pixels;
      const actual = await convertIccToSrgb(input, iccProfile);
      return describe({ ...input, colorSpace: 'unknown' }, actual.pixelBuffer ?? actual);
    });
    await execute('photo-webp', async () => {
      const actions = runtime.actions;
      if (!photo) throw new Error('photo unsupported');
      const browser = await actions.decodeImageBlob(photo);
      try {
        const canvas = document.createElement('canvas'); canvas.width = browser.width; canvas.height = browser.height;
        const ctx = canvas.getContext('2d'); ctx.drawImage(browser.image, 0, 0);
        const native = pixelBufferFromImageData(ctx.getImageData(0, 0, canvas.width, canvas.height));
        const decoded = await (await actions.loadOptionalCodec('modern')).decode(photo, 'webp');
        const embedded = decoded.pixelBuffer ?? pixelBufferFromImageData(decoded.imageData);
        return describe(native, embedded, photo);
      } finally { browser.close?.(); }
    });
    const formats = [
      ['jpeg', 'jpeg'], ['png', 'png'], ['png-js', 'png', { pngFilter: 'adaptive' }],
      ['png-palette', 'pngIndexed'], ['png-opt', 'pngUpng'], ['webp', 'webp'], ['webp-ll', 'webpLossless'],
      ['jxl', 'jxl'], ['jxl-ll', 'jxlLossless'], ['jp2', 'jp2'], ['j2k', 'j2k'], ['tiff', 'tiff'],
      ['bmp8', 'bmp8'], ['bmp24', 'bmp24'], ['bmp32', 'bmp32'], ['gif', 'gif'], ['gifenc', 'gifenc'],
      ['heic', 'heic'], ['avif', 'avif'], ['ico', 'ico']
    ];
    for (const [id, format, options] of formats) await execute(id, () => conversion(format, format === 'heic' ? diagnosticSource(diagnosticPixels(8, false, 64)) : base, options));
    const precise = diagnosticSource(diagnosticPixels(16));
    for (const [id, format] of [['png16', 'png'], ['tiff16', 'tiff'], ['jxl16', 'jxlLossless'], ['jp2-16', 'jp2']])
      await execute(id, () => conversion(format, precise, { pngDepth: '16', tiffDepth: '16', jxlDepth: '16', quality: 100 }));
    await execute('png-alpha', () => conversion('png', transparent, { pngFilter: 'adaptive' }));
    await execute('avif-alpha', () => conversion('avif', transparent));
    const data = new Uint8Array(32 * 32 * 4);
    for (let i = 0; i < data.length; i += 4) { data[i] = i & 255; data[i + 1] = (i * 3) & 255; data[i + 2] = (i * 7) & 255; data[i + 3] = (i * 11) & 255; }
    const cmyk = createCmykRaster(32, 32, data);
    for (const format of ['tiff', 'jpeg']) await execute('cmyk-' + format, async () => {
      const codec = await runtime.actions.loadOptionalCodec('utif');
      const blob = await codec.encodeCmyk(cmyk, format, config);
      const decoded = await (format === 'tiff' ? codec.decode(blob) : codec.decodeCmykJpeg(blob));
      if (!decoded.cmyk) throw new Error('CMYK missing');
      let changed = 0, max = 0, sum = 0, tac = 0;
      for (let i = 0; i < data.length; i++) { const delta = Math.abs(data[i] - decoded.cmyk.data[i]); if (delta) changed++; max = Math.max(max, delta); sum += delta ** 2; }
      for (let i = 0; i < data.length; i += 4) tac = Math.max(tac, (decoded.cmyk.data[i] + decoded.cmyk.data[i+1] + decoded.cmyk.data[i+2] + decoded.cmyk.data[i+3]) / 255 * 100);
      return { bytes: blob.size, psnr: sum ? 10 * Math.log10(255 ** 2 / (sum / data.length)) : Infinity,
        alpha: tac, changed, max: max / 255 * 100, fileHash: await diagnosticHash(blob), pixelHash: await diagnosticHash(decoded.cmyk.data) };
    });
    const laboratory = diagnosticLabTasks({ getRuntime: () => runtime, photo, config, makeSource: diagnosticSource });
    for (const id of DIAGNOSTIC_LAB_CASES) await execute(id, laboratory[id]);
  } catch (error) {
    Object.defineProperty(results, 'failure', { value: { phase, error: diagnosticError(error), exception: diagnosticExceptionName(error) } });
  } finally {
    Object.assign(info, runtime?.info);
    try { runtime?.dispose(); }
    catch (error) { if (!results.failure) Object.defineProperty(results, 'failure', { value: { phase: 'cleanup', error: diagnosticError(error), exception: diagnosticExceptionName(error) } }); }
  }
  return results;
}
