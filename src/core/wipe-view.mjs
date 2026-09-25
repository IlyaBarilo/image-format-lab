// Geometry and readiness checks for the manual two-image comparison.
export function wipePair(first,second,ready){
  if(!first||!second||!ready(first)||!ready(second)||!first.bitmap||!second.bitmap)
    return {message:'Дождитесь готовности вариантов 1 и 2'};
  const width=first.bitmap.width,height=first.bitmap.height;
  if(!width||!height||width!==second.bitmap.width||height!==second.bitmap.height)
    return {message:'Для совмещения нужны одинаковые размеры'};
  return {width,height};
}

export function visibleGridLines(offset,step,count,viewport,cssStep){
  if(!Number.isFinite(offset)||!Number.isFinite(step)||step<=0||!Number.isInteger(count)||count<1||
     !Number.isFinite(viewport)||viewport<=0||!Number.isFinite(cssStep)||cssStep<8)return null;
  const first=Math.max(0,Math.ceil(-offset/step));
  const last=Math.min(count,Math.floor((viewport-offset)/step));
  return last<first||last-first>300?null:{first,last};
}

export function jpegBlockSize(subsampling){
  if(subsampling==='444')return {width:8,height:8};
  if(subsampling==='422')return {width:16,height:8};
  return {width:16,height:16};
}

export function visibleJpegBlockLines(offset,scale,pixels,viewport,cssScale){
  if(!Number.isFinite(pixels)||pixels<=0||!Number.isFinite(cssScale)||8*cssScale<24)return null;
  return visibleGridLines(offset,8*scale,Math.ceil(pixels/8),viewport,8*cssScale);
}
