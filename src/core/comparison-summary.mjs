// Compact current-result summary. It only projects measurements already present in the comparison report.
const QUALITY_FORMATS=new Set(['jpeg','webp','avif','jxl','jp2','j2k','heic']);
const FORMAT_NAMES={original:'Исходный файл',jpeg:'JPEG',png:'PNG',webp:'WebP',avif:'AVIF',
  jxl:'JPEG XL',jp2:'JPEG 2000 · JP2',j2k:'JPEG 2000 · J2K',tiff:'TIFF',
  ico:'ICO',heic:'HEIC',gif:'GIF',bmp:'BMP'};
export const SUMMARY_HEADERS=['Исходник','Размер исходника','Бит/канал исходника','Цвет исходника',
  'Ячейка','Формат','Режим','Размер результата','Файл, байт','bpp','Q','PSNR RGB, dB','Ошибка α, %',
  'Бит/канал результата','Примечание'];

function modeLabel(config,metrics){
  const c=config,depth=metrics.bitDepth;
  switch(c.format){
    case 'original':return 'Без перекодирования';
    case 'png':return c.formatMode==='palette'
      ?`Палитра · ${c.gifColors??256} цветов${c.gifDither?' · дизеринг':''}`
      :c.formatMode==='optimized'?'PNG opt':`Полные цвета · ${depth} бит/канал`;
    case 'bmp':return c.bmpDepth===8
      ?`8 бит · ${c.bmpColors??256} цветов${c.bmpCompression==='rle8'?' · RLE8':''}`
      :`${c.bmpDepth||24} бита · ${c.bmpDepth===32?'RGBA':'RGB'}`;
    case 'gif':return `${c.formatMode==='gifenc'?'gifenc':'встроенный'} · ${c.gifColors??256} цветов${c.gifDither&&c.formatMode!=='gifenc'?' · дизеринг':''}`;
    case 'jpeg':return `${String(c.jpegSubsampling||'420').replace(/^(\d)(\d)(\d)$/,'$1:$2:$3')}${c.jpegProgressive?' · прогрессивный':''}`;
    case 'tiff':return `${depth} бит/канал · ${c.tiffCompression||'deflate'}${c.tiffPredictor&&['deflate','lzw'].includes(c.tiffCompression||'deflate')?' · предиктор':''}`;
    case 'webp':case 'jxl':case 'jp2':case 'j2k':return c.formatMode==='lossless'?'Без потерь':'С потерями';
    case 'ico':return 'Набор размеров';
    default:return '';
  }
}

export function buildComparisonSummary(report,{iccProfile=false,nativePixelBuffer=null}={}){
  const s=report?.source;
  if(!s||!Number.isInteger(s.width)||!Number.isInteger(s.height)||s.width<1||s.height<1)
    throw new TypeError('Нет корректного исходника для сводки.');
  const colorNote=iccProfile?'Поддерживаемый ICC исходника преобразован в SDR sRGB для сравнения.'
    :s.colorSpace==='srgb'?'Рабочее цветовое пространство: sRGB SDR.'
      :'Цветовое пространство не подтверждено как sRGB: PSNR RGB сравнивает кодовые значения.';
  const source={name:String(s.name||''),width:s.width,height:s.height,
    depth:nativePixelBuffer?.sampleType==='float32'?'float32':nativePixelBuffer?.bitDepth||s.bitDepth||8,
    colorNote};
  const rows=[];
  for(const item of report.variants||[]){
    const c=item.config||{},m=item.metrics;
    if(item.status!=='ready'||!m||!Number.isInteger(m.width)||!Number.isInteger(m.height)||
        m.width<1||m.height<1||!Number.isSafeInteger(m.bytes)||m.bytes<0)continue;
    const quality=QUALITY_FORMATS.has(c.format)&&c.formatMode!=='lossless'&&Number.isInteger(c.quality)?c.quality:null;
    const psnr=m.psnrRGB==='Infinity'||m.psnrRGB===Infinity?Infinity:
      Number.isFinite(m.psnrRGB)?m.psnrRGB:null;
    const alpha=Number.isFinite(m.alphaErrorPercent)?m.alphaErrorPercent:null;
    const note=[m.precisionNote||'',psnr===null?'PSNR RGB недоступен.':'',
      alpha===null?'Ошибка α недоступна.':''].filter(Boolean).join(' ');
    rows.push({cell:item.cell,format:FORMAT_NAMES[c.format]||String(c.format||''),
      mode:modeLabel(c,m),width:m.width,height:m.height,bytes:m.bytes,bpp:m.bytes*8/(m.width*m.height),
      quality,psnr,alpha,depth:m.bitDepth||null,note});
  }
  return {source,rows};
}

const number=value=>Number.isFinite(value)?value.toFixed(2):value===Infinity?'∞':'';
export function summaryMatrix(summary){
  const s=summary.source;
  return [SUMMARY_HEADERS,...summary.rows.map(row=>[
    s.name,`${s.width}×${s.height}`,s.depth,s.colorNote,row.cell,row.format,row.mode,
    `${row.width}×${row.height}`,row.bytes,number(row.bpp),row.quality??'',number(row.psnr),number(row.alpha),row.depth??'',row.note
  ])];
}

function safeSpreadsheetCell(value){
  const text=String(value??'').replace(/[\r\n\t]+/g,' ');
  return /^[\s]*[=+@-]/.test(text)?`'${text}`:text;
}
export function summaryTsv(summary){
  return summaryMatrix(summary).map(row=>row.map(safeSpreadsheetCell).join('\t')).join('\r\n');
}
export function summaryCsv(summary){
  const quote=value=>`"${safeSpreadsheetCell(value).replace(/"/g,'""')}"`;
  return '\ufeff'+summaryMatrix(summary).map(row=>row.map(quote).join(',')).join('\r\n');
}
