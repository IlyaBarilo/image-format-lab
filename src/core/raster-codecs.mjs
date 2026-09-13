const MAX_FILE = 256 * 1024 * 1024;
function inputBytes(buffer) {
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < 8 || buffer.byteLength > MAX_FILE)
    throw new Error('Пустой файл или размер более 256 МиБ');
  return new Uint8Array(buffer);
}
function copyPixels(codec, prefix) {
  const width=codec[`_${prefix}_width`](), height=codec[`_${prefix}_height`]();
  const pointer=codec[`_${prefix}_pixels`]();
  if (!width || !height || width*height>40000000 || !pointer || pointer+width*height*4>codec.HEAPU8.length)
    throw new Error('Некорректный размер изображения или превышен лимит 40 мегапикселей');
  return {width,height,buffer:codec.HEAPU8.slice(pointer,pointer+width*height*4).buffer};
}
export function decodeBmpPixels(codec, buffer, ico=false) {
  const bytes=inputBytes(buffer), at=codec._malloc(bytes.length);
  if (!at) throw new Error('Недостаточно памяти для BMP');
  try {
    codec.HEAPU8.set(bytes,at);
    const result=codec._viewer_bmp_decode(at,bytes.length,ico?1:0);
    if (result) throw new Error(result===1?'Недостаточно памяти или слишком большой BMP':'Повреждённый или неподдерживаемый BMP/ICO');
    return copyPixels(codec,'viewer_bmp');
  } finally { codec._free(at);codec._viewer_bmp_clear(); }
}
export function decodeTiffPixels(codec, buffer, page=0) {
  const bytes=inputBytes(buffer);
  if (!Number.isInteger(page)||page<0||page>255) throw new Error('Некорректный номер страницы TIFF');
  const at=codec._malloc(bytes.length);if(!at)throw new Error('Недостаточно памяти для TIFF');
  try {
    codec.HEAPU8.set(bytes,at);
    if(codec._viewer_tiff_decode(at,bytes.length,page))throw new Error(codec.UTF8ToString(codec._viewer_tiff_error()));
    return {...copyPixels(codec,'viewer_tiff'),pages:codec._viewer_tiff_pages()};
  } finally {codec._free(at);codec._viewer_tiff_clear();}
}
export function normalizeTiffOptions(value={}) {
  const compression=value.tiffCompression??'deflate', level=value.tiffLevel??6, predictor=value.tiffPredictor??true;
  if(!['none','deflate','lzw'].includes(compression)||!Number.isInteger(level)||level<1||level>9||typeof predictor!=='boolean')
    throw new Error('Некорректные настройки сжатия TIFF');
  return {tiffCompression:compression,tiffLevel:level,tiffPredictor:predictor};
}
export function encodeTiffPixels(codec, image, options={}) {
  const {width,height,data}=image;
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<=0||height<=0||width*height>40000000||data?.length!==width*height*4)
    throw new Error('Некорректные размеры TIFF');
  const settings=normalizeTiffOptions(options),at=codec._malloc(data.length);if(!at)throw new Error('Недостаточно памяти для TIFF');
  try {
    codec.HEAPU8.set(data,at);
    if(codec._viewer_tiff_encode(at,width,height,{none:1,lzw:5,deflate:8}[settings.tiffCompression],settings.tiffLevel,settings.tiffPredictor?2:1))
      throw new Error(codec.UTF8ToString(codec._viewer_tiff_error()));
    const pointer=codec._viewer_tiff_pixels(),size=codec._viewer_tiff_bytes();
    if(!pointer||!size||size>MAX_FILE||pointer+size>codec.HEAPU8.length)throw new Error('Некорректный результат TIFF');
    return codec.HEAPU8.slice(pointer,pointer+size).buffer;
  } finally {codec._free(at);codec._viewer_tiff_clear();}
}
