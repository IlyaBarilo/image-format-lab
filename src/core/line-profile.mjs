// Own discrete line profile, MIT. Nearest pixels along the major-axis steps.
import { analysisRegionBounds } from './analysis-region.mjs';
import { createPixelBuffer } from './pixel-buffer.mjs';
export const DEFAULT_ANALYSIS_LINE = Object.freeze({x0:0,y0:500,x1:1000,y1:500});
export function profileBinAt(profile, position) {
  return Math.min(profile.bins-1,Math.floor(Math.round(position/1000*(profile.sampleCount-1))*profile.bins/profile.sampleCount));
}
export function profileEndpoints(imageData, region = null, line = DEFAULT_ANALYSIS_LINE) {
  const {width,height}=createPixelBuffer(imageData),bounds=analysisRegionBounds(width,height,region);
  return {bounds,points:profilePoints(bounds,line)};
}
export function profilePoints(bounds,line=DEFAULT_ANALYSIS_LINE) {
  const {x0,y0,x1,y1}=line||{};
  if(![x0,y0,x1,y1].every(v=>Number.isInteger(v)&&v>=0&&v<=1000))throw new Error('Некорректная линия анализа.');
  const x=v=>bounds.x+Math.round(v*(bounds.width-1)/1000),y=v=>bounds.y+Math.round(v*(bounds.height-1)/1000);
  return {x0:x(x0),y0:y(y0),x1:x(x1),y1:y(y1)};
}
export function computeLineProfile(input, matte = 'white', region = null, line = DEFAULT_ANALYSIS_LINE) {
  const {width,height,data,sampleType,bitDepth,colorSpace,alphaMode}=createPixelBuffer(input);
  if(sampleType==='float32')throw new Error('Профиль поддерживает целые RGBA8/16; float32 пока недоступен.');
  const {bounds,points}=profileEndpoints(input,region,line),scaleMax=2**bitDepth-1;
  if(matte!=='white'&&matte!=='black')throw new Error('Неизвестная подложка анализа.');
  const dx=points.x1-points.x0,dy=points.y1-points.y0,steps=Math.max(Math.abs(dx),Math.abs(dy));
  const sampleCount=steps+1,bins=Math.min(1024,sampleCount),counts=new Uint32Array(bins);
  const IntegerArray=sampleType==='uint16'?Uint16Array:Uint8Array,MeanArray=sampleType==='uint16'?Float64Array:Float32Array;
  const channels=Array.from({length:5},()=>({min:new IntegerArray(bins).fill(scaleMax),max:new IntegerArray(bins),mean:new MeanArray(bins)}));
  const sums=Array.from({length:5},()=>new Float64Array(bins)),totals=[0,0,0,0,0],background=matte==='white'?scaleMax:0,rgb=[0,0,0];
  for(let n=0;n<sampleCount;n++){
    const t=steps?n/steps:0,x=Math.round(points.x0+dx*t),y=Math.round(points.y0+dy*t),i=(y*width+x)*4;
    const a=data[i+3];
    if(a>scaleMax)throw new Error('Отсчёт альфы не соответствует разрядности профиля.');
    for(let c=0;c<3;c++){const raw=data[i+c];if(raw>scaleMax)throw new Error('Отсчёт цвета не соответствует разрядности профиля.');const value=Math.round(((alphaMode==='straight'?raw*a:raw*scaleMax)+background*(scaleMax-a))/scaleMax);if(value>scaleMax)throw new Error('Некорректное предварительно умноженное значение профиля.');rgb[c]=value;}
    const [r,g,b]=rgb;
    const values=[r,g,b,a,Math.round((2126*r+7152*g+722*b)/10000)],bin=Math.floor(n*bins/sampleCount);counts[bin]++;
    for(let c=0;c<5;c++){const value=values[c],channel=channels[c];channel.min[bin]=Math.min(channel.min[bin],value);channel.max[bin]=Math.max(channel.max[bin],value);sums[c][bin]+=value;totals[c]+=value;}
  }
  channels.forEach((channel,c)=>channel.mean.forEach((_,bin)=>{channel.mean[bin]=sums[c][bin]/counts[bin];}));
  return {width,height,bounds,points,pixelCount:bounds.width*bounds.height,matte,sampleCount,bins,counts,channels,means:totals.map(sum=>sum/sampleCount),sampleType,bitDepth,colorSpace,alphaMode,scaleMax};
}
