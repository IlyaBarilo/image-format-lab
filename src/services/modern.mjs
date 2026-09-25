import workerSource from 'viewer:modern-worker';
import { embeddedCodecSource } from './embedded-codecs.mjs';

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
      if (session !== current) throw new Error('WebP / JPEG XL Worker недоступен');
      return new Promise((resolve, reject) => {
        const id = ++sequence;
        current.pending = { id, resolve, reject };
        current.timer = setTimeout(() => current.fail(new Error(type === 'encode' ? 'Превышено время кодирования WebP / JPEG XL' : 'Превышено время декодирования WebP / JPEG XL')), 120000);
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
  async function encode(imageData, quality, format = 'jxl') {
    const { width, height, data } = imageData;
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 || width * height > 40000000 ||
        data?.length !== width * height * 4 || !Number.isInteger(quality) || quality < 1 || quality > 100)
      throw new Error('Некорректные параметры WebP / JPEG XL или превышен лимит 40 мегапикселей');
    // Transfer a new buffer, never the viewer's source pixels.
    const result = await operate('encode', () => new Uint8ClampedArray(data).buffer, { width, height, quality, format });
    return new Blob([result.buffer], { type: format === 'webpLossless' ? 'image/webp' : 'image/jxl' });
  }
  const api = { decode, encode };
  async function loadModernCodec() { await start(); return api; }
  return { loadModernCodec };
}
