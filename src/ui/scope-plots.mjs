// Own Canvas renderers, MIT. Connected through application, with explicit inputs.
import { chromaCoordinates } from '../core/vectorscope.mjs';
const COLORS=['#fb7185','#4ade80','#60a5fa','#e2e8f0','#facc15'];
const NAMES=['R','G','B','α','Y′'];
function prepare(canvas, outputSize) {
  const rect=outputSize||canvas.getBoundingClientRect(),width=rect.width,height=rect.height,dpr=outputSize?1:Math.max(1,Math.min(2.5,devicePixelRatio||1));
  canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);
  const ctx=canvas.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);ctx.fillStyle='#101923';ctx.fillRect(0,0,width,height);
  ctx.font='11px "Segoe UI",sans-serif';ctx.textBaseline='middle';
  return {ctx,width,height,dpr};
}
export function createScopePlots() {
  function plotVectorscope(canvas,data,maximum,outputSize) {
    const {ctx,width,height,dpr}=prepare(canvas,outputSize),size=Math.max(24,Math.min(width-76,height-46));
    const cx=width/2,cy=26+size/2,left=cx-size/2,top=cy-size/2;
    ctx.strokeStyle='#334155';ctx.lineWidth=1;
    for(const radius of [size/4,size/2]){ctx.beginPath();ctx.arc(cx,cy,radius,0,Math.PI*2);ctx.stroke();}
    ctx.beginPath();ctx.moveTo(left,cy);ctx.lineTo(left+size,cy);ctx.moveTo(cx,top);ctx.lineTo(cx,top+size);ctx.stroke();
    const pixelsWide=Math.min(data.size,Math.max(1,Math.round(size*dpr))),pooled=new Uint32Array(pixelsWide*pixelsWide);
    for(let y=0;y<data.size;y++)for(let x=0;x<data.size;x++){
      const p=Math.floor(y*pixelsWide/data.size)*pixelsWide+Math.floor(x*pixelsWide/data.size);
      pooled[p]=Math.max(pooled[p],data.bins[y*data.size+x]);
    }
    const raster=document.createElement('canvas');raster.width=raster.height=pixelsWide;
    const rc=raster.getContext('2d'),pixels=rc.createImageData(pixelsWide,pixelsWide);
    for(let p=0;p<pooled.length;p++)if(pooled[p]){
      pixels.data[p*4]=125;pixels.data[p*4+1]=231;pixels.data[p*4+2]=216;
      pixels.data[p*4+3]=Math.round(255*Math.pow(pooled[p]/data.pixelCount/maximum,0.25));
    }
    rc.putImageData(pixels,0,0);ctx.imageSmoothingEnabled=false;ctx.drawImage(raster,left,top,size,size);
    const targets=[['R',255,0,0,'#fb7185'],['M',255,0,255,'#e879f9'],['B',0,0,255,'#60a5fa'],['C',0,255,255,'#22d3ee'],['G',0,255,0,'#4ade80'],['Y',255,255,0,'#facc15']];
    for(const [name,r,g,b,color]of targets){const {cb,cr}=chromaCoordinates(r,g,b),x=cx+cb*size,y=cy-cr*size;
      ctx.strokeStyle=color;ctx.strokeRect(x-2,y-2,4,4);ctx.fillStyle=color;ctx.textAlign=cb>0?'left':'right';ctx.fillText(name,x+(cb>0?5:-5),y);}
    ctx.fillStyle='#cbd5e1';ctx.textAlign='left';ctx.fillText('Cb →',left+size+7,cy+28);
    ctx.textAlign='center';ctx.fillText('Cr ↑',cx,10);ctx.fillText('0',cx,cy+11);
  }
  function plotLineProfile(canvas,data,indices,position,outputSize) {
    const {ctx,width,height}=prepare(canvas,outputSize),left=36,right=width-16,top=28,bottom=height-25;
    const x=bin=>data.bins===1?(left+right)/2:left+bin/(data.bins-1)*(right-left),y=value=>bottom-value/255*(bottom-top);
    ctx.strokeStyle='#334155';ctx.lineWidth=1;
    for(const value of [0,128,255]){ctx.beginPath();ctx.moveTo(left,y(value));ctx.lineTo(right,y(value));ctx.stroke();ctx.fillStyle='#cbd5e1';ctx.textAlign='right';ctx.fillText(String(value),left-5,y(value));}
    ctx.textAlign='left';ctx.fillText('A · 0%',left,height-10);ctx.textAlign='center';ctx.fillText('50%',(left+right)/2,height-10);ctx.textAlign='right';ctx.fillText('B · 100%',right,height-10);
    for(const index of indices){const channel=data.channels[index];ctx.strokeStyle=COLORS[index];ctx.globalAlpha=0.5;ctx.lineWidth=1;ctx.beginPath();
      for(let bin=0;bin<data.bins;bin++)if(channel.min[bin]!==channel.max[bin]){ctx.moveTo(x(bin),y(channel.min[bin]));ctx.lineTo(x(bin),y(channel.max[bin]));}ctx.stroke();ctx.globalAlpha=1;
      ctx.lineWidth=1.3;ctx.beginPath();channel.mean.forEach((value,bin)=>{if(bin)ctx.lineTo(x(bin),y(value));else ctx.moveTo(x(bin),y(value));});ctx.stroke();
      if(data.bins===1){ctx.fillStyle=COLORS[index];ctx.beginPath();ctx.arc(x(0),y(channel.mean[0]),2,0,Math.PI*2);ctx.fill();}
    }
    ctx.strokeStyle='#e2e8f0';ctx.lineWidth=1;ctx.setLineDash([3,3]);const pointer=left+position/1000*(right-left);ctx.beginPath();ctx.moveTo(pointer,top);ctx.lineTo(pointer,bottom);ctx.stroke();ctx.setLineDash([]);
    ctx.textAlign='right';indices.slice().reverse().forEach((index,offset)=>{ctx.fillStyle=COLORS[index];ctx.fillText(NAMES[index],right-offset*22,12);});
  }
  function plotErrorProfile(canvas,data,index,position,maximum,outputSize) {
    const {ctx,width,height}=prepare(canvas,outputSize),left=52,right=width-16,top=28,bottom=height-25;
    const channel=data.channels[index],limit=maximum||1;
    const x=bin=>data.bins===1?(left+right)/2:left+bin/(data.bins-1)*(right-left);
    const y=value=>bottom-value/limit*(bottom-top);
    const fmt=value=>value.toLocaleString('ru-RU',{maximumSignificantDigits:4});
    ctx.strokeStyle='#334155';ctx.lineWidth=1;
    for(const ratio of [0,.5,1]){const value=limit*ratio;ctx.beginPath();ctx.moveTo(left,y(value));ctx.lineTo(right,y(value));ctx.stroke();ctx.fillStyle='#cbd5e1';ctx.textAlign='right';ctx.fillText(`${fmt(value)}%`,left-5,y(value));}
    ctx.textAlign='left';ctx.fillText('A · 0%',left,height-10);ctx.textAlign='center';ctx.fillText('50%',(left+right)/2,height-10);ctx.textAlign='right';ctx.fillText('B · 100%',right,height-10);
    ctx.strokeStyle=index?'#e2e8f0':'#fb7185';ctx.globalAlpha=.45;ctx.beginPath();
    for(let bin=0;bin<data.bins;bin++)if(channel.min[bin]!==channel.max[bin]){ctx.moveTo(x(bin),y(channel.min[bin]));ctx.lineTo(x(bin),y(channel.max[bin]));}ctx.stroke();
    ctx.globalAlpha=1;ctx.lineWidth=1.5;ctx.beginPath();channel.mean.forEach((value,bin)=>{if(bin)ctx.lineTo(x(bin),y(value));else ctx.moveTo(x(bin),y(value));});ctx.stroke();
    if(data.bins===1){ctx.fillStyle=ctx.strokeStyle;ctx.beginPath();ctx.arc(x(0),y(channel.mean[0]),3,0,Math.PI*2);ctx.fill();}
    ctx.strokeStyle='#e2e8f0';ctx.lineWidth=1;ctx.setLineDash([3,3]);const pointer=left+position/1000*(right-left);ctx.beginPath();ctx.moveTo(pointer,top);ctx.lineTo(pointer,bottom);ctx.stroke();ctx.setLineDash([]);
    ctx.textAlign='right';ctx.fillStyle=index?'#e2e8f0':'#fb7185';ctx.fillText(index?'Ошибка α':'Ошибка RGB max',right,12);
    canvas.dataset.kind='errorProfile';canvas.dataset.yMin='0';canvas.dataset.yMax=String(limit);
  }
  function plotSSIM(canvas,data,outputSize) {
    const {ctx,width,height}=prepare(canvas,outputSize),left=45,right=width-45,middle=height/2+30;
    const x=value=>left+(value+1)/2*(right-left);
    const score=data.score.toLocaleString('ru-RU',{minimumFractionDigits:4,maximumFractionDigits:4});
    ctx.fillStyle='#e2e8f0';ctx.font='32px "Segoe UI",sans-serif';ctx.textAlign='center';ctx.fillText(`SSIM ${score}`,width/2,middle-55);
    ctx.strokeStyle='#334155';ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(left,middle);ctx.lineTo(right,middle);ctx.stroke();
    for(const [value,label] of [[-1,'−1'],[0,'0'],[1,'1']]){
      ctx.strokeStyle='#64748b';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(x(value),middle-8);ctx.lineTo(x(value),middle+8);ctx.stroke();
      ctx.fillStyle='#cbd5e1';ctx.font='12px "Segoe UI",sans-serif';ctx.fillText(label,x(value),middle+23);
    }
    ctx.fillStyle='#5eead4';ctx.beginPath();ctx.arc(x(data.score),middle,7,0,Math.PI*2);ctx.fill();
    ctx.fillStyle='#94a3b8';ctx.font='11px "Segoe UI",sans-serif';ctx.fillText('Структурное сходство по выбранной области',width/2,height-15);
    canvas.dataset.kind='ssim';canvas.dataset.score=String(data.score);
  }
  return {plotVectorscope,plotLineProfile,plotErrorProfile,plotSSIM};
}
