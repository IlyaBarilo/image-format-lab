// The pinned, locally built ViewerHeicModule factory is prepended by heic.mjs.
// This worker owns all WASM memory. Only a new pixel buffer leaves it.
let modulePromise;
function moduleReady() {
  return modulePromise ||= ViewerHeicModule({ print() {}, printErr() {} });
}
self.onmessage = async ({ data: request }) => {
  const { id, type } = request;
  try {
    const codec = await moduleReady();
    if (type === 'init') {
      if (!codec._viewer_heic_can_encode() || !codec._viewer_avif_can_encode()) throw new Error('Встроенный кодировщик HEIC недоступен');
      self.postMessage({ type: 'ready', version: codec.UTF8ToString(codec._viewer_heic_version()),
        decoder: codec.UTF8ToString(codec._viewer_de265_version()), encoder: 'Kvazaar 2.3.2' });
      return;
    }
    if (!['decode', 'encode'].includes(type)) throw new Error('Unknown HEIC operation');
    const input = new Uint8Array(request.buffer);
    if (!input.length || input.length > 256 * 1024 * 1024) throw new Error('HEIC: пустой файл или размер более 256 МиБ');
    const pointer = codec._malloc(input.length);
    if (!pointer) throw new Error('Недостаточно памяти для HEIC');
    let result;
    try {
      codec.HEAPU8.set(input, pointer);
      if (type === 'encode') {
        const { width, height, quality } = request;
        if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 || width * height > 40000000 ||
            input.length !== width * height * 4 || !Number.isInteger(quality) || quality < 1 || quality > 100)
          throw new Error('Некорректные параметры HEIC');
        if ((request.format === 'avif' ? codec._viewer_avif_encode : codec._viewer_heic_encode)(pointer, input.length, width, height, quality))
          throw new Error(codec.UTF8ToString(codec._viewer_heic_error()));
        const at = codec._viewer_heic_output(), size = codec._viewer_heic_output_size();
        if (at <= 0 || size < 16 || size > 256 * 1024 * 1024 || at + size > codec.HEAPU8.length)
          throw new Error('Некорректный результат кодирования HEIC');
        result = { type: 'encoded', id, buffer: codec.HEAPU8.slice(at, at + size).buffer };
      } else {
        if (codec._viewer_heic_decode(pointer, input.length)) throw new Error(codec.UTF8ToString(codec._viewer_heic_error()));
        const width = codec._viewer_heic_width(), height = codec._viewer_heic_height();
        const pixels = codec._viewer_heic_pixels(), stride = codec._viewer_heic_stride();
        if (!Number.isSafeInteger(width * height) || width <= 0 || height <= 0 || width * height > 40000000 ||
            stride < width * 4 || pixels <= 0 || pixels + (height - 1) * stride + width * 4 > codec.HEAPU8.length)
          throw new Error('Некорректный размер результата HEIC');
        const rgba = new Uint8ClampedArray(width * height * 4);
        for (let y = 0; y < height; y++) rgba.set(codec.HEAPU8.subarray(pixels + y * stride, pixels + y * stride + width * 4), y * width * 4);
        if (codec._viewer_heic_premultiplied()) {
          for (let i = 0; i < rgba.length; i += 4) {
            const alpha = rgba[i + 3];
            for (let c = 0; c < 3; c++) rgba[i + c] = alpha ? Math.round(rgba[i + c] * 255 / alpha) : 0;
          }
        }
        result = { type: 'decoded', id, width, height, buffer: rgba.buffer };
      }
    } finally {
      codec._viewer_heic_clear();
      codec._free(pointer);
    }
    self.postMessage(result, [result.buffer]);
  } catch (error) {
    self.postMessage({ type: 'error', id, message: error?.message || String(error) });
  }
};
