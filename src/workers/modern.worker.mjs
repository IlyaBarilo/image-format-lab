// The pinned ViewerModernModule factory is prepended by modern.mjs.
let modulePromise;
self.onmessage = async ({ data: request }) => {
  const { id, type, format } = request;
  try {
    const codec = await (modulePromise ||= ViewerModernModule({ print() {}, printErr() {} }));
    if (type === 'init') { self.postMessage({ type: 'ready' }); return; }
    if (!['encode', 'decode'].includes(type)) throw new Error('Unknown codec operation');
    const input = new Uint8Array(request.buffer);
    if (!input.length || input.length > 256 * 1024 * 1024) throw new Error('Пустой файл или размер более 256 МиБ');
    const pointer = codec._malloc(input.length);
    if (!pointer) throw new Error('Недостаточно памяти');
    let result;
    try {
      codec.HEAPU8.set(input, pointer);
      let status;
      if (type === 'encode') {
        const { width, height, quality } = request, kind = { webpLossless: 1, jxl: 2, jxlLossless: 3 }[format];
        if (!kind || !Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 || width * height > 40000000 || input.length !== width * height * 4 || !Number.isInteger(quality) || quality < 1 || quality > 100) throw new Error('Некорректные параметры изображения');
        status = codec._viewer_modern_encode(pointer, input.length, width, height, quality, kind);
      } else {
        if (!['webp', 'jxl'].includes(format)) throw new Error('Неизвестный формат');
        status = codec._viewer_modern_decode(pointer, input.length, format === 'webp' ? 1 : 2);
      }
      if (status) throw new Error(codec.UTF8ToString(codec._viewer_modern_error()));
      const at = codec._viewer_modern_output(), size = codec._viewer_modern_output_size();
      const width = codec._viewer_modern_width(), height = codec._viewer_modern_height();
      if (at <= 0 || size < 1 || size > 256 * 1024 * 1024 || at + size > codec.HEAPU8.length || !Number.isSafeInteger(width * height) || width <= 0 || height <= 0 || width * height > 40000000 || (type === 'decode' && size !== width * height * 4)) throw new Error('Некорректный результат кодека');
      result = { type: type === 'encode' ? 'encoded' : 'decoded', id, width, height, buffer: codec.HEAPU8.slice(at, at + size).buffer };
      if (type === 'decode' && format === 'jxl') {
        const count = codec._viewer_modern_block_count();
        const expected = Math.ceil(width / 8) * Math.ceil(height / 8);
        const pointer = codec._viewer_modern_block_owners();
        if (count === expected && count > 0 && pointer > 0 && pointer + count * 4 <= codec.HEAPU8.length) {
          result.blockOwners = codec.HEAPU8.slice(pointer, pointer + count * 4).buffer;
        }
      }
    } finally { codec._viewer_modern_clear(); codec._free(pointer); }
    self.postMessage(result, result.blockOwners ? [result.buffer, result.blockOwners] : [result.buffer]);
  } catch (error) { self.postMessage({ type: 'error', id, message: error?.message || String(error) }); }
};
