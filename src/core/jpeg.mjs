// Own adapter to the pinned libjpeg-turbo C bridge. All returned memory is owned
// by the caller; no view into the WASM heap survives a decode operation.
export function createJpegDecoder(codec) {
  return function decodeJpeg(input, raw = false) {
    if (!(input instanceof Uint8Array) || input.length < 4 || input.length > 256 * 1024 * 1024)
      throw new Error('Некорректный размер JPEG');
    const pointer = codec._malloc(input.length);
    if (!pointer) throw new Error('Недостаточно памяти для JPEG');
    try {
      codec.HEAPU8.set(input, pointer);
      if (codec._viewer_jpeg_decode(pointer, input.length, raw ? 1 : 0))
        throw new Error(codec.UTF8ToString(codec._viewer_jpeg_error()));
      const width = codec._viewer_jpeg_width(), height = codec._viewer_jpeg_height();
      const components = codec._viewer_jpeg_components(), precision = codec._viewer_jpeg_precision();
      const size = codec._viewer_jpeg_bytes(), start = codec._viewer_jpeg_pixels();
      if (width <= 0 || height <= 0 || width * height > 40000000 || components < 1 || components > 4 ||
          precision < 2 || precision > 16 || size !== width * height * components * (precision > 8 ? 2 : 1) ||
          start <= 0 || start + size > codec.HEAPU8.length) throw new Error('Некорректный результат JPEG');
      const buffer = codec.HEAPU8.slice(start, start + size).buffer;
      return { width, height, components, precision, lossless: Boolean(codec._viewer_jpeg_lossless()),
        adobe: Boolean(codec._viewer_jpeg_adobe()), samples: precision > 8 ? new Uint16Array(buffer) : new Uint8Array(buffer) };
    } finally { codec._viewer_jpeg_clear(); codec._free(pointer); }
  };
}
