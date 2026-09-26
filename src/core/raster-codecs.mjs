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
  if(!['none','deflate','lzw','packbits'].includes(compression)||!Number.isInteger(level)||level<1||level>9||typeof predictor!=='boolean')
    throw new Error('Некорректные настройки сжатия TIFF');
  return {tiffCompression:compression,tiffLevel:level,tiffPredictor:predictor};
}
// Baseline little-endian RGBA8 TIFF with one PackBits stream per strip.
export function encodePackBitsTiff(image) {
  const {width,height,data}=image;
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<=0||height<=0||width*height>40000000||data?.length!==width*height*4)
    throw new Error('Некорректные размеры TIFF');
  const rowsPerStrip=16,strips=Math.ceil(height/rowsPerStrip),tagCount=11;
  const table=8+2+tagCount*12+4,bitsAt=table,offsetsAt=bitsAt+8,countsAt=offsetsAt+(strips>1?strips*4:0);
  const dataAt=countsAt+(strips>1?strips*4:0);
  const capacity=dataAt+data.length+Math.ceil(data.length/128)+height*2;
  if(capacity>MAX_FILE)throw new Error('TIFF PackBits превышает предел 256 МиБ.');
  const bytes=new Uint8Array(capacity),view=new DataView(bytes.buffer);
  bytes[0]=73;bytes[1]=73;view.setUint16(2,42,true);view.setUint32(4,8,true);view.setUint16(8,tagCount,true);
  let tagAt=10;
  const tag=(id,type,count,value)=>{view.setUint16(tagAt,id,true);view.setUint16(tagAt+2,type,true);view.setUint32(tagAt+4,count,true);if(type===3&&count===1)view.setUint16(tagAt+8,value,true);else view.setUint32(tagAt+8,value,true);tagAt+=12;};
  tag(256,4,1,width);tag(257,4,1,height);tag(258,3,4,bitsAt);tag(259,3,1,32773);
  tag(262,3,1,2);tag(273,4,strips,strips===1?dataAt:offsetsAt);tag(277,3,1,4);
  tag(278,4,1,rowsPerStrip);tag(279,4,strips,strips===1?0:countsAt);tag(284,3,1,1);tag(338,3,1,2);
  view.setUint32(tagAt,0,true);
  for(let i=0;i<4;i++)view.setUint16(bitsAt+i*2,8,true);
  let out=dataAt;
  const rowBytes=width*4;
  for(let strip=0;strip<strips;strip++){
    const start=out;
    if(strips>1)view.setUint32(offsetsAt+strip*4,start,true);
    for(let y=strip*rowsPerStrip;y<Math.min(height,(strip+1)*rowsPerStrip);y++){
      const end=(y+1)*rowBytes;
      for(let pos=y*rowBytes;pos<end;){
        let run=1;while(run<128&&pos+run<end&&data[pos+run]===data[pos])run++;
        if(run>=3){bytes[out++]=257-run;bytes[out++]=data[pos];pos+=run;continue;}
        const begin=pos;pos+=run;
        while(pos<end&&pos-begin<128){
          let next=1;while(next<128&&pos+next<end&&data[pos+next]===data[pos])next++;
          if(next>=3||pos+next-begin>128)break;
          pos+=next;
        }
        bytes[out++]=pos-begin-1;bytes.set(data.subarray(begin,pos),out);out+=pos-begin;
      }
    }
    if(strips>1)view.setUint32(countsAt+strip*4,out-start,true);
    else view.setUint32(10+8*12+8,out-start,true);
  }
  return bytes.buffer.slice(0,out);
}
export function encodeTiffPixels(codec, image, options={}) {
  const {width,height,data}=image;
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<=0||height<=0||width*height>40000000||data?.length!==width*height*4)
    throw new Error('Некорректные размеры TIFF');
  const settings=normalizeTiffOptions(options);
  if(settings.tiffCompression==='packbits')return encodePackBitsTiff(image);
  const at=codec._malloc(data.length);if(!at)throw new Error('Недостаточно памяти для TIFF');
  try {
    codec.HEAPU8.set(data,at);
    if(codec._viewer_tiff_encode(at,width,height,{none:1,lzw:5,deflate:8}[settings.tiffCompression],settings.tiffLevel,settings.tiffPredictor?2:1))
      throw new Error(codec.UTF8ToString(codec._viewer_tiff_error()));
    const pointer=codec._viewer_tiff_pixels(),size=codec._viewer_tiff_bytes();
    if(!pointer||!size||size>MAX_FILE||pointer+size>codec.HEAPU8.length)throw new Error('Некорректный результат TIFF');
    return codec.HEAPU8.slice(pointer,pointer+size).buffer;
  } finally {codec._free(at);codec._viewer_tiff_clear();}
}
