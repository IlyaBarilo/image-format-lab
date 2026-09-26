import { normalizeTiffOptions } from '../core/raster-codecs.mjs';
import { normalizeJpegOptions } from '../core/jpeg-encode.mjs';
import { createPixelBuffer } from '../core/pixel-buffer.mjs';
import workerSource from 'viewer:tiff-worker';
import { embeddedCodecSource } from './embedded-codecs.mjs';

export function createTiff() {
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
    if (typeof Worker !== 'function') return Promise.reject(new Error('Для открытия TIFF нужен браузер с поддержкой Worker'));
    const url = URL.createObjectURL(new Blob([...['vendor/pako-2.1.0.min.js', 'vendor/UTIF-3.1.0.js', 'vendor/jpeg-decoder.js', 'vendor/bmp-decoder.js', 'vendor/tiff-codec.js'].map(name => embeddedCodecSource(name) + '\n;'), workerSource], { type: 'text/javascript' }));
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
      current.timer = setTimeout(() => current.fail(new Error('Превышено время запуска TIFF')), 60000);
      worker.onerror = event => { event.preventDefault(); current.fail(new Error(event.message || 'Ошибка Worker TIFF')); };
      worker.onmessageerror = () => current.fail(new Error('Не удалось получить результат TIFF'));
      worker.onmessage = ({ data }) => {
        if (session !== current) return;
        if (data.type === 'ready') {
          clearTimeout(current.timer);
          if (current.url) URL.revokeObjectURL(current.url);
          current.url = null;
          resolve(current);
        } else if (data.type === 'error') current.fail(new Error((current.pending?.type === 'decode-bmp' ? 'BMP/ICO: ' : current.pending?.type === 'encode-jpeg' ? 'JPEG: ' : 'TIFF: ') + data.message));
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
      if (session !== current) throw new Error('TIFF Worker недоступен');
      return new Promise((resolve, reject) => {
        const id = ++sequence;
        current.pending = { id, type, resolve, reject };
        current.timer = setTimeout(() => current.fail(new Error(type === 'encode-jpeg' ? 'Превышено время кодирования JPEG' : type === 'encode' ? 'Превышено время кодирования TIFF' : 'Превышено время декодирования TIFF')), 120000);
        try { current.worker.postMessage({ type, id, buffer, ...properties }, [buffer]); }
        catch (error) { current.fail(error); }
      });
    });
    // Keep only sequencing state; a settled queue must not retain the last RGBA buffer.
    queue = operation.then(() => {}, () => {});
    return operation;
  }
  async function decode(file, page=0) {
    if (!file.size || file.size > 256 * 1024 * 1024) throw new Error('TIFF: пустой файл или размер более 256 МиБ');
    const result = await operate('decode', () => file.arrayBuffer(), {page});
    return { width: result.width, height: result.height, pages: result.pages, page,
      imageData: new ImageData(new Uint8ClampedArray(result.buffer), result.width, result.height),
      pixelBuffer: result.exactBuffer ? createPixelBuffer({width:result.width,height:result.height,
        data:new Uint16Array(result.exactBuffer),sampleType:'uint16',bitDepth:16}) : null,
      precisionNote:result.precisionNote||'',close: null };
  }
  async function encode(imageData, options={}, pixelBuffer=null) {
    options=normalizeTiffOptions(options);
    const { width, height, data } = imageData;
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 || width * height > 40000000 ||
        data?.length !== width * height * 4)
      throw new Error('Некорректные параметры TIFF или превышен лимит 40 мегапикселей');
    // Transfer a new buffer, never the viewer's source pixels.
    const exact = options.tiffDepth === '16';
    if (exact && (!pixelBuffer || !['uint8','uint16'].includes(pixelBuffer.sampleType)))
      throw new Error('TIFF16: точные целочисленные пиксели недоступны.');
    const buffer = new Uint8ClampedArray(data).buffer;
    const exactBuffer = exact ? new pixelBuffer.data.constructor(pixelBuffer.data).buffer : null;
    const result = await operate('encode', () => buffer, { width, height, options, exactBuffer,
      sampleType:exact?pixelBuffer.sampleType:null,bitDepth:exact?pixelBuffer.bitDepth:null });
    return new Blob([result.buffer], { type: 'image/tiff' });
  }
  async function encodeJpeg(imageData, options={}) {
    const {width,height,data}=imageData;
    const settings={...normalizeJpegOptions(options),quality:options.quality};
    if (!Number.isInteger(width) || !Number.isInteger(height) || width<1 || height<1 || width*height>40000000 ||
        data?.length!==width*height*4 || !Number.isInteger(settings.quality) || settings.quality<1 || settings.quality>100)
      throw new Error('Некорректные параметры JPEG или превышен лимит 40 мегапикселей');
    const result=await operate('encode-jpeg',()=>new Uint8ClampedArray(data).buffer,{width,height,options:settings});
    return new Blob([result.buffer],{type:'image/jpeg'});
  }
  async function decodeBmp(file, ico=false) {
    if (!file.size || file.size>256*1024*1024) throw new Error('BMP/ICO: пустой файл или размер более 256 МиБ');
    const result=await operate('decode-bmp',()=>file.arrayBuffer(),{ico});
    return {width:result.width,height:result.height,imageData:new ImageData(new Uint8ClampedArray(result.buffer),result.width,result.height),close:null};
  }
  const api = { decode, encode, encodeJpeg, decodeBmp };
  async function loadTiffCodec() { await start(); return api; }
  return { loadTiffCodec };
}
