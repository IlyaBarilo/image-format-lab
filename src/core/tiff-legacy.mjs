import { validateTiff, tiffRgba } from './tiff.mjs';

// JPEG-in-TIFF compatibility path; entropy decoding uses libjpeg-turbo.
export function decodeLegacyTiff(UTIF, buffer, page=0) {
    validateTiff(buffer);
    const ifds = UTIF.decode(buffer);
    const images=ifds.filter(item => item?.t256?.[0] && item?.t257?.[0]);
    const ifd = images[page];
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
      if (offsets[i] < 0 || offsets[i] >= buffer.byteLength || (counts && offsets[i] + counts[i] > buffer.byteLength))
        throw new Error('Данные изображения выходят за границы TIFF');
    }
    const tw = ifd.t322?.[0], th = ifd.t323?.[0];
    if ((tw !== undefined || th !== undefined) && (!tw || !th || tw * th > 40000000)) throw new Error('Некорректный размер плитки TIFF');
    UTIF.decodeImage(buffer, ifd, ifds);
    const rgba = tiffRgba(ifd, UTIF.toRGBA8);
    if (rgba.length !== width * height * 4) throw new Error('Некорректный результат TIFF');
    return {width,height,buffer:rgba.buffer,pages:images.length};
}
