// ViewerJpeg2000Module is prepended from the pinned OpenJPEG build.
let modulePromise;
const JP2_SIGNATURE = [0, 0, 0, 12, 106, 80, 32, 32, 13, 10, 135, 10];
self.onmessage = async ({ data: request }) => {
  const { id, type, format } = request;
  try {
    const codec = await (modulePromise ||= ViewerJpeg2000Module({ print() {}, printErr() {} }));
    if (type === 'init') { self.postMessage({ type: 'ready' }); return; }
    if (!['encode', 'decode'].includes(type) || !['jp2', 'j2k'].includes(format)) throw new Error('Неизвестная операция JPEG 2000');
    const jp2 = format === 'jp2' ? 1 : 0;
    const allocated = [], own = length => {
      const p = codec._malloc(length);
      if (!p) throw new Error('Недостаточно памяти');
      allocated.push(p);
      return p;
    };
    let resultPointer = 0, profilePointer = 0;
    try {
      if (type === 'encode') {
        const { width, height, depth, quality } = request;
        const pixels = width * height;
        if (!Number.isSafeInteger(pixels) || width < 1 || height < 1 || width > 8192 || height > 8192 ||
            ![8, 16].includes(depth) || pixels > (depth === 16 ? 4 : 8) * 1024 * 1024 ||
            !Number.isInteger(quality) || quality < 1 || quality > 100 ||
            request.buffer.byteLength !== pixels * 4 * depth / 8)
          throw new Error('Некорректный размер, разрядность или качество JPEG 2000');
        const input = depth === 16 ? new Uint16Array(request.buffer) : new Uint8Array(request.buffer);
        let opaque = true, gray = true;
        const max = depth === 16 ? 65535 : 255;
        for (let i = 0; i < input.length; i += 4) {
          if (input[i + 3] !== max) opaque = false;
          if (input[i] !== input[i + 1] || input[i] !== input[i + 2]) gray = false;
          if (!opaque && !gray) break;
        }
        const channels = opaque && gray ? 1 : opaque ? 3 : 4;
        const samplePointer = own(pixels * channels * 2);
        const samples = new Uint16Array(codec.HEAPU8.buffer, samplePointer, pixels * channels);
        for (let i = 0, at = 0; i < pixels; i++) {
          const from = i * 4;
          for (let c = 0; c < channels; c++) samples[at++] = input[from + c];
        }
        const icc = jp2 && request.iccBuffer ? new Uint8Array(request.iccBuffer) : null;
        if (icc && icc.length > 1024 * 1024) throw new Error('ICC-профиль превышает 1 МиБ');
        const iccInput = icc?.length ? own(icc.length) : 0;
        if (iccInput) codec.HEAPU8.set(icc, iccInput);
        const out = own(4), size = own(4);
        // Quality 100 is reversible/lossless. Lower settings target a ratio, not a fixed PSNR.
        const ratio = quality === 100 ? 0 : Math.max(2, Math.round(1 + (100 - quality) / 2));
        if (!codec._eval_encode(samplePointer, width, height, depth, channels, jp2, ratio, iccInput, icc?.length || 0, out, size))
          throw new Error('Кодировщик не смог сохранить изображение');
        resultPointer = codec.HEAPU32[out >>> 2];
        const length = codec.HEAP32[size >>> 2];
        if (!resultPointer || length < 1 || length > 256 * 1024 * 1024 || resultPointer + length > codec.HEAPU8.length)
          throw new Error('Некорректный размер результата JPEG 2000');
        const buffer = codec.HEAPU8.slice(resultPointer, resultPointer + length).buffer;
        self.postMessage({ type: 'encoded', id, format, buffer }, [buffer]);
      } else {
        const bytes = new Uint8Array(request.buffer);
        if (bytes.length < 4 || bytes.length > 64 * 1024 * 1024 ||
            (jp2 ? !JP2_SIGNATURE.every((byte, i) => bytes[i] === byte) : bytes[0] !== 0xff || bytes[1] !== 0x4f))
          throw new Error('Неверная сигнатура или размер файла');
        const input = own(bytes.length);
        codec.HEAPU8.set(bytes, input);
        const [out, w, h, depthPointer, channelsPointer, alphaPointer, iccLengthPointer, iccPointer] = Array.from({ length: 8 }, () => own(4));
        if (!codec._eval_decode(input, bytes.length, jp2, out, w, h, depthPointer, channelsPointer, alphaPointer, iccLengthPointer, iccPointer))
          throw new Error('Неподдерживаемый, слишком большой или повреждённый JP2/J2K');
        resultPointer = codec.HEAPU32[out >>> 2];
        profilePointer = codec.HEAPU32[iccPointer >>> 2];
        const width = codec.HEAP32[w >>> 2], height = codec.HEAP32[h >>> 2];
        const depth = codec.HEAP32[depthPointer >>> 2], channels = codec.HEAP32[channelsPointer >>> 2];
        const iccLength = codec.HEAP32[iccLengthPointer >>> 2];
        const count = width * height;
        if (![8, 16].includes(depth) || ![1, 3, 4].includes(channels) ||
            !Number.isSafeInteger(count) || count < 1 || count > (depth === 16 ? 4 : 8) * 1024 * 1024 ||
            !resultPointer || resultPointer + count * channels * 2 > codec.HEAPU8.length ||
            iccLength < 0 || iccLength > 1024 * 1024 ||
            (iccLength && (!profilePointer || profilePointer + iccLength > codec.HEAPU8.length)))
          throw new Error('Некорректный результат декодирования JPEG 2000');
        const samples = new Uint16Array(codec.HEAPU8.buffer, resultPointer, count * channels);
        const preview = new Uint8ClampedArray(count * 4);
        const exact = depth === 16 ? new Uint16Array(count * 4) : null;
        for (let i = 0; i < count; i++) {
          const from = i * channels, to = i * 4;
          for (let c = 0; c < 4; c++) {
            const value = c === 3 && channels < 4 ? depth === 16 ? 65535 : 255
              : channels === 1 && c < 3 ? samples[from]
                : samples[from + c];
            preview[to + c] = depth === 16 ? Math.round(value / 257) : value;
            if (exact) exact[to + c] = value;
          }
        }
        const iccBuffer = iccLength ? codec.HEAPU8.slice(profilePointer, profilePointer + iccLength).buffer : null;
        const transfer = [preview.buffer];
        if (exact) transfer.push(exact.buffer);
        if (iccBuffer) transfer.push(iccBuffer);
        self.postMessage({ type: 'decoded', id, width, height, depth, buffer: preview.buffer,
          exactBuffer: exact?.buffer || null, iccBuffer }, transfer);
      }
    } finally {
      if (resultPointer) codec._eval_free(resultPointer);
      if (profilePointer) codec._eval_free(profilePointer);
      for (const p of allocated) codec._free(p);
    }
  } catch (error) {
    self.postMessage({ type: 'error', id, message: error?.message || String(error) });
  }
};
