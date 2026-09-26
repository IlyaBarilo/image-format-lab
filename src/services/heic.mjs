import workerSource from 'viewer:heic-worker';
import { embeddedCodecSource } from './embedded-codecs.mjs';
import { normalizeAvifOptions } from '../core/avif-options.mjs';

export function createHeic() {
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
    if (typeof Worker !== 'function') return Promise.reject(new Error('Для HEIC нужен браузер с поддержкой Worker'));
    const url = URL.createObjectURL(new Blob([embeddedCodecSource('vendor/heic-decoder.js'), '\n;', workerSource], { type: 'text/javascript' }));
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
      current.timer = setTimeout(() => current.fail(new Error('Превышено время запуска HEIC')), 60000);
      worker.onerror = event => { event.preventDefault(); current.fail(new Error(event.message || 'Ошибка Worker HEIC')); };
      worker.onmessageerror = () => current.fail(new Error('Не удалось получить результат HEIC'));
      worker.onmessage = ({ data }) => {
        if (session !== current) return;
        if (data.type === 'ready') {
          clearTimeout(current.timer);
          if (current.url) URL.revokeObjectURL(current.url);
          current.url = null;
          resolve(current);
        } else if (data.type === 'error') current.fail(new Error('HEIC: ' + data.message));
        else if (['decoded', 'encoded'].includes(data.type) && data.id === current.pending?.id) {
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
      if (session !== current) throw new Error('HEIC Worker недоступен');
      return new Promise((resolve, reject) => {
        const id = ++sequence;
        current.pending = { id, resolve, reject };
        current.timer = setTimeout(() => current.fail(new Error(type === 'encode' ? 'Превышено время кодирования HEIC' : 'Превышено время декодирования HEIC')), 120000);
        try { current.worker.postMessage({ type, id, buffer, ...properties }, [buffer]); }
        catch (error) { current.fail(error); }
      });
    });
    // Keep only sequencing state; a settled queue must not retain the last RGBA buffer.
    queue = operation.then(() => {}, () => {});
    return operation;
  }
  async function decode(file) {
    if (!file.size || file.size > 256 * 1024 * 1024) throw new Error('HEIC: пустой файл или размер более 256 МиБ');
    const result = await operate('decode', () => file.arrayBuffer());
    return { width: result.width, height: result.height,
      imageData: new ImageData(new Uint8ClampedArray(result.buffer), result.width, result.height), close: null };
  }
  async function encode(imageData, quality, format = 'heic', options = {}) {
    const { width, height, data } = imageData;
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 || width * height > 40000000 ||
        data?.length !== width * height * 4 || !Number.isInteger(quality) || quality < 1 || quality > 100)
      throw new Error('Некорректные параметры HEIC или превышен лимит 40 мегапикселей');
    // Transfer a new buffer, never the viewer's source pixels.
    const avifSpeed = format === 'avif' ? normalizeAvifOptions(options).avifSpeed : undefined;
    const result = await operate('encode', () => new Uint8ClampedArray(data).buffer, { width, height, quality, format, avifSpeed });
    return new Blob([result.buffer], { type: format === 'avif' ? 'image/avif' : 'image/heic' });
  }
  const api = { decode, encode };
  async function loadHeicCodec() { await start(); return api; }
  return { loadHeicCodec };
}
