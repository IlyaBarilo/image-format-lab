// Own analysis presentation data, MIT. No application or DOM state.
export const ANALYSIS_CHANNELS={rgb:[0,1,2],r:[0],g:[1],b:[2],alpha:[3],y:[4]};
export const SIGNAL_NAMES=['Y′','Cb','Cr'];
export const spatialChannels=kind=>kind==='waveform'?[3]:kind==='rgbWaveform'||kind==='parade'?[0,1,2]:kind==='ycbcrWaveform'||kind==='ycbcrParade'?[3,4,5]:[];
export const ANALYSIS_METRICS={
  psnrRGB:{label:'PSNR RGB, dB',direction:'выше — меньше ошибка RGB'},
  alphaErrorPercent:{label:'Ошибка α, %',direction:'ниже — меньше ошибка прозрачности'},
  processingMs:{label:'Обработка, мс',direction:'ниже — меньше время обработки'}
};
export function analysisMaximum(kind,items,channel='rgb') {
  let maximum=0;
  for(const {data}of items){if(!data)continue;
    if(kind==='vectorscope'){for(const n of data.bins)maximum=Math.max(maximum,n/data.pixelCount);}
    else if(kind==='histogram'||kind==='signalHistogram'){for(const c of kind==='signalHistogram'?[0,1,2]:ANALYSIS_CHANNELS[channel])for(const n of data.channels[c])maximum=Math.max(maximum,n/data.pixelCount*100);}
    else if(kind==='errorHistogram'){for(const n of data.channels[channel==='alpha'?1:0])maximum=Math.max(maximum,n/data.pixelCount*100);}
    else if(kind==='errorProfile')for(const n of data.channels[channel==='alpha'?1:0].max)maximum=Math.max(maximum,n);
    else if(spatialChannels(kind).length)for(const c of spatialChannels(kind))for(let x=0;x<data.columns;x++)for(let y=0;y<256;y++)maximum=Math.max(maximum,data.channels[c][x*256+y]/data.columnPixels[x]);
  }
  return maximum||1;
}
export function tradeoffData(items,metric,source=null) {
  if(!Object.hasOwn(ANALYSIS_METRICS,metric))throw new Error('Неизвестная метрика анализа.');
  const points=[],omitted=[];
  for(const item of items){
    const m=item.measurement,value=m?.[metric];
    if(source&&m&&metric!=='processingMs'&&(m.width!==source.width||m.height!==source.height)){
      omitted.push({cell:item.cell,label:item.label,message:'Размеры отличаются от исходника; метрика недоступна.'});continue;
    }
    if(!item.data||!m||!Number.isFinite(m.bytes)||m.bytes<0||!(Number.isFinite(value)&&value>=0||metric==='psnrRGB'&&value===Infinity)){
      omitted.push({cell:item.cell,label:item.label,message:item.message||'Метрика недоступна.'});continue;
    }
    points.push({cell:item.cell,label:item.label,bytes:m.bytes,value,width:m.width,height:m.height});
  }
  const finite=points.filter(p=>Number.isFinite(p.value)).map(p=>p.value);
  return {metric,...ANALYSIS_METRICS[metric],points,omitted,
    xMax:Math.max(1,...points.map(p=>p.bytes))*1.08,yMax:Math.max(1,...finite)*1.08,
    hasInfinity:points.some(p=>p.value===Infinity)};
}
export function analysisJSON(snapshot) {
  // Typed arrays become ordinary arrays; an exact match must not silently become null.
  return JSON.stringify(snapshot,(_,value)=>ArrayBuffer.isView(value)?Array.from(value):value===Infinity?'Infinity':typeof value==='number'&&!Number.isFinite(value)?null:value,2);
}
