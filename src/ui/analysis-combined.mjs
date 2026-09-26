// Own combined scopes and size/metric scatter plot, MIT. Inputs are explicit.
import {ANALYSIS_CHANNELS,analysisMaximum,spatialChannels,spatialCount,SIGNAL_NAMES} from '../core/analysis-output.mjs';
import {histogramView,histogramTick,groupHistogramDelta} from '../core/histogram-view.mjs';
import {chromaCoordinates} from '../core/vectorscope.mjs';
import {renderCieXy} from './scope-plots.mjs';
const COLORS=['#ff4b55','#27e36c','#3594ff','#f1f5f9','#facc15','#22d3ee','#f472b6'],NAMES=['R','G','B','α','Y′','Cb','Cr'];
const FILL_COLORS=['#e8b4bc','#afd6ba','#b2c8e8','#c9d1db','#e4dbaf','#a1dce3','#e7b2d4'];
const SIGNAL_COLORS=['#facc15','#22d3ee','#f472b6'],SIGNAL_FILLS=['#e4dbaf','#a1dce3','#e7b2d4'];
const spatialName=index=>index===3?'Y′':index===4?'Cb':index===5?'Cr':NAMES[index];
const spatialColor=index=>index>=3?COLORS[index+1]:COLORS[index];
const CELL_COLORS=['#38bdf8','#fb923c','#c084fc','#4ade80'];
const fmt=n=>n.toLocaleString('ru-RU',{maximumFractionDigits:2});
const deltaFmt=n=>n!==0&&Math.abs(n)<.001?n.toExponential(2):n.toLocaleString('ru-RU',{maximumSignificantDigits:3});
function prepare(canvas, outputSize){
  const rect=outputSize||canvas.getBoundingClientRect(),width=rect.width,height=rect.height,dpr=outputSize?1:Math.min(2.5,Math.max(1,devicePixelRatio||1));
  canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);
  const ctx=canvas.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);ctx.fillStyle='#101923';ctx.fillRect(0,0,width,height);ctx.font='11px "Segoe UI",sans-serif';ctx.textBaseline='middle';
  return {ctx,width,height,dpr};
}
function grid(ctx,left,right,top,bottom,maximum,percent=false){
  for(const ratio of [0,.5,1]){const y=bottom-ratio*(bottom-top);ctx.strokeStyle='#334155';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(left,y);ctx.lineTo(right,y);ctx.stroke();ctx.fillStyle='#cbd5e1';ctx.textAlign='right';ctx.fillText(fmt(maximum*ratio)+(percent?'%':''),left-6,y,left-10);}
}
function density(ctx,columns,rows,getValue,maximum,color,left,top,width,height,dpr){
  const w=Math.min(columns,Math.max(1,Math.round(width*dpr))),h=Math.min(rows,Math.max(1,Math.round(height*dpr))),pooled=new Float32Array(w*h);
  for(let y=0;y<rows;y++)for(let x=0;x<columns;x++){const i=Math.floor(y*h/rows)*w+Math.floor(x*w/columns);pooled[i]=Math.max(pooled[i],getValue(x,y));}
  const layer=document.createElement('canvas');layer.width=w;layer.height=h;const lc=layer.getContext('2d'),pixels=lc.createImageData(w,h);
  for(let i=0;i<pooled.length;i++)if(pooled[i]){pixels.data.set(color,i*4);pixels.data[i*4+3]=Math.round(255*Math.pow(pooled[i]/maximum,.25));}
  lc.putImageData(pixels,0,0);ctx.save();ctx.imageSmoothingEnabled=false;ctx.globalCompositeOperation='lighter';ctx.drawImage(layer,left,top,width,height);ctx.restore();
}
function curves(ctx,data,indices,{hist,limit,left,right,top,bottom,error=false,signal=false,profileNormalized=false},filled){
  const colors=signal?SIGNAL_COLORS:COLORS,fills=signal?SIGNAL_FILLS:FILL_COLORS;
  const series=indices.map(c=>{
    const values=hist?data.channels[c]:data.channels[c].mean;
    return {c,values,x:i=>left+(values.length===1?.5:i/(values.length-1))*(right-left),
      y:value=>bottom-(profileNormalized?value/(data.scaleMax||255)*100:value)/limit*(bottom-top),value:i=>hist?values[i]/data.pixelCount*100:values[i]};
  });
  const trace=s=>{ctx.beginPath();s.values.forEach((_,i)=>{if(i)ctx.lineTo(s.x(i),s.y(s.value(i)));else ctx.moveTo(s.x(i),s.y(s.value(i)));});};
  ctx.save();ctx.setLineDash([]);ctx.lineJoin='round';
  if(filled){
    // Paint all channel areas before any contours. The zero baseline is not a second signal.
    for(const s of series)if(s.values.length>1){
      trace(s);ctx.lineTo(s.x(s.values.length-1),bottom);ctx.lineTo(s.x(0),bottom);ctx.closePath();
       ctx.fillStyle=fills[error&&s.c===1?3:s.c];ctx.globalAlpha=.32;ctx.fill();
    }
  }
  if(!hist){
    // Keep the original min/max range of every profile bin, including narrow peaks.
    ctx.globalAlpha=filled?.28:.5;ctx.lineWidth=filled?1:1.5;
     for(const s of series){ctx.strokeStyle=filled?fills[s.c]:colors[s.c];ctx.beginPath();
      for(let i=0;i<data.bins;i++){ctx.moveTo(s.x(i),s.y(data.channels[s.c].min[i]));ctx.lineTo(s.x(i),s.y(data.channels[s.c].max[i]));}ctx.stroke();
    }
  }
  if(!filled){
    // A dark edge keeps the comparison contour readable over the coloured areas.
    ctx.globalAlpha=.9;ctx.strokeStyle='#101923';ctx.lineWidth=4;
    for(const s of series){trace(s);ctx.stroke();}
  }
  ctx.globalAlpha=filled?.65:1;ctx.lineWidth=filled?1:2;
  for(const s of series){
    const color=error&&s.c===1?3:s.c;
     ctx.strokeStyle=ctx.fillStyle=filled?fills[color]:colors[color];trace(s);ctx.stroke();
    if(s.values.length===1){ctx.beginPath();ctx.arc(s.x(0),s.y(s.value(0)),filled?3:5,0,Math.PI*2);if(filled)ctx.fill();else ctx.stroke();}
  }
  ctx.restore();
}
export function createAnalysisCombined(){
  function renderAnalysisDelta(canvas,model,settings,outputSize){
    const {ctx,width,height,dpr}=prepare(canvas,outputSize),left=72,right=width-18,top=32,bottom=height-28;
    model=groupHistogramDelta(model,Math.max(256,right-left));
    if(model.scale){canvas.dataset.xMin=String(model.scale.min);canvas.dataset.xMax=String(model.scale.max);canvas.dataset.bins=String(model.bins);}
    const limit=model.maximum||1,profile=model.type==='profile',spatial=Boolean(model.columns);
    canvas.dataset.kind=model.type;canvas.dataset.mode='delta';canvas.dataset.maxAbs=String(model.maximum);
    canvas.dataset.unit=model.unit;canvas.dataset.yMax=String(spatial?100:limit);canvas.dataset.yMin=String(spatial?0:-limit);
    if(spatial){
       const gap=14,span=(right-left-gap*(model.channels.length-1))/model.channels.length;
      grid(ctx,left,right,top,bottom,100,true);
      model.channels.forEach(({index,values},j)=>{
        const start=left+j*(span+gap),w=Math.min(model.columns,Math.max(1,Math.round(span*dpr))),h=Math.min(256,Math.max(1,Math.round((bottom-top)*dpr)));
        const pooled=new Float64Array(w*h);
        // Keep a non-zero peak when several signed bins share a screen pixel.
        for(let y=0;y<256;y++)for(let x=0;x<model.columns;x++){
          const value=values[x*256+255-y],i=Math.floor(y*h/256)*w+Math.floor(x*w/model.columns);
          if(Math.abs(value)>Math.abs(pooled[i]))pooled[i]=value;
        }
        const layer=document.createElement('canvas');layer.width=w;layer.height=h;
        const lc=layer.getContext('2d'),pixels=lc.createImageData(w,h);
        for(let i=0;i<pooled.length;i++)if(pooled[i]){
          pixels.data.set(pooled[i]>0?[251,146,60]:[56,189,248],i*4);
          pixels.data[i*4+3]=Math.round(255*Math.pow(Math.min(1,Math.abs(pooled[i])/limit),.25));
        }
        lc.putImageData(pixels,0,0);ctx.save();ctx.imageSmoothingEnabled=false;ctx.drawImage(layer,start,top,span,bottom-top);ctx.restore();
         ctx.fillStyle=spatialColor(index);ctx.textAlign='center';ctx.fillText(spatialName(index),start+span/2,13);
        ctx.fillStyle='#cbd5e1';ctx.textAlign='left';ctx.fillText('0%',start,height-12);ctx.textAlign='right';ctx.fillText('100%',start+span,height-12);
      });
    }else{
      const zero=(top+bottom)/2,x=i=>left+(model.bins===1?.5:i/(model.bins-1))*(right-left),y=v=>zero-v/limit*(bottom-top)/2;
      for(const ratio of [-1,-.5,0,.5,1]){
        const v=ratio*limit;ctx.strokeStyle=ratio===0?'#94a3b8':'#334155';ctx.lineWidth=ratio===0?1.5:1;
        ctx.beginPath();ctx.moveTo(left,y(v));ctx.lineTo(right,y(v));ctx.stroke();ctx.fillStyle='#cbd5e1';ctx.textAlign='right';
        ctx.fillText((v>0?'+':'')+deltaFmt(v),left-6,y(v),left-10);
      }
      ctx.textAlign='left';ctx.fillText(profile&&model.unit==='code-values'?'Δ уровней':'Δ п.п.',left,13);
      if(model.maximum){
        ctx.save();
        const trace=values=>{ctx.beginPath();values.forEach((v,i)=>i?ctx.lineTo(x(i),y(v)):ctx.moveTo(x(i),y(v)));};
         if(model.bins>1)for(const {index,values} of model.channels){
           trace(values);ctx.lineTo(x(model.bins-1),zero);ctx.lineTo(x(0),zero);ctx.closePath();ctx.fillStyle=model.type==='signalHistogram'?SIGNAL_FILLS[index]:FILL_COLORS[index];ctx.globalAlpha=.18;ctx.fill();
        }
        ctx.globalAlpha=1;ctx.lineWidth=2;
        for(const {index,values} of model.channels){
           ctx.strokeStyle=model.type==='signalHistogram'?SIGNAL_COLORS[index]:COLORS[index];trace(values);ctx.stroke();
           if(model.bins===1){ctx.beginPath();ctx.arc(x(0),y(values[0]),4,0,Math.PI*2);ctx.fillStyle=model.type==='signalHistogram'?SIGNAL_COLORS[index]:COLORS[index];ctx.fill();}
        }
        ctx.restore();
      }
      for(const ratio of [0,.5,1]){ctx.fillStyle='#cbd5e1';ctx.textAlign=ratio===0?'left':ratio===1?'right':'center';ctx.fillText(profile?`${ratio*100}%`:histogramTick(model.scale,ratio),left+ratio*(right-left),height-12);}
      const pointer=profile?settings.position/1000:settings.level/255;ctx.strokeStyle='#e2e8f0';ctx.setLineDash([3,3]);ctx.beginPath();ctx.moveTo(left+pointer*(right-left),top);ctx.lineTo(left+pointer*(right-left),bottom);ctx.stroke();ctx.setLineDash([]);
       ctx.textAlign='right';model.channels.slice().reverse().forEach(({index},i)=>{ctx.fillStyle=model.type==='signalHistogram'?SIGNAL_COLORS[index]:COLORS[index];ctx.fillText(model.type==='signalHistogram'?SIGNAL_NAMES[index]:NAMES[index],right-i*(model.type==='signalHistogram'?28:22),13);});
    }
  }
  function renderAnalysisOverlay(canvas,items,settings,outputSize){
    if(settings.type==='cieXy'){
      const references=new Map();
      for(const item of items)if(item.data.iccReference){const reference=item.data.iccReference;references.set(JSON.stringify(reference.bounds),reference);}
      renderCieXy(canvas,[...references.values(),...items.map(item=>item.data)],outputSize);return;
    }
     const {ctx,width,height,dpr}=prepare(canvas,outputSize),kind=settings.type,profile=kind==='profile',error=kind==='errorHistogram',signal=kind==='signalHistogram',hist=kind==='histogram'||signal||error;
     const mixedSignal=signal&&new Set(items.map(item=>item.data.bitDepth||8)).size>1;
     const view=kind==='histogram'||signal?histogramView(items,settings.channel,mixedSignal?256:Math.max(256,width-74),{allowUnknownColorSpace:true}):null;
    if(view){items=view.items;canvas.dataset.xMin=String(view.scale.min);canvas.dataset.xMax=String(view.scale.max);canvas.dataset.bins=String(view.scale.bins);}
    const channel=profile?settings.profileChannel:error?settings.errorChannel:settings.channel,indices=error?[channel==='alpha'?1:0]:ANALYSIS_CHANNELS[channel];
    const maximum=analysisMaximum(kind,items,channel,spatialChannels(kind).length?256:0),left=56,right=width-18,top=30,bottom=height-28;
    const profileNormalized=profile&&new Set(items.map(item=>item.data.scaleMax||255)).size>1;
    const profileLimit=profileNormalized?100:(items[0]?.data.scaleMax||255);
    canvas.dataset.kind=kind;canvas.dataset.mode='overlay';canvas.dataset.yMax=String(hist?maximum:kind==='vectorscope'?.5:spatialChannels(kind).length?100:profile?profileLimit:255);canvas.dataset.densityMax=String(maximum);
    if(hist||profile){
      const limit=hist?maximum:profileLimit;grid(ctx,left,right,top,bottom,limit,hist||profileNormalized);
       items.forEach(({data},layer)=>curves(ctx,data,indices,{hist,limit,left,right,top,bottom,error,signal,profileNormalized},layer===0));
      ctx.setLineDash([]);ctx.fillStyle='#cbd5e1';
      for(const ratio of [0,.5,1]){ctx.textAlign=ratio===0?'left':ratio===1?'right':'center';ctx.fillText(profile||error?`${ratio*100}%`:histogramTick(view.scale,ratio),left+ratio*(right-left),height-12);}
      const pointer=profile?settings.position/1000:settings.level/255;ctx.strokeStyle='#e2e8f0';ctx.setLineDash([3,3]);ctx.beginPath();ctx.moveTo(left+pointer*(right-left),top);ctx.lineTo(left+pointer*(right-left),bottom);ctx.stroke();ctx.setLineDash([]);
       ctx.textAlign='right';indices.slice().reverse().forEach((c,i)=>{ctx.fillStyle=signal?SIGNAL_COLORS[c]:COLORS[error&&c===1?3:c];ctx.fillText(error?(c===1?'α':'RGB'):signal?SIGNAL_NAMES[c]:NAMES[c],right-i*(signal?28:22),12);});
      if(error){canvas.dataset.xMin='0';canvas.dataset.xMax='100';canvas.dataset.bins='256';}
    }else if(kind==='vectorscope'){
      const size=Math.min(width-88,height-50),cx=width/2,cy=27+size/2,x0=cx-size/2,y0=cy-size/2;
      ctx.strokeStyle='#334155';for(const r of [size/4,size/2]){ctx.beginPath();ctx.arc(cx,cy,r,0,Math.PI*2);ctx.stroke();}
      ctx.beginPath();ctx.moveTo(x0,cy);ctx.lineTo(x0+size,cy);ctx.moveTo(cx,y0);ctx.lineTo(cx,y0+size);ctx.stroke();
      items.forEach(({data},i)=>density(ctx,data.size,data.size,(x,y)=>data.bins[y*data.size+x]/data.pixelCount,maximum,i?[255,130,55]:[70,210,255],x0,y0,size,size,dpr));
      for(const [name,r,g,b]of [['R',255,0,0],['M',255,0,255],['B',0,0,255],['C',0,255,255],['G',0,255,0],['Y',255,255,0]]){const {cb,cr}=chromaCoordinates(r,g,b),x=cx+cb*size,y=cy-cr*size;ctx.strokeStyle='#94a3b8';ctx.strokeRect(x-2,y-2,4,4);ctx.fillStyle='#cbd5e1';ctx.textAlign=cb>0?'left':'right';ctx.fillText(name,x+(cb>0?6:-6),y);}
      ctx.fillStyle='#cbd5e1';ctx.textAlign='center';ctx.fillText('Cr ↑',cx,11);ctx.textAlign='left';ctx.fillText('Cb →',x0+size+6,cy+28);
    }else{
       const channels=spatialChannels(kind),combined=['rgbWaveform','ycbcrWaveform'].includes(kind),gap=14,span=combined?right-left:(right-left-gap*(channels.length-1))/channels.length;
       grid(ctx,left,right,top,bottom,100,true);
       channels.forEach((c,j)=>{const start=combined?left:left+j*(span+gap);
         const base=kind==='ycbcrWaveform'?[[225,190,80],[75,185,205],[205,105,160]][j]:[[220,105,115],[76,198,100],[90,145,235]][j];
         items.forEach(({data},i)=>density(ctx,data.columns,256,(x,y)=>spatialCount(data,c,x,255-y)/data.columnPixels[x],maximum,combined?base.map(n=>Math.min(255,Math.round(n*(i?1.15:.6)))):i?[255,130,55]:[70,210,255],start,top,span,bottom-top,dpr));
         ctx.fillStyle=spatialColor(c);ctx.textAlign='center';ctx.fillText(spatialName(c),combined?right-(2-j)*28:start+span/2,12);
         if(!combined||j===0){ctx.textAlign='left';ctx.fillText('0%',start,height-12);ctx.textAlign='right';ctx.fillText('100%',start+span,height-12);}
       });
    }
  }
  function renderAnalysisTradeoff(canvas,model,outputSize){
    const {ctx,width,height}=prepare(canvas,outputSize),left=62,right=width-26,top=model.hasInfinity?66:34,bottom=height-35;
    canvas.dataset.kind='tradeoff';canvas.dataset.mode='metrics';canvas.dataset.metric=model.metric;canvas.dataset.xMax=String(model.xMax);canvas.dataset.yMax=String(model.yMax);canvas.dataset.points=JSON.stringify(model.points.map(({cell,bytes,value})=>({cell,bytes,value:value===Infinity?'Infinity':value})));
    grid(ctx,left,right,top,bottom,model.yMax);
    ctx.fillStyle='#cbd5e1';ctx.textAlign='left';ctx.fillText(model.label,left,12);
    for(const ratio of [0,.5,1]){ctx.textAlign=ratio===0?'left':ratio===1?'right':'center';ctx.fillText(fmt(model.xMax*ratio/1000),left+ratio*(right-left),height-18);}
    ctx.textAlign='right';ctx.fillText('Размер, КБ (1000 байт)',right,height-5);
    if(model.hasInfinity){ctx.strokeStyle='#64748b';ctx.setLineDash([3,4]);ctx.beginPath();ctx.moveTo(left,37);ctx.lineTo(right,37);ctx.stroke();ctx.setLineDash([]);ctx.textAlign='right';ctx.fillText('∞',left-6,37);}
    const placed=[];
    for(const p of model.points){const x=left+p.bytes/model.xMax*(right-left),y=p.value===Infinity?37:bottom-p.value/model.yMax*(bottom-top),color=CELL_COLORS[p.cell-1];
      ctx.fillStyle=color;ctx.beginPath();ctx.arc(x,y,5,0,Math.PI*2);ctx.fill();ctx.strokeStyle='#101923';ctx.lineWidth=1;ctx.stroke();
      // Coincident points keep their actual coordinates; only labels move.
      let labelY=y-10;while(placed.some(q=>Math.abs(q.x-x)<24&&Math.abs(q.y-labelY)<13))labelY+=14;
      placed.push({x,y:labelY});const labelX=x+(x>right-18?-8:8);
      if(labelY!==y-10){ctx.strokeStyle=color;ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(labelX,labelY);ctx.stroke();}
      ctx.textAlign=x>right-18?'right':'left';ctx.fillText(String(p.cell),labelX,labelY);
    }
  }
  return {renderAnalysisOverlay,renderAnalysisDelta,renderAnalysisTradeoff};
}
