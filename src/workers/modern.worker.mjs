// The pinned ViewerModernModule factory is prepended by modern.mjs.
let modulePromise;
self.onmessage = async ({ data: request }) => {
  const { id, type, format } = request;
  try {
    const codec = await (modulePromise ||= ViewerModernModule({ print() {}, printErr() {} }));
    if (type === 'init') { self.postMessage({ type: 'ready' }); return; }
    if (!['encode', 'decode', 'jpeg-to-jxl', 'jxl-to-jpeg'].includes(type)) throw new Error('Unknown codec operation');
    const input = new Uint8Array(request.buffer);
    const transcode = type === 'jpeg-to-jxl' || type === 'jxl-to-jpeg';
    if (!input.length || input.length > (transcode ? 64 : 256) * 1024 * 1024)
      throw new Error(transcode ? 'Пустой файл или размер более 64 МиБ' : 'Пустой файл или размер более 256 МиБ');
    const pointer = codec._malloc(input.length);
    if (!pointer) throw new Error('Недостаточно памяти');
    let result;
    try {
      codec.HEAPU8.set(input, pointer);
      let status;
      if (type === 'encode') {
        const { width, height, quality, webpMethod, jxlEffort, depth = 8 } = request, kind = { webpLossless: 1, jxl: 2, jxlLossless: 3 }[format];
        if (!kind || !Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 || width * height > 40000000 || (depth !== 8 && (depth !== 16 || kind !== 3)) || input.length !== width * height * 4 * (depth / 8) || !Number.isInteger(quality) || quality < 1 || quality > 100
          || !Number.isInteger(webpMethod) || webpMethod < 0 || webpMethod > 6 || !Number.isInteger(jxlEffort) || jxlEffort < 1 || jxlEffort > 10) throw new Error('Некорректные параметры изображения или кодирования');
        status = depth === 16 ? codec._viewer_modern_encode16(pointer, input.length, width, height, jxlEffort)
          : codec._viewer_modern_encode(pointer, input.length, width, height, quality, kind, webpMethod, jxlEffort);
      } else if (type === 'decode') {
        if (!['webp', 'jxl'].includes(format)) throw new Error('Неизвестный формат');
        status = codec._viewer_modern_decode(pointer, input.length, format === 'webp' ? 1 : 2);
      } else status = type === 'jpeg-to-jxl'
        ? codec._viewer_modern_jpeg_to_jxl(pointer, input.length)
        : codec._viewer_modern_jxl_to_jpeg(pointer, input.length);
      if (status) throw new Error(codec.UTF8ToString(codec._viewer_modern_error()));
      const at = codec._viewer_modern_output(), size = codec._viewer_modern_output_size();
      const width = codec._viewer_modern_width(), height = codec._viewer_modern_height();
      const depth = type === 'decode' ? codec._viewer_modern_depth() : type === 'encode' ? request.depth || 8 : 8;
      if (at <= 0 || size < 1 || size > 256 * 1024 * 1024 || at + size > codec.HEAPU8.length ||
          (!transcode && (!Number.isSafeInteger(width * height) || width <= 0 || height <= 0 || width * height > 40000000 ||
          (type === 'decode' && (depth !== 8 && depth !== 16 || size !== width * height * 4 * (depth / 8)))))) throw new Error('Некорректный результат кодека');
      result = { type: transcode ? 'transcoded' : type === 'encode' ? 'encoded' : 'decoded', id, width, height, depth, buffer: codec.HEAPU8.slice(at, at + size).buffer };
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
