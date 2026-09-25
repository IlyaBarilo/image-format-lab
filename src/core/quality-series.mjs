// Own quality-series analysis, MIT. All comparisons use measured file bytes and PSNR.
export const SERIES_QUALITIES=Object.freeze([30,45,60,75,90]);
export const SERIES_FORMATS=Object.freeze(['jpeg','webp','avif','heic','jxl']);

export function seriesBudgetBytes(value){
  const text=String(value).trim();
  if(!/^(?:\d+)(?:[.,]\d{1,2})?$/.test(text))throw new Error('Введите бюджет от 1 до 100 000 КБ.');
  const kb=Number(text.replace(',','.'));
  if(!Number.isFinite(kb)||kb<1||kb>100000)throw new Error('Введите бюджет от 1 до 100 000 КБ.');
  return Math.round(kb*1000);
}

export function summarizeQualitySeries(points,budgetBytes){
  if(!Number.isSafeInteger(budgetBytes)||budgetBytes<1)throw new Error('Некорректный бюджет серии.');
  const ready=points.filter(p=>p.status==='ready'&&Number.isSafeInteger(p.bytes)&&p.bytes>0&&
    (p.psnrRGB===Infinity||Number.isFinite(p.psnrRGB)&&p.psnrRGB>=0));
  const frontier=new Set(ready.filter(point=>!ready.some(other=>other!==point&&
    other.bytes<=point.bytes&&other.psnrRGB>=point.psnrRGB&&
    (other.bytes<point.bytes||other.psnrRGB>point.psnrRGB))).map(p=>p.id));
  const eligible=ready.filter(p=>p.bytes<=budgetBytes);
  eligible.sort((a,b)=>b.psnrRGB-a.psnrRGB||a.bytes-b.bytes||a.order-b.order);
  return {frontier,best:eligible[0]||null,readyCount:ready.length};
}

export async function runSeriesProbes(formats,probe,isCurrent,publish){
  if(!Array.isArray(formats)||formats.length!==2||formats[0]===formats[1]||formats.some(f=>!SERIES_FORMATS.includes(f)))throw new Error('Выберите два разных формата серии.');
  const points=[];
  for(const format of formats)for(const quality of SERIES_QUALITIES){
    if(!isCurrent())return {points,cancelled:true};
    const order=points.length,id=`${format}-${quality}`;
    let point;
    try{point={id,order,format,quality,status:'ready',...await probe(format,quality,order)};}
    catch(error){point={id,order,format,quality,status:'error',error:error?.message||String(error)};}
    if(!isCurrent())return {points,cancelled:true};
    points.push(point);publish(point,points);
  }
  return {points,cancelled:false};
}
