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
  return visibleCodecBlockLines(offset,scale,pixels,viewport,cssScale,8);
}

export function visibleCodecBlockLines(offset,scale,pixels,viewport,cssScale,blockSize){
  if(!Number.isFinite(pixels)||pixels<=0||!Number.isFinite(cssScale)||
     !Number.isInteger(blockSize)||blockSize<1||blockSize*cssScale<24)return null;
  return visibleGridLines(offset,blockSize*scale,Math.ceil(pixels/blockSize),viewport,blockSize*cssScale);
}

export function codecGridSpec(config,blockGrid){
  if(!config)return null;
  if(config.format==='jpeg')return {kind:'jpeg',step:8,...jpegBlockSize(config.jpegSubsampling)};
  if(config.format==='webp'&&blockGrid?.kind==='webp-vp8')return {kind:'webp',step:16,width:16,height:16};
  if(config.format==='avif'&&blockGrid?.kind==='avif-superblock'&&[64,128].includes(blockGrid.width))
    return {kind:'avif',step:blockGrid.width,width:blockGrid.width,height:blockGrid.width};
  if(config.format==='heic'&&blockGrid?.kind==='heic-ctu'&&[16,32,64].includes(blockGrid.width))
    return {kind:'heic',step:blockGrid.width,width:blockGrid.width,height:blockGrid.width};
  if((config.format==='jxl'||config.format==='jxlLossless')&&blockGrid?.kind==='jxl-vardct'&&
     blockGrid.owners instanceof Uint32Array&&blockGrid.owners.length===blockGrid.columns*blockGrid.rows)
    return {kind:'jxl',step:8,columns:blockGrid.columns,rows:blockGrid.rows,owners:blockGrid.owners};
  return null;
}
