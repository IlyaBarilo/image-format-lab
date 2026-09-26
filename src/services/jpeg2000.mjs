import workerSource from 'viewer:jpeg2000-worker';
import { embeddedCodecSource } from './embedded-codecs.mjs';
import { createPixelBuffer } from '../core/pixel-buffer.mjs';
import { prepareIccSdr } from '../core/icc-sdr.mjs';
import { pngPreview } from '../core/png.mjs';

export function createJpeg2000() {
  let session, sequence = 0, queue = Promise.resolve();
  function dispose(current) {
    if (!current) return;
    clearTimeout(current.timer);
    current.worker.terminate();
    if (current.url) URL.revokeObjectURL(current.url);
    current.url = null;
    if (session === current) session = null;
  }
  function start() {
    if (session) return session.ready;
    if (typeof Worker !== 'function') return Promise.reject(new Error('Для JPEG 2000 нужен браузер с поддержкой Worker'));
    const url = URL.createObjectURL(new Blob([embeddedCodecSource('vendor/jpeg2000-codec.js'), '\n;', workerSource], { type: 'text/javascript' }));
    let worker;
    try { worker = new Worker(url); }
    catch (error) { URL.revokeObjectURL(url); return Promise.reject(error); }
    const current = session = { worker, url, pending: null, timer: null };
    current.ready = new Promise((resolve, reject) => {
      current.fail = error => {
        dispose(current);
        reject(error);
        current.pending?.reject(error);
        current.pending = null;
      };
      current.timer = setTimeout(() => current.fail(new Error('Превышено время запуска JPEG 2000')), 60000);
      worker.onerror = event => { event.preventDefault(); current.fail(new Error(event.message || 'Ошибка Worker JPEG 2000')); };
      worker.onmessageerror = () => current.fail(new Error('Не удалось получить результат JPEG 2000'));
      worker.onmessage = ({ data }) => {
        if (session !== current) return;
        if (data.type === 'ready') {
          clearTimeout(current.timer);
          if (current.url) URL.revokeObjectURL(current.url);
          current.url = null;
          resolve(current);
        } else if (data.type === 'error') current.fail(new Error('JPEG 2000: ' + data.message));
        else if (['decoded', 'encoded'].includes(data.type) && data.id === current.pending?.id) {
          const pending = current.pending;
          current.pending = null;
          dispose(current); // Drop the WASM heap after each image.
          pending.resolve(data);
        }
      };
      try { worker.postMessage({ type: 'init' }); }
      catch (error) { current.fail(error); }
    });
    return current.ready;
  }
  function operate(type, getBuffer, properties = {}) {
    const operation = queue.catch(() => {}).then(async () => {
      const current = await start();
      let buffer;
      try { buffer = await getBuffer(); }
      catch (error) { dispose(current); throw error; }
      if (session !== current) throw new Error('JPEG 2000 Worker недоступен');
      return new Promise((resolve, reject) => {
        const id = ++sequence;
        current.pending = { id, resolve, reject };
        current.timer = setTimeout(() => current.fail(new Error('Превышено время обработки JPEG 2000')), 180000);
        try { current.worker.postMessage({ type, id, buffer, ...properties }, [buffer]); }
        catch (error) { current.fail(error); }
      });
    });
    queue = operation.then(() => {}, () => {});
    return operation;
  }
  async function decode(file, format = 'jp2') {
    if (!file?.size || file.size > 64 * 1024 * 1024 || !['jp2', 'j2k'].includes(format))
      throw new Error('JPEG 2000: нужен JP2/J2K размером до 64 МиБ');
    const result = await operate('decode', () => file.arrayBuffer(), { format });
    const native = result.exactBuffer ? createPixelBuffer({ width: result.width, height: result.height,
      data: new Uint16Array(result.exactBuffer), sampleType: 'uint16', bitDepth: 16 })
      : createPixelBuffer({ width: result.width, height: result.height,
        data: new Uint8ClampedArray(result.buffer), sampleType: 'uint8', bitDepth: 8 });
    const prepared = await prepareIccSdr(native,result.iccBuffer ? new Uint8Array(result.iccBuffer) : null);
    const preview = pngPreview(prepared.pixelBuffer);
    return { width: result.width, height: result.height,
      imageData: new ImageData(preview.data, result.width, result.height), ...prepared,
      precisionNote:result.depth === 16 ? '16 бит/канал · показ 8 бит' : '',
      colorManagementNote:result.iccBuffer?'ICC→sRGB':'',close: null };
  }
  async function encode(pixels, quality, format = 'jp2', iccProfile = null) {
    const source = createPixelBuffer(pixels);
    const { width, height, sampleType, bitDepth } = source;
    const depth = sampleType === 'uint16' && bitDepth === 16 ? 16 : 8;
    if (!['jp2', 'j2k'].includes(format) || !Number.isInteger(quality) || quality < 1 || quality > 100 ||
        !['uint8', 'uint16'].includes(sampleType) || (sampleType === 'uint16' && depth !== 16) ||
        width > 8192 || height > 8192 || width * height > (depth === 16 ? 4 : 8) * 1024 * 1024)
      throw new Error('JPEG 2000: неподдерживаемая разрядность, качество или превышен лимит изображения');
    const iccBuffer = format === 'jp2' && iccProfile?.byteLength && iccProfile.byteLength <= 1024 * 1024
      ? new Uint8Array(iccProfile).buffer : null;
    const result = await operate('encode', () => new Uint8Array(source.data.buffer,
      source.data.byteOffset, source.data.byteLength).slice().buffer,
      { width, height, depth, quality, format, iccBuffer });
    return new Blob([result.buffer], { type: format === 'jp2' ? 'image/jp2' : 'image/j2k' });
  }
  const api = { decode, encode };
  async function loadJpeg2000Codec() { await start(); return api; }
  return { loadJpeg2000Codec };
}
