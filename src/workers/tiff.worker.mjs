import { createJpegDecoder } from '../core/jpeg.mjs';
import { installTiffJpeg } from '../core/tiff-jpeg.mjs';
import { validateTiff, tiffRgba } from '../core/tiff.mjs';
import { encodeTiff } from '../core/tiff-encode.mjs';

// Pako, the adapted UTIF, and ViewerJpegModule are prepended by tiff.mjs.
let modulePromise;
function moduleReady() {
  return modulePromise ||= ViewerJpegModule({ print() {}, printErr() {} }).then(codec => {
    installTiffJpeg(UTIF, createJpegDecoder(codec));
    return codec;
  });
}
self.onmessage = async ({ data: request }) => {
  const { id, type } = request;
  try {
    const codec = await moduleReady();
    if (type === 'init') {
      self.postMessage({ type: 'ready', codec: 'tiff', jpegVersion: codec.UTF8ToString(codec._viewer_jpeg_version()) });
      return;
    }
    if (type === 'encode') {
      const bytes = encodeTiff({ width: request.width, height: request.height, data: new Uint8ClampedArray(request.buffer) }, data => pako.deflate(data));
      self.postMessage({ type: 'encoded', id, buffer: bytes.buffer }, [bytes.buffer]);
      return;
    }
    if (type !== 'decode') throw new Error('Unknown TIFF operation');
    validateTiff(request.buffer);
    const ifds = UTIF.decode(request.buffer);
    const ifd = ifds.find(item => item?.t256?.[0] && item?.t257?.[0]);
    if (!ifd) throw new Error('TIFF не содержит изображений');
    const width = ifd.t256[0], height = ifd.t257[0];
    if (!Number.isSafeInteger(width * height) || width <= 0 || height <= 0 || width * height > 40000000)
      throw new Error('TIFF больше 40 мегапикселей');
    if (![0, 1, 2, 3, 5, 6].includes(ifd.t262?.[0] ?? 2))
      throw new Error('Этот TIFF содержит необработанные данные сенсора; нужен готовый RGB-исходник');
    if (ifd.t284?.[0] === 2) throw new Error('TIFF с раздельными плоскостями цвета пока не поддерживается');
    if (![1,3,4,5,6,7,8,32773,32809].includes(ifd.t259?.[0] || 1)) throw new Error('Неподдерживаемый способ сжатия TIFF');
    if ((ifd.t258?.length || 1) > 4 || ifd.t258?.some(bits => !Number.isInteger(bits) || bits < 1 || bits > 16))
      throw new Error('Неподдерживаемая разрядность TIFF');
    const samples = ifd.t277?.[0] ?? ifd.t258?.length ?? 1;
    if (!Number.isInteger(samples) || samples < 1 || samples > 4 || (ifd.t258 && ifd.t258.length !== samples))
      throw new Error('Некорректное количество каналов TIFF');
    if (ifd.t339?.some(value => value !== 1)) throw new Error('TIFF поддерживается с беззнаковыми целыми значениями');
    if (ifd.t278 && (!Number.isInteger(ifd.t278[0]) || ifd.t278[0] < 1)) throw new Error('Некорректная высота полосы TIFF');
    const offsets = ifd.t273 || ifd.t324, counts = ifd.t279 || ifd.t325;
    if (!offsets?.length || (counts && counts.length !== offsets.length)) throw new Error('Некорректные полосы или плитки TIFF');
    for (let i = 0; i < offsets.length; i++) {
      if (offsets[i] < 0 || offsets[i] >= request.buffer.byteLength || (counts && offsets[i] + counts[i] > request.buffer.byteLength))
        throw new Error('Данные изображения выходят за границы TIFF');
    }
    const tw = ifd.t322?.[0], th = ifd.t323?.[0];
    if ((tw !== undefined || th !== undefined) && (!tw || !th || tw * th > 40000000)) throw new Error('Некорректный размер плитки TIFF');
    UTIF.decodeImage(request.buffer, ifd, ifds);
    const rgba = tiffRgba(ifd, UTIF.toRGBA8);
    if (rgba.length !== width * height * 4) throw new Error('Некорректный результат TIFF');
    self.postMessage({ type: 'decoded', id, width, height, buffer: rgba.buffer }, [rgba.buffer]);
  } catch (error) {
    self.postMessage({ type: 'error', id, message: error?.message || String(error) });
  }
};
