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

export function qualitySeriesReport(run,budgetBytes,sha256,browser=''){
  if(!run||!Array.isArray(run.points)||!Array.isArray(run.formats)||!run.input||
     !/^[0-9a-f]{64}$/.test(sha256))throw new Error('Недостаточно данных для протокола серии.');
  const summary=summarizeQualitySeries(run.points,budgetBytes);
  const expected=run.formats.length*SERIES_QUALITIES.length;
  const errors=run.points.filter(point=>point.status==='error').length;
  const partial=run.running||Boolean(run.stopReason)||run.points.length<expected||errors>0;
  const state=run.running?'running':run.stopReason?'stopped':errors?'completed-with-errors':partial?'partial':'complete';
  return {version:1,kind:'image-format-lab-quality-series',createdAt:run.createdAt,
    input:{name:run.input.name,bytes:run.input.bytes,mimeType:run.input.mimeType,width:run.width,height:run.height,bitDepth:run.input.bitDepth,sha256},
    conditions:{formats:[...run.formats],qualities:[...SERIES_QUALITIES],budgetBytes,
      sameRaster:true,resize:false,metadataPolicy:'none',jpegMatte:'white',
      metric:'PSNR RGB по декодированным пикселям на белой подложке; исходный размер и одинаковые координаты. Большее значение означает меньшую ошибку.'},
    progress:{state,partial,expected,attempted:run.points.length,ready:summary.readyCount,errors,stopReason:run.stopReason||null},
    points:run.points.map(point=>({id:point.id,order:point.order,format:point.format,quality:point.quality,status:point.status,
      ...(point.status==='ready'?{bytes:point.bytes,bpp:point.bpp,psnrRGB:point.psnrRGB===Infinity?'Infinity':point.psnrRGB,alphaErrorPercent:point.alphaErrorPercent}:{}),
      ...(point.status==='error'?{error:point.error}:{}),frontier:summary.frontier.has(point.id),bestUnderBudget:summary.best?.id===point.id})),
    result:{bestUnderBudget:summary.best?.id||null,frontier:[...summary.frontier]},
    environment:{browser},
    reproducibility:'Файлы результатов не вложены. Байты кодеков и время обработки могут различаться между браузерами и устройствами; выводы относятся только к измеренным точкам.'};
}
