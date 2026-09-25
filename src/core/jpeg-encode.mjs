// Own adapter to the pinned libjpeg-turbo encoder. The caller retains its pixels.
export function normalizeJpegOptions(value = {}) {
  const jpegSubsampling = value.jpegSubsampling ?? '420';
  const jpegProgressive = value.jpegProgressive ?? false;
  if (!['444', '422', '420'].includes(jpegSubsampling) || typeof jpegProgressive !== 'boolean')
    throw new Error('Некорректные параметры JPEG');
  return { jpegSubsampling, jpegProgressive };
}

export function encodeJpegPixels(codec, imageData, options = {}) {
  const {jpegSubsampling, jpegProgressive} = normalizeJpegOptions(options);
  const {width, height, data} = imageData;
  const quality = options.quality;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 ||
      width * height > 40000000 || !(data instanceof Uint8Array || data instanceof Uint8ClampedArray) ||
      data.length !== width * height * 4 || !Number.isInteger(quality) || quality < 1 || quality > 100)
    throw new Error('Некорректные пиксели или качество JPEG');
  const pointer = codec._malloc(data.length);
  if (!pointer) throw new Error('Недостаточно памяти для JPEG');
  try {
    codec.HEAPU8.set(data, pointer);
    if (codec._viewer_jpeg_encode(pointer, width, height, quality,
        {'444':0,'422':1,'420':2}[jpegSubsampling], jpegProgressive ? 1 : 0))
      throw new Error(codec.UTF8ToString(codec._viewer_jpeg_error()));
    const start = codec._viewer_jpeg_encoded(), size = codec._viewer_jpeg_encoded_bytes();
    if (!start || !size || size > 256 * 1024 * 1024 || start + size > codec.HEAPU8.length)
      throw new Error('Некорректный результат JPEG');
    return codec.HEAPU8.slice(start, start + size).buffer;
  } finally { codec._viewer_jpeg_clear(); codec._free(pointer); }
}
