import workerSource from 'viewer:modern-worker';
import { embeddedCodecSource } from './embedded-codecs.mjs';
import { normalizeModernOptions } from '../core/modern-options.mjs';

export function createModern() {
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
    if (typeof Worker !== 'function') return Promise.reject(new Error('Для WebP / JPEG XL нужен браузер с поддержкой Worker'));
    const url = URL.createObjectURL(new Blob([embeddedCodecSource('vendor/modern-codecs.js'), '\n;', workerSource], { type: 'text/javascript' }));
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
      current.timer = setTimeout(() => current.fail(new Error('Превышено время запуска WebP / JPEG XL')), 60000);
      worker.onerror = event => { event.preventDefault(); current.fail(new Error(event.message || 'Ошибка Worker WebP / JPEG XL')); };
      worker.onmessageerror = () => current.fail(new Error('Не удалось получить результат WebP / JPEG XL'));
      worker.onmessage = ({ data }) => {
        if (session !== current) return;
        if (data.type === 'ready') {
          clearTimeout(current.timer);
          if (current.url) URL.revokeObjectURL(current.url);
          current.url = null;
          resolve(current);
        } else if (data.type === 'error') current.fail(new Error('WebP / JPEG XL: ' + data.message));
        else if (['decoded', 'encoded', 'transcoded'].includes(data.type) && data.id === current.pending?.id) {
          const pending = current.pending;
          current.pending = null;
          dispose(current); // Release the entire WASM heap after every image.
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
      if (session !== current) throw new Error('WebP / JPEG XL Worker недоступен');
      return new Promise((resolve, reject) => {
        const id = ++sequence;
        current.pending = { id, resolve, reject };
        current.timer = setTimeout(() => current.fail(new Error(type === 'encode' ? 'Превышено время кодирования WebP / JPEG XL' : type === 'decode' ? 'Превышено время декодирования WebP / JPEG XL' : 'Превышено время побайтового преобразования JPEG / JPEG XL')), type === 'jpeg-to-jxl' || type === 'jxl-to-jpeg' ? 180000 : 120000);
        try { current.worker.postMessage({ type, id, buffer, ...properties }, [buffer]); }
        catch (error) { current.fail(error); }
      });
    });
    // Keep only sequencing state; a settled queue must not retain the last RGBA buffer.
    queue = operation.then(() => {}, () => {});
    return operation;
  }
  async function decode(file, format = 'jxl') {
    if (!file.size || file.size > 256 * 1024 * 1024) throw new Error('WebP / JPEG XL: пустой файл или размер более 256 МиБ');
    const result = await operate('decode', () => file.arrayBuffer(), { format });
    const columns = Math.ceil(result.width / 8), rows = Math.ceil(result.height / 8);
    const owners = result.blockOwners ? new Uint32Array(result.blockOwners) : null;
    return { width: result.width, height: result.height,
      imageData: new ImageData(new Uint8ClampedArray(result.buffer), result.width, result.height), close: null,
      blockGrid: owners?.length === columns * rows ? { kind: 'jxl-vardct', columns, rows, owners } : null };
  }
  async function encode(imageData, quality, format = 'jxl', options = {}) {
    const { width, height, data } = imageData;
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 || width * height > 40000000 ||
        data?.length !== width * height * 4 || !Number.isInteger(quality) || quality < 1 || quality > 100)
      throw new Error('Некорректные параметры WebP / JPEG XL или превышен лимит 40 мегапикселей');
    // Transfer a new buffer, never the viewer's source pixels.
    const { webpMethod, jxlEffort } = normalizeModernOptions(options);
    const result = await operate('encode', () => new Uint8ClampedArray(data).buffer, { width, height, quality, format, webpMethod, jxlEffort });
    return new Blob([result.buffer], { type: format === 'webpLossless' ? 'image/webp' : 'image/jxl' });
  }
  async function convertExactJpeg(file, operation) {
    if (!file || !Number.isSafeInteger(file.size) || file.size < 4 || file.size > 64 * 1024 * 1024)
      throw new Error('Для точного преобразования нужен файл размером до 64 МиБ');
    const header = new Uint8Array(await file.slice(0, 12).arrayBuffer());
    const jpeg = header[0] === 0xff && header[1] === 0xd8;
    const jxl = header[0] === 0xff && header[1] === 0x0a ||
      header.length >= 12 && [0, 0, 0, 12, 74, 88, 76, 32, 13, 10, 135, 10].every((byte, i) => header[i] === byte);
    if (operation === 'jpeg-to-jxl' ? !jpeg : !jxl)
      throw new Error(operation === 'jpeg-to-jxl' ? 'Выберите исходный файл JPEG' : 'Выберите файл JPEG XL');
    const result = await operate(operation, () => file.arrayBuffer());
    return new Blob([result.buffer], { type: operation === 'jpeg-to-jxl' ? 'image/jxl' : 'image/jpeg' });
  }
  const api = { decode, encode,
    transcodeJpeg: file => convertExactJpeg(file, 'jpeg-to-jxl'),
    reconstructJpeg: file => convertExactJpeg(file, 'jxl-to-jpeg') };
  async function loadModernCodec() { await start(); return api; }
  return { loadModernCodec };
}
